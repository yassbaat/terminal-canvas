import {
  existsSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  unlinkSync,
  mkdirSync,
  renameSync,
  rmSync,
} from "fs";
import path from "path";
import { createLogger } from "../util/logger";
import { getWorkspacesDir, getWorkspaceFilePath, isValidWorkspaceId } from "../util/paths";
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
  // Taller default: coding-agent TUIs benefit most from vertical room (see the
  // renderer's DEFAULT_SETTINGS for the rationale).
  defaultTerminalSize: { width: 900, height: 760 },
};

/**
 * Ensure the workspaces directory exists.
 */
function ensureWorkspacesDir(): void {
  const dir = getWorkspacesDir();
  if (!existsSync(dir)) {
    // Deliberately not swallowed: if the directory can't be created, the save
    // that follows cannot succeed either, and reporting success for a save
    // that never happened is how people lose a day's layout.
    mkdirSync(dir, { recursive: true });
    logger.info(`Created workspaces directory: ${dir}`);
  }
}

/**
 * Strip non-persistable fields from terminal sessions before saving.
 * Removes bufferPreview (large output) and ensures status is normalized.
 */
function stripTerminalsForSave(terminals: TerminalSession[]): TerminalSession[] {
  return terminals.map((t) => ({
    ...t,
    bufferPreview: "",
    // Reset transient runtime state
    pid: null,
    status:
      t.status === "running" || t.status === "starting"
        ? "exited"
        : t.status,
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
    files: workspace.files || [],
    promptHistory: workspace.promptHistory,
    settings: workspace.settings ?? { ...DEFAULT_SETTINGS },
  };

  // Errors propagate to the IPC caller on purpose. Swallowing them here made
  // the renderer report "Workspace saved" for a write that never landed --
  // and, because it then advanced lastSavedAt, the close prompt stopped
  // firing too, so the next quit discarded the workspace silently.
  writeWorkspaceFile(filePath, toSave);
  logger.info(`Workspace saved: ${workspace.name} (${workspace.id})`);
}

/**
 * Write a workspace file atomically: fill a sibling temp file, then rename
 * over the target.
 *
 * A workspace is tens to hundreds of KB, so a plain overwrite has a real
 * window in which the file is truncated but not yet rewritten. Dying in that
 * window (power loss, force quit, ENOSPC) left invalid JSON, and the parse
 * failure is caught silently by listWorkspaces -- the workspace simply
 * disappeared from the Home screen with no error and no recovery. rename() is
 * atomic within a filesystem, so a reader sees either the old file or the new
 * one.
 *
 * The temp suffix matters: listWorkspaces filters on `.json`, so a leftover
 * `.json.tmp` from a failed write never shows up as a phantom workspace.
 */
function writeWorkspaceFile(filePath: string, payload: unknown): void {
  const tmpPath = `${filePath}.tmp`;
  try {
    writeFileSync(tmpPath, JSON.stringify(payload, null, 2), "utf-8");
    renameSync(tmpPath, filePath);
  } catch (err) {
    try {
      rmSync(tmpPath, { force: true });
    } catch {
      // Best effort -- the original file is still intact either way.
    }
    throw err;
  }
}

/**
 * Load a workspace from a JSON file.
 */
export function loadWorkspace(workspaceId: string): Workspace | null {
  // Degrade rather than throw: one malformed entry must not take out the
  // caller. save/rename/delete still throw, because there the user asked for
  // a specific destructive action and deserves to be told it didn't happen.
  if (!isValidWorkspaceId(workspaceId)) {
    logger.warn(`Refusing to load workspace with invalid id: ${workspaceId}`);
    return null;
  }

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
      // The id we were asked for, not the one written inside the file. They
      // are the same for every workspace the app produced, and using the
      // validated one means a doctored `workspaceId` field can't come back
      // and steer the next save.
      id: workspaceId,
      name: parsed.name || "Untitled Workspace",
      createdAt: parsed.createdAt || Date.now(),
      updatedAt: parsed.updatedAt || Date.now(),
      viewport: parsed.viewport || { x: 0, y: 0, zoom: 1 },
      terminals: parsed.terminals || [],
      groups: parsed.groups || [],
      edges: parsed.edges || [],
      stickyNotes: parsed.stickyNotes || [],
      // Absent in v1 files -- canvas file nodes didn't exist yet.
      files: parsed.files || [],
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
      // The filename is the authoritative id -- that is what the path is built
      // from. Trusting the `workspaceId` field inside the JSON instead let a
      // hand-edited or shared file point save/rename/delete at any .json on
      // the machine.
      const id = file.slice(0, -".json".length);
      if (!isValidWorkspaceId(id)) {
        logger.warn(`Skipping workspace file with unusable name: ${file}`);
        continue;
      }
      try {
        const raw = readFileSync(filePath, "utf-8");
        const parsed = JSON.parse(raw);
        summaries.push({
          id,
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
 * Rename a workspace without loading it into a live session -- a targeted
 * patch of just the `name` field on disk. Renaming via the renderer's
 * loadWorkspace() would be wrong here: that action recreates every saved
 * terminal as a real running PTY, which is not something a "rename" from a
 * workspace list should ever trigger as a side effect.
 */
export function renameWorkspace(workspaceId: string, name: string): void {
  const filePath = getWorkspaceFilePath(workspaceId);

  if (!existsSync(filePath)) {
    logger.warn(`Cannot rename: workspace file not found: ${filePath}`);
    return;
  }

  // Same read-modify-write hazard as saveWorkspace, on a path the user reaches
  // with a single click -- so it gets the same atomic write.
  const raw = readFileSync(filePath, "utf-8");
  const parsed = JSON.parse(raw);
  parsed.name = name;
  parsed.updatedAt = Date.now();
  writeWorkspaceFile(filePath, parsed);
  logger.info(`Workspace renamed: ${workspaceId} -> "${name}"`);
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
    files: [],
    promptHistory: [],
    settings: { ...DEFAULT_SETTINGS },
  };

  logger.info(`Created default workspace: ${workspace.id}`);
  return workspace;
}
