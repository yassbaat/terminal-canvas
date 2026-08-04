import { app } from "electron";
import path from "path";
import { createLogger } from "./logger";

// Logger available for future path debugging
void createLogger("Paths");

let _userDataPath: string | null = null;

function getUserDataPath(): string {
  if (_userDataPath) return _userDataPath;
  try {
    _userDataPath = app.getPath("userData");
  } catch {
    _userDataPath = path.resolve("./user-data");
  }
  return _userDataPath;
}

export function getWorkspacesDir(): string {
  const dir = path.join(getUserDataPath(), "workspaces");
  return dir;
}

/**
 * Workspace ids are interpolated straight into a filesystem path, and the id
 * is read back out of a JSON file on disk -- so a hand-edited or shared
 * workspace file could otherwise point save/rename/delete at an arbitrary
 * `.json` anywhere on the machine.
 *
 * Both generators in the app produce ids that satisfy this: main emits
 * `<base36ts>-<6rand>-<counter>` and the renderer emits
 * `ws_<base36ts>_<counter>_<4rand>`.
 */
const WORKSPACE_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

export function isValidWorkspaceId(workspaceId: string): boolean {
  return WORKSPACE_ID_PATTERN.test(workspaceId);
}

export function getWorkspaceFilePath(workspaceId: string): string {
  if (!isValidWorkspaceId(workspaceId)) {
    throw new Error(`Invalid workspace id: ${workspaceId}`);
  }
  return path.join(getWorkspacesDir(), `${workspaceId}.json`);
}

export function getLogsDir(): string {
  return path.join(getUserDataPath(), "logs");
}
