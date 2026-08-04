import { ipcMain, BrowserWindow, shell } from "electron";
import { promises as fsp } from "fs";
import path from "path";
import os from "os";
import { createLogger } from "../util/logger";
import { wasPickedInDialog } from "./dialog-ipc";
import {
  assertAllowed,
  looksBinary,
  registerRoot,
  listRoots,
  MAX_READ_BYTES,
} from "../util/path-guard";
import {
  setFileChangeEmitter,
  watchPath,
  unwatch,
  unwatchAll,
  type WatchKind,
} from "../file/file-watcher";
import { DEFAULT_HIDDEN } from "../file/ignore";
import { searchProject } from "../file/file-search";
import type {
  DirEntry,
  ReadFileResult,
  WriteFileResult,
  FileStatResult,
} from "@renderer/type/file";

const logger = createLogger("FileIPC");

// Which directories the explorer hides by default now lives in ./ignore, so
// project search skips exactly the same set (see file-search.ts).

function sortEntries(entries: DirEntry[]): DirEntry[] {
  return entries.sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
  });
}

/**
 * Point file-change events at a window and re-arm the reload cleanup hook.
 * Split out from handler registration so a second window (macOS dock-reopen)
 * rebinds without re-running ipcMain.handle, which throws on a duplicate.
 */
export function bindFileWindow(window: BrowserWindow): void {
  setFileChangeEmitter((event) => {
    if (!window.isDestroyed()) {
      window.webContents.send("file:changed", event);
    }
  });

  // A renderer reload orphans every watch id the previous page held, so drop
  // them all rather than leaking OS handles for the life of the app. This is a
  // single-page app with no in-app navigation, so the only times this fires are
  // the initial load (nothing to clear) and a reload (everything should clear);
  // the store re-watches whatever it reopens.
  window.webContents.on("did-start-loading", () => {
    unwatchAll();
  });
}

export function registerFileIPC(): void {
  ipcMain.handle("file:listDir", async (_, { path: dirPath, showHidden = false }) => {
    const safe = await assertAllowed(dirPath);
    const dirents = await fsp.readdir(safe, { withFileTypes: true });
    const entries: DirEntry[] = [];

    for (const dirent of dirents) {
      if (!showHidden && DEFAULT_HIDDEN.has(dirent.name)) continue;
      const full = path.join(safe, dirent.name);
      const isSymlink = dirent.isSymbolicLink();
      let isDirectory = dirent.isDirectory();
      let size = 0;
      let mtimeMs = 0;

      try {
        // stat (not lstat) so a symlinked directory expands like a directory.
        const st = await fsp.stat(full);
        isDirectory = st.isDirectory();
        size = st.size;
        mtimeMs = st.mtimeMs;
      } catch {
        // Broken symlink or a race with a delete -- still list it, just without
        // metadata, so the tree doesn't silently drop entries.
      }

      entries.push({ name: dirent.name, path: full, isDirectory, isSymlink, size, mtimeMs });
    }

    return sortEntries(entries);
  });

  ipcMain.handle("file:read", async (_, { path: filePath }): Promise<ReadFileResult> => {
    const safe = await assertAllowed(filePath);
    const st = await fsp.stat(safe);

    if (st.isDirectory()) {
      throw new Error(`${safe} is a directory`);
    }

    const truncated = st.size > MAX_READ_BYTES;
    const handle = await fsp.open(safe, "r");
    try {
      const length = truncated ? MAX_READ_BYTES : st.size;
      const buf = Buffer.alloc(length);
      await handle.read(buf, 0, length, 0);

      if (looksBinary(buf)) {
        return {
          path: safe,
          content: "",
          size: st.size,
          mtimeMs: st.mtimeMs,
          truncated,
          binary: true,
        };
      }

      return {
        path: safe,
        content: buf.toString("utf8"),
        size: st.size,
        mtimeMs: st.mtimeMs,
        truncated,
        binary: false,
      };
    } finally {
      await handle.close();
    }
  });

  ipcMain.handle(
    "file:write",
    async (_, { path: filePath, content, expectedMtimeMs }): Promise<WriteFileResult> => {
      const safe = await assertAllowed(filePath);

      // Optimistic-concurrency check: a coding agent rewriting the file while
      // the user has it open is the normal case here, not an edge case, so
      // never blind-write over a newer mtime.
      if (typeof expectedMtimeMs === "number") {
        try {
          const st = await fsp.stat(safe);
          if (Math.abs(st.mtimeMs - expectedMtimeMs) > 1) {
            return {
              ok: false,
              conflict: true,
              mtimeMs: expectedMtimeMs,
              actualMtimeMs: st.mtimeMs,
            };
          }
        } catch {
          // File is gone. Recreating it is the sane outcome of a save.
        }
      }

      // Write-then-rename so a crash mid-write can't leave a half-written file
      // where a working one used to be. The temp file is a sibling so the
      // rename stays on one filesystem (and so it lands inside the allowlist).
      const tmp = path.join(path.dirname(safe), `.${path.basename(safe)}.tc-tmp`);

      // The rename replaces the inode, so the new file would otherwise come
      // back with default permissions. Saving a one-character edit to a shell
      // script or a git hook silently dropped its executable bit -- and
      // committed a 100755 -> 100644 diff that broke it for everyone else.
      let originalMode: number | null = null;
      try {
        originalMode = (await fsp.stat(safe)).mode;
      } catch {
        // New file -- nothing to preserve.
      }

      try {
        await fsp.writeFile(tmp, content, "utf8");
        if (originalMode !== null) {
          await fsp.chmod(tmp, originalMode & 0o7777);
        }
        await fsp.rename(tmp, safe);
      } catch (error) {
        await fsp.rm(tmp, { force: true }).catch(() => {});
        throw error;
      }

      const st = await fsp.stat(safe);
      return { ok: true, mtimeMs: st.mtimeMs };
    }
  );

  ipcMain.handle("file:stat", async (_, { path: target }): Promise<FileStatResult> => {
    const safe = await assertAllowed(target);
    try {
      const st = await fsp.stat(safe);
      return {
        path: safe,
        exists: true,
        isDirectory: st.isDirectory(),
        size: st.size,
        mtimeMs: st.mtimeMs,
      };
    } catch {
      return { path: safe, exists: false, isDirectory: false, size: 0, mtimeMs: 0 };
    }
  });

  ipcMain.handle("file:watch", async (_, { path: target, kind }: { path: string; kind: WatchKind }) => {
    const safe = await assertAllowed(target);
    return watchPath(safe, kind === "directory" ? "directory" : "file");
  });

  ipcMain.handle("file:unwatch", async (_, { watchId }) => {
    unwatch(watchId);
  });

  ipcMain.handle("file:createFile", async (_, { path: target }) => {
    const safe = await assertAllowed(target);
    // wx fails if it already exists, which is what we want -- creating a file
    // must never silently blank an existing one.
    const handle = await fsp.open(safe, "wx");
    await handle.close();
    return safe;
  });

  ipcMain.handle("file:createDirectory", async (_, { path: target }) => {
    const safe = await assertAllowed(target);
    await fsp.mkdir(safe, { recursive: true });
    return safe;
  });

  ipcMain.handle("file:rename", async (_, { from, to }) => {
    // Both ends must be inside the allowlist, or rename becomes an exfiltration
    // primitive that moves files anywhere on disk.
    const safeFrom = await assertAllowed(from);
    const safeTo = await assertAllowed(to);
    await fsp.rename(safeFrom, safeTo);
    return safeTo;
  });

  ipcMain.handle("file:trash", async (_, { path: target }) => {
    const safe = await assertAllowed(target);
    // Always the OS trash, never unlink/rm: a mis-click in a file tree should
    // be recoverable by the user without involving us.
    await shell.trashItem(safe);
  });

  ipcMain.handle("file:reveal", async (_, { path: target }) => {
    const safe = await assertAllowed(target);
    shell.showItemInFolder(safe);
  });

  /**
   * Grant access to a folder the user explicitly picked in a native dialog.
   *
   * This is the only way the allowlist widens at the renderer's request, so
   * the path is checked against what the dialog actually returned this run --
   * not merely assumed to have come from there. Without that check the
   * renderer could register `/` and turn every file handler below into
   * arbitrary read/write of the user's disk.
   */
  ipcMain.handle("file:addRoot", async (_, { path: target }) => {
    const resolved = path.resolve(String(target ?? ""));
    if (!wasPickedInDialog(resolved)) {
      logger.warn(`Refused root grant for a path the user never picked: ${resolved}`);
      throw new Error("Folder access must be granted through the file picker");
    }
    const st = await fsp.stat(resolved);
    const dir = st.isDirectory() ? resolved : path.dirname(resolved);
    registerRoot(dir);
    logger.info(`Root granted: ${dir}`);
    return dir;
  });

  /**
   * Search the open project folders by file name or file contents. Takes no
   * path from the renderer -- the scope is the guard's allowlist itself -- so
   * this widens nothing that listDir/read didn't already reach.
   */
  ipcMain.handle("file:search", async (_, { query, mode, limit }) =>
    searchProject({ query, mode, limit })
  );

  ipcMain.handle("file:listRoots", async () => listRoots());

  ipcMain.handle("file:homeDir", async () => os.homedir());

  logger.info("File IPC handlers registered");
}
