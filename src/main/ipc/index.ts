import { BrowserWindow } from "electron";
import { registerTerminalIPC } from "./terminal-ipc";
import { registerWorkspaceIPC } from "./workspace-ipc";
import { registerGroqIPC } from "./groq-ipc";
import { registerShellIPC } from "./shell-ipc";
import { registerDialogIPC } from "./dialog-ipc";

/**
 * Register all IPC handlers for the main process.
 * Must be called after the BrowserWindow is created so terminal IPC
 * can bind the window for sending events to the renderer.
 */
export function registerAllIPC(window: BrowserWindow): void {
  registerTerminalIPC(window);
  registerWorkspaceIPC();
  registerGroqIPC();
  registerShellIPC();
  registerDialogIPC();
}
