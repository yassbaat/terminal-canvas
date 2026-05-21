import { ipcMain, app } from "electron";
import {
  registerContextMenu,
  unregisterContextMenu,
  isContextMenuRegistered,
} from "../shell/context-menu";
import { createLogger } from "../util/logger";

const logger = createLogger("ShellIPC");

export function registerShellIPC(): void {
  ipcMain.handle("shell:registerContextMenu", async () => {
    if (!app.isPackaged) {
      return {
        success: false,
        error: "Context menu can only be registered from a packaged app. Build and install first.",
      };
    }
    try {
      registerContextMenu();
      return { success: true };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error("IPC: shell:registerContextMenu failed", error);
      return { success: false, error: msg };
    }
  });

  ipcMain.handle("shell:unregisterContextMenu", async () => {
    try {
      unregisterContextMenu();
      return { success: true };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error("IPC: shell:unregisterContextMenu failed", error);
      return { success: false, error: msg };
    }
  });

  ipcMain.handle("shell:isContextMenuRegistered", async () => {
    try {
      return isContextMenuRegistered();
    } catch (error) {
      logger.error("IPC: shell:isContextMenuRegistered failed", error);
      return false;
    }
  });

  logger.info("Shell IPC handlers registered");
}
