import { useTerminalStore } from "@renderer/store/terminal";
import { useWorkspaceStore } from "@renderer/store/workspace";
import { useUIStore } from "@renderer/store/ui";
import { useFileStore } from "@renderer/store/file";

/** True when `child` is `parent` or sits underneath it. */
export function isInsidePath(parent: string, child: string): boolean {
  const p = parent.replace(/\\/g, "/").replace(/\/$/, "");
  const c = child.replace(/\\/g, "/");
  return c === p || c.startsWith(p + "/");
}

/**
 * Which terminal a file most plausibly belongs to: the focused one when the
 * file is inside its project, otherwise whichever terminal's project folder
 * contains it most specifically (so a terminal open on a sub-package wins over
 * one open on the monorepo root). Falls back to the focused terminal, which is
 * where the user is looking even if the file came from somewhere else.
 */
export function pickTerminalForPath(path: string): string | null {
  const terminalStore = useTerminalStore();
  const focusedId = terminalStore.focusedTerminalId;
  const focused = focusedId ? terminalStore.sessions.get(focusedId) : null;

  if (focused && isInsidePath(focused.fileRoot || focused.cwd, path)) return focused.id;

  let best: { id: string; depth: number } | null = null;
  for (const session of terminalStore.allSessions) {
    const root = session.fileRoot || session.cwd;
    if (!root || !isInsidePath(root, path)) continue;
    const depth = root.length;
    if (!best || depth > best.depth) best = { id: session.id, depth };
  }

  return best?.id ?? focused?.id ?? null;
}

/**
 * Open a file wherever it makes sense from the surface the user is on:
 *
 *  - Focus Mode -> pinned open on the left of the stage (the only place a file
 *    lives there, and the reason that panel exists).
 *  - Canvas -> a tab in the terminal whose project it belongs to.
 *  - Canvas with no terminal to attach it to -> its own node, near the middle
 *    of what's currently on screen.
 */
export async function openPathInWorkspace(path: string): Promise<void> {
  const uiStore = useUIStore();

  if (uiStore.focusModeActive) {
    uiStore.openFocusFile(path);
    return;
  }

  const terminalId = pickTerminalForPath(path);
  if (terminalId) {
    await useFileStore().openInTerminal(terminalId, path);
    useTerminalStore().setFocused(terminalId);
    return;
  }

  const workspaceStore = useWorkspaceStore();
  const viewport = workspaceStore.viewport;
  const zoom = viewport.zoom || 1;
  workspaceStore.createFileNode({
    path,
    x: (-viewport.x + window.innerWidth / 2) / zoom - 260,
    y: (-viewport.y + window.innerHeight / 2) / zoom - 230,
  });
}
