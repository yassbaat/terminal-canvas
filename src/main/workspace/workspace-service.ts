import { existsSync, readFileSync, writeFileSync, readdirSync, unlinkSync, mkdirSync } from "fs";
import path from "path";
import { createLogger } from "../util/logger";
import { getWorkspacesDir, getWorkspaceFilePath } from "../util/paths";
import { WORKSPACE_VERSION } from "./workspace-types";
import { generateId } from "../util/ids";
import type { Workspace, WorkspaceSettings, WorkspaceSummary } from "@renderer/type/workspace";
import type { TerminalSession } from "@renderer/type/terminal";

const logger = createLogger("WorkspaceService");

const DEFAULT_SETTINGS: WorkspaceSettings = {
  persistPromptHistory: true,
  persistTerminalOutput: false,
  autoNameSessions: true,
  autoRunSavedCommands: false,
  defaultShellId: "powershell",
};

/**
 * Ensure the workspaces directory exists.
 */
function ensureWorkspacesDir(): void {
  const dir = getWorkspacesDir();
  if (!existsSync(dir)) {
    try {
      mkdirSync(dir, { recursive: true });
      logger.info(`Created workspaces directory: ${dir}`);
    } catch (err) {
      logger.error(`Failed to create workspaces directory: ${dir}`, err);
    }
  }
}

/**
 * Strip non-persistable fields from terminal sessions before saving.
 * Removes bufferPreview (large output) but preserves status and snapshot.
 */
function stripTerminalsForSave(terminals: TerminalSession[]): TerminalSession[] {
  return terminals.map((t) => ({
    ...t,
    bufferPreview: "",
    // Keep pid null (runtime-only) but preserve status and snapshot
    pid: null,
  }));
}

/**
 * Save a workspace to a JSON file.
 */
export function saveWorkspace(workspace: Workspace): void {
  ensureWorkspacesDir();

  const filePath = getWorkspaceFilePath(workspace.id);

  const toSave = {
    version: WORKSPACE_VERSION,
    workspaceId: workspace.id,
    name: workspace.name,
    createdAt: workspace.createdAt,
    updatedAt: Date.now(),
    viewport: workspace.viewport,
    terminals: stripTerminalsForSave(workspace.terminals),
    groups: workspace.groups,
    edges: workspace.edges || [],
    stickyNotes: workspace.stickyNotes || [],
    promptHistory: workspace.promptHistory,
    settings: workspace.settings ?? { ...DEFAULT_SETTINGS },
  };

  try {
    writeFileSync(filePath, JSON.stringify(toSave, null, 2), "utf-8");
    logger.info(`Workspace saved: ${workspace.name} (${workspace.id})`);
  } catch (err) {
    logger.error(`Failed to save workspace ${workspace.id}:`, err);
  }
}

/**
 * Load a workspace from a JSON file.
 */
export function loadWorkspace(workspaceId: string): Workspace | null {
  const filePath = getWorkspaceFilePath(workspaceId);

  if (!existsSync(filePath)) {
    logger.warn(`Workspace file not found: ${filePath}`);
    return null;
  }

  try {
    const raw = readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw);

    if (parsed.version !== WORKSPACE_VERSION) {
      logger.warn(
        `Workspace version mismatch: expected ${WORKSPACE_VERSION}, got ${parsed.version}`
      );
      // Attempt to load anyway (forward compatibility)
    }

    const workspace: Workspace = {
      id: parsed.workspaceId || workspaceId,
      name: parsed.name || "Untitled Workspace",
      createdAt: parsed.createdAt || Date.now(),
      updatedAt: parsed.updatedAt || Date.now(),
      viewport: parsed.viewport || { x: 0, y: 0, zoom: 1 },
      terminals: parsed.terminals || [],
      groups: parsed.groups || [],
      edges: parsed.edges || [],
      stickyNotes: parsed.stickyNotes || [],
      promptHistory: parsed.promptHistory || [],
      settings: parsed.settings || { ...DEFAULT_SETTINGS },
    };

    logger.info(`Workspace loaded: ${workspace.name} (${workspace.id})`);
    return workspace;
  } catch (err) {
    logger.error(`Failed to load workspace ${workspaceId}:`, err);
    return null;
  }
}

/**
 * List all workspaces with their summaries.
 */
export function listWorkspaces(): WorkspaceSummary[] {
  ensureWorkspacesDir();

  const dir = getWorkspacesDir();
  if (!existsSync(dir)) {
    return [];
  }

  const summaries: WorkspaceSummary[] = [];

  try {
    const files = readdirSync(dir).filter((f) => f.endsWith(".json"));

    for (const file of files) {
      const filePath = path.join(dir, file);
      try {
        const raw = readFileSync(filePath, "utf-8");
        const parsed = JSON.parse(raw);
        summaries.push({
          id: parsed.workspaceId || file.replace(".json", ""),
          name: parsed.name || "Untitled",
          updatedAt: parsed.updatedAt || 0,
          terminalCount: (parsed.terminals || []).length,
          groupCount: (parsed.groups || []).length,
        });
      } catch {
        // Skip corrupted files
        logger.warn(`Skipping corrupted workspace file: ${filePath}`);
      }
    }
  } catch (err) {
    logger.error("Failed to list workspaces:", err);
  }

  // Sort by most recently updated first
  summaries.sort((a, b) => b.updatedAt - a.updatedAt);

  return summaries;
}

/**
 * Delete a workspace file.
 */
export function deleteWorkspace(workspaceId: string): void {
  const filePath = getWorkspaceFilePath(workspaceId);

  if (!existsSync(filePath)) {
    logger.warn(`Cannot delete: workspace file not found: ${filePath}`);
    return;
  }

  try {
    unlinkSync(filePath);
    logger.info(`Workspace deleted: ${workspaceId}`);
  } catch (err) {
    logger.error(`Failed to delete workspace ${workspaceId}:`, err);
  }
}

/**
 * Create a new default workspace.
 */
export function createDefaultWorkspace(): Workspace {
  const now = Date.now();
  const workspace: Workspace = {
    id: generateId(),
    name: "New Workspace",
    createdAt: now,
    updatedAt: now,
    viewport: { x: 0, y: 0, zoom: 1 },
    terminals: [],
    groups: [],
    edges: [],
    stickyNotes: [],
    promptHistory: [],
    settings: { ...DEFAULT_SETTINGS },
  };

  logger.info(`Created default workspace: ${workspace.id}`);
  return workspace;
}
