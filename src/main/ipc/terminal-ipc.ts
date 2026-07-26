import { ipcMain, BrowserWindow, shell } from "electron";
import { terminalManager } from "../terminal/terminal-manager";
import { createLogger } from "../util/logger";

const logger = createLogger("TerminalIPC");

export function registerTerminalIPC(window: BrowserWindow): void {
  terminalManager.setWindow(window);

  ipcMain.handle("terminal:create", async (_, options) => {
    try {
      logger.debug("IPC: terminal:create", options);
      const session = terminalManager.createTerminal(options);
      return session;
    } catch (error) {
      logger.error("IPC: terminal:create failed", error);
      throw error;
    }
  });

  ipcMain.handle("terminal:write", async (_, { terminalId, data }) => {
    try {
      terminalManager.writeToTerminal(terminalId, data);
    } catch (error) {
      logger.error(`IPC: terminal:write failed for ${terminalId}`, error);
    }
  });

  ipcMain.handle("terminal:resize", async (_, { terminalId, cols, rows }) => {
    try {
      terminalManager.resizeTerminal(terminalId, cols, rows);
    } catch (error) {
      logger.error(`IPC: terminal:resize failed for ${terminalId}`, error);
    }
  });

  ipcMain.handle("terminal:kill", async (_, { terminalId }) => {
    try {
      terminalManager.killTerminal(terminalId);
    } catch (error) {
      logger.error(`IPC: terminal:kill failed for ${terminalId}`, error);
    }
  });

  ipcMain.handle("terminal:restart", async (_, { terminalId }) => {
    try {
      logger.debug(`IPC: terminal:restart ${terminalId}`);
      const session = terminalManager.restartTerminal(terminalId);
      return session;
    } catch (error) {
      logger.error(`IPC: terminal:restart failed for ${terminalId}`, error);
      throw error;
    }
  });

  ipcMain.handle("terminal:clear", async (_, { terminalId }) => {
    try {
      terminalManager.clearTerminal(terminalId);
    } catch (error) {
      logger.error(`IPC: terminal:clear failed for ${terminalId}`, error);
    }
  });

  ipcMain.handle("terminal:listShells", async () => {
    try {
      const shells = terminalManager.getShells();
      return shells;
    } catch (error) {
      logger.error("IPC: terminal:listShells failed", error);
      return [];
    }
  });

  ipcMain.handle("terminal:openCwdInExplorer", async (_, { terminalId }) => {
    try {
      const session = terminalManager.getSession(terminalId);
      if (session?.cwd) {
        shell.openPath(session.cwd);
        logger.debug(`Opened CWD in explorer: ${session.cwd}`);
      }
    } catch (error) {
      logger.error(`IPC: terminal:openCwdInExplorer failed for ${terminalId}`, error);
    }
  });

  ipcMain.handle("terminal:getBuffer", async (_, { terminalId }) => {
    try {
      return terminalManager.getBuffer(terminalId);
    } catch (error) {
      logger.error(`IPC: terminal:getBuffer failed for ${terminalId}`, error);
      return "";
    }
  });

  ipcMain.handle("terminal:setIdleThreshold", async (_, { ms }) => {
    try {
      terminalManager.setIdleThresholdMs(ms);
    } catch (error) {
      logger.error("IPC: terminal:setIdleThreshold failed", error);
    }
  });

  ipcMain.handle("terminal:setIdleDetectionEnabled", async (_, { terminalId, enabled }) => {
    try {
      terminalManager.setIdleDetectionEnabled(terminalId, enabled);
    } catch (error) {
      logger.error(`IPC: terminal:setIdleDetectionEnabled failed for ${terminalId}`, error);
    }
  });

  ipcMain.handle("terminal:setFileRoot", async (_, { terminalId, dir }) => {
    try {
      terminalManager.setFileRoot(terminalId, dir);
    } catch (error) {
      logger.error(`IPC: terminal:setFileRoot failed for ${terminalId}`, error);
    }
  });

  ipcMain.handle("terminal:setOpenFiles", async (_, { terminalId, openFiles, activeFile }) => {
    try {
      terminalManager.setOpenFiles(terminalId, openFiles ?? [], activeFile ?? null);
    } catch (error) {
      logger.error(`IPC: terminal:setOpenFiles failed for ${terminalId}`, error);
    }
  });

  logger.info("Terminal IPC handlers registered");
}
