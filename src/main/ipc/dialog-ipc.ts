import { ipcMain, dialog, BrowserWindow } from "electron";
import { createLogger } from "../util/logger";

const logger = createLogger("DialogIPC");

export interface OpenDialogRequest {
  title?: string;
  defaultPath?: string;
  buttonLabel?: string;
  properties?: Array<"openFile" | "openDirectory" | "multiSelections">;
}

export function registerDialogIPC(): void {
  ipcMain.handle("dialog:showOpenDialog", async (event, request: OpenDialogRequest) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) {
      logger.error("dialog:showOpenDialog called without a parent window");
      return { canceled: true, filePaths: [] as string[] };
    }

    try {
      const result = await dialog.showOpenDialog(win, {
        title: request.title,
        defaultPath: request.defaultPath,
        buttonLabel: request.buttonLabel,
        properties: request.properties || ["openDirectory"],
      });
      return result;
    } catch (err) {
      logger.error("dialog:showOpenDialog failed", err);
      return { canceled: true, filePaths: [] as string[] };
    }
  });

  logger.info("Dialog IPC handlers registered");
}
