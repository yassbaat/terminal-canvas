import fs from "fs";
import path from "path";
import { createLogger } from "../util/logger";

const logger = createLogger("FileWatcher");

/**
 * Filesystem watching for the file explorer and open editors.
 *
 * Two deliberate choices here:
 *
 * 1. **Watch the containing directory, never the file itself.** Coding agents
 *    (and most editors) save by writing a temp file and renaming it over the
 *    target. That replaces the inode, and on macOS an fs.watch bound to the old
 *    inode simply stops firing -- so a file-bound watcher would go silent
 *    exactly when the agent starts editing, which is the whole use case. A
 *    watcher on the parent directory survives the rename and reports it.
 *
 * 2. **Never recursive.** fs.watch's recursive mode isn't supported on Linux in
 *    this Node version, and pointing it at a repo root would walk node_modules
 *    on the platforms where it does work. Every watched directory is explicit,
 *    and watchers are refcounted so N subscriptions on one directory share one
 *    OS handle.
 */

const DEBOUNCE_MS = 120;

export type WatchKind = "file" | "directory";

export interface FileChangeEvent {
  watchId: string;
  /** The watched path (the file, or the directory whose listing changed). */
  path: string;
  kind: WatchKind;
}

interface Subscription {
  id: string;
  kind: WatchKind;
  /** Directory actually handed to fs.watch. */
  dir: string;
  /** For file subscriptions, the basename to filter on. Null for directories. */
  basename: string | null;
  /** Full path reported back to the renderer. */
  target: string;
  timer: NodeJS.Timeout | null;
}

interface DirWatcher {
  watcher: fs.FSWatcher;
  subscriptions: Set<string>;
}

const dirWatchers = new Map<string, DirWatcher>();
const subscriptions = new Map<string, Subscription>();

let emit: ((event: FileChangeEvent) => void) | null = null;
let nextId = 1;

/** Wire up where change events go. Called once, from file-ipc registration. */
export function setFileChangeEmitter(fn: (event: FileChangeEvent) => void): void {
  emit = fn;
}

function fire(sub: Subscription): void {
  if (sub.timer) clearTimeout(sub.timer);
  // Debounced because a single save can produce several raw events (rename +
  // change, or one per chunk on a large write) and the renderer's response is
  // a full re-read either way.
  sub.timer = setTimeout(() => {
    sub.timer = null;
    if (!subscriptions.has(sub.id)) return;
    emit?.({ watchId: sub.id, path: sub.target, kind: sub.kind });
  }, DEBOUNCE_MS);
}

function ensureDirWatcher(dir: string): DirWatcher | null {
  const existing = dirWatchers.get(dir);
  if (existing) return existing;

  let watcher: fs.FSWatcher;
  try {
    watcher = fs.watch(dir, { persistent: false });
  } catch (error) {
    logger.warn(`Could not watch ${dir}`, error);
    return null;
  }

  const entry: DirWatcher = { watcher, subscriptions: new Set() };

  watcher.on("change", (_type, filename) => {
    const name = typeof filename === "string" ? filename : filename?.toString();
    for (const id of entry.subscriptions) {
      const sub = subscriptions.get(id);
      if (!sub) continue;
      // Directory subscriptions care about any change in the directory. File
      // subscriptions filter by name -- but fs.watch can report a null filename
      // on some platforms, in which case we can't tell and must assume it hit.
      if (sub.basename === null || !name || name === sub.basename) fire(sub);
    }
  });

  watcher.on("error", (error) => {
    logger.warn(`Watcher error on ${dir}`, error);
    // The handle is dead; drop it so the next subscription re-arms a fresh one.
    dirWatchers.delete(dir);
    try {
      watcher.close();
    } catch {
      /* already closed */
    }
  });

  dirWatchers.set(dir, entry);
  return entry;
}

/**
 * Start watching a path. `kind: "file"` reports writes/renames/deletes of that
 * one file; `kind: "directory"` reports any change to that directory's listing.
 * Returns a watch id, or null if the path could not be watched.
 */
export function watchPath(target: string, kind: WatchKind): string | null {
  const dir = kind === "directory" ? target : path.dirname(target);
  const entry = ensureDirWatcher(dir);
  if (!entry) return null;

  const id = `watch-${nextId++}`;
  const sub: Subscription = {
    id,
    kind,
    dir,
    basename: kind === "directory" ? null : path.basename(target),
    target,
    timer: null,
  };
  subscriptions.set(id, sub);
  entry.subscriptions.add(id);
  return id;
}

export function unwatch(watchId: string): void {
  const sub = subscriptions.get(watchId);
  if (!sub) return;
  if (sub.timer) clearTimeout(sub.timer);
  subscriptions.delete(watchId);

  const entry = dirWatchers.get(sub.dir);
  if (!entry) return;
  entry.subscriptions.delete(watchId);
  // Last subscriber for this directory -- release the OS handle.
  if (entry.subscriptions.size === 0) {
    try {
      entry.watcher.close();
    } catch {
      /* already closed */
    }
    dirWatchers.delete(sub.dir);
  }
}

/** Tear everything down (app quit, or the renderer reloading). */
export function unwatchAll(): void {
  for (const sub of subscriptions.values()) {
    if (sub.timer) clearTimeout(sub.timer);
  }
  subscriptions.clear();
  for (const entry of dirWatchers.values()) {
    try {
      entry.watcher.close();
    } catch {
      /* already closed */
    }
  }
  dirWatchers.clear();
}
