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

export function getWorkspaceFilePath(workspaceId: string): string {
  return path.join(getWorkspacesDir(), `${workspaceId}.json`);
}

export function getLogsDir(): string {
  return path.join(getUserDataPath(), "logs");
}
