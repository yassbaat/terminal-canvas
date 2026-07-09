import { ipcMain, app } from "electron";
import {
  registerContextMenu,
  unregisterContextMenu,
  isContextMenuRegistered,
} from "../shell/context-menu";
import {
  registerFinderQuickAction,
  unregisterFinderQuickAction,
  isFinderQuickActionRegistered,
} from "../shell/finder-quick-action";
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
      if (process.platform === "win32") {
        registerContextMenu();
      } else if (process.platform === "darwin") {
        registerFinderQuickAction();
      } else {
        return {
          success: false,
          error: "Right-click integration is only available on Windows and macOS.",
        };
      }
      return { success: true };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error("IPC: shell:registerContextMenu failed", error);
      return { success: false, error: msg };
    }
  });

  ipcMain.handle("shell:unregisterContextMenu", async () => {
    try {
      if (process.platform === "win32") {
        unregisterContextMenu();
      } else if (process.platform === "darwin") {
        unregisterFinderQuickAction();
      }
      return { success: true };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error("IPC: shell:unregisterContextMenu failed", error);
      return { success: false, error: msg };
    }
  });

  ipcMain.handle("shell:isContextMenuRegistered", async () => {
    try {
      if (process.platform === "win32") {
        return isContextMenuRegistered();
      }
      if (process.platform === "darwin") {
        return isFinderQuickActionRegistered();
      }
      return false;
    } catch (error) {
      logger.error("IPC: shell:isContextMenuRegistered failed", error);
      return false;
    }
  });

  logger.info("Shell IPC handlers registered");
}
