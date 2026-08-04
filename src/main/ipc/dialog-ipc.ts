import { ipcMain, dialog, BrowserWindow } from "electron";
import path from "path";
import { createLogger } from "../util/logger";

const logger = createLogger("DialogIPC");

/**
 * Paths the user has actually chosen in a native open dialog during this run.
 *
 * file:addRoot widens the filesystem allowlist, and its contract is "only a
 * folder the user picked in the OS picker". That contract was documented but
 * unenforced: the renderer could hand it any string, so a single compromised
 * renderer dependency could register `/` and read the whole disk. Recording
 * what the dialog really returned is what makes the promise true.
 */
const dialogGrantedPaths = new Set<string>();

export function wasPickedInDialog(target: string): boolean {
  return dialogGrantedPaths.has(target);
}

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
      if (!result.canceled) {
        for (const picked of result.filePaths) {
          dialogGrantedPaths.add(path.resolve(picked));
        }
      }
      return result;
    } catch (err) {
      logger.error("dialog:showOpenDialog failed", err);
      return { canceled: true, filePaths: [] as string[] };
    }
  });

  ipcMain.handle(
    "dialog:showMessageBox",
    async (
      event,
      request: {
        type?: "none" | "info" | "error" | "question" | "warning";
        title?: string;
        message: string;
        detail?: string;
        buttons: string[];
        defaultId?: number;
        cancelId?: number;
      }
    ) => {
      const win = BrowserWindow.fromWebContents(event.sender);
      try {
        const result = win
          ? await dialog.showMessageBox(win, request)
          : await dialog.showMessageBox(request);
        return { response: result.response };
      } catch (err) {
        logger.error("dialog:showMessageBox failed", err);
        return { response: request.cancelId ?? -1 };
      }
    }
  );

  logger.info("Dialog IPC handlers registered");
}
