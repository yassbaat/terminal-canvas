import { BrowserWindow } from "electron";
import { registerTerminalIPC, bindTerminalWindow } from "./terminal-ipc";
import { registerWorkspaceIPC } from "./workspace-ipc";
import { registerGroqIPC } from "./groq-ipc";
import { registerShellIPC } from "./shell-ipc";
import { registerDialogIPC } from "./dialog-ipc";
import { registerFileIPC, bindFileWindow } from "./file-ipc";

// ipcMain.handle throws on a channel that already has a handler, and the
// channels live on the app, not on the window. createWindow() can run more
// than once per app run -- on macOS, closing the window leaves the process
// resident and a dock click re-creates it -- so the handlers register exactly
// once while the per-window bindings refresh every time.
let handlersRegistered = false;

/**
 * Register all IPC handlers for the main process and bind the given window.
 * Safe to call for every window created during the app's lifetime.
 */
export function registerAllIPC(window: BrowserWindow): void {
  // Per-window bindings, refreshed on every call so events follow the window
  // that is actually on screen.
  bindTerminalWindow(window);
  bindFileWindow(window);

  if (handlersRegistered) return;
  handlersRegistered = true;

  registerTerminalIPC();
  registerWorkspaceIPC();
  registerGroqIPC();
  registerShellIPC();
  registerDialogIPC();
  registerFileIPC();
}
