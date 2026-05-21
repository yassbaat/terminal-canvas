import { ipcMain } from "electron";
import {
  saveWorkspace,
  loadWorkspace,
  listWorkspaces,
  deleteWorkspace,
} from "../workspace/workspace-service";
import { createLogger } from "../util/logger";

const logger = createLogger("WorkspaceIPC");

// In-memory viewport cache for the current session (persisted on next save)
let currentViewport = { x: 0, y: 0, zoom: 1 };

export function registerWorkspaceIPC(): void {
  ipcMain.handle("workspace:save", async (_, { workspace }) => {
    try {
      // Inject cached viewport if workspace doesn't have it
      if (workspace.viewport === undefined || workspace.viewport === null) {
        workspace.viewport = { ...currentViewport };
      }
      saveWorkspace(workspace);
    } catch (error) {
      logger.error("IPC: workspace:save failed", error);
      throw error;
    }
  });

  ipcMain.handle("workspace:load", async (_, { workspaceId }) => {
    try {
      const workspace = loadWorkspace(workspaceId);
      return workspace;
    } catch (error) {
      logger.error(`IPC: workspace:load failed for ${workspaceId}`, error);
      return null;
    }
  });

  ipcMain.handle("workspace:list", async () => {
    try {
      const workspaces = listWorkspaces();
      return workspaces;
    } catch (error) {
      logger.error("IPC: workspace:list failed", error);
      return [];
    }
  });

  ipcMain.handle("workspace:delete", async (_, { workspaceId }) => {
    try {
      deleteWorkspace(workspaceId);
    } catch (error) {
      logger.error(`IPC: workspace:delete failed for ${workspaceId}`, error);
      throw error;
    }
  });

  ipcMain.handle("workspace:updateViewport", async (_, { x, y, zoom }) => {
    // Store viewport in memory so the next save includes it
    currentViewport = { x, y, zoom };
  });

  logger.info("Workspace IPC handlers registered");
}
