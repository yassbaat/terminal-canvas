import { spawnSync } from "child_process";
import { app } from "electron";
import path from "path";
import { createLogger } from "../util/logger";

const logger = createLogger("ContextMenu");

const APP_NAME = "TerminalCanvas";
const MENU_LABEL = "Open in Terminal Canvas";

/**
 * Registry paths for Windows context menus.
 * We use HKCU (HKEY_CURRENT_USER) so no admin elevation is required.
 */
const REG_PATHS = {
  directory: `HKCU\\Software\\Classes\\Directory\\shell\\${APP_NAME}`,
  directoryCommand: `HKCU\\Software\\Classes\\Directory\\shell\\${APP_NAME}\\command`,
  background: `HKCU\\Software\\Classes\\Directory\\Background\\shell\\${APP_NAME}`,
  backgroundCommand: `HKCU\\Software\\Classes\\Directory\\Background\\shell\\${APP_NAME}\\command`,
};

function getExecPath(): string {
  // process.execPath is the actual executable:
  // - In production (packaged): the installed app .exe
  // - In dev: the electron binary from node_modules (should not be used)
  return path.resolve(process.execPath);
}

function ensurePackaged(): void {
  if (!app.isPackaged) {
    throw new Error(
      "Context menu registration is only supported in a packaged app. " +
        "Run 'npm run dist:win', install the app, and register from the installed version."
    );
  }
}

function runReg(args: string[]): void {
  const result = spawnSync("reg.exe", args, {
    encoding: "utf-8",
    windowsHide: true,
  });
  if (result.status !== 0) {
    const err = new Error(
      `reg.exe ${args.join(" ")} failed: ${result.stderr || result.stdout || "unknown error"}`
    );
    logger.error(`Registry command failed`, err);
    throw err;
  }
}

/**
 * Register the Windows Explorer context menu entries.
 * Uses HKCU so it works without admin rights.
 */
export function registerContextMenu(): void {
  ensurePackaged();
  const execPath = getExecPath();
  // Quote the executable path so spaces are handled
  const quotedExec = `"${execPath}"`;
  // Use --open-dir as a separate arg and append \. to %V so there is never
  // a bare trailing backslash before the closing quote (\" would escape it).
  // The \. resolves to the directory itself via path.normalize().
  const commandValue = `${quotedExec} --open-dir "%V\\."`;

  // Directory (right-click on a folder icon)
  runReg(["add", REG_PATHS.directory, "/f", "/ve", "/d", MENU_LABEL]);
  runReg(["add", REG_PATHS.directoryCommand, "/f", "/ve", "/d", commandValue]);

  // Background (right-click inside a folder window)
  runReg(["add", REG_PATHS.background, "/f", "/ve", "/d", MENU_LABEL]);
  runReg([
    "add",
    REG_PATHS.backgroundCommand,
    "/f",
    "/ve",
    "/d",
    commandValue,
  ]);

  logger.info("Windows context menu registered");
}

/**
 * Unregister the Windows Explorer context menu entries.
 */
export function unregisterContextMenu(): void {
  try {
    runReg(["delete", REG_PATHS.directory, "/f"]);
  } catch {
    // may not exist
  }
  try {
    runReg(["delete", REG_PATHS.background, "/f"]);
  } catch {
    // may not exist
  }
  logger.info("Windows context menu unregistered");
}

/**
 * Check whether the context menu entries exist.
 */
export function isContextMenuRegistered(): boolean {
  const result = spawnSync("reg.exe", ["query", REG_PATHS.directory], {
    encoding: "utf-8",
    windowsHide: true,
  });
  return result.status === 0;
}
