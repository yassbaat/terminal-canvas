import type { TerminalSession } from "./terminal";
import type { PromptEntry } from "./prompt";

export interface WorkspaceSettings {
  persistPromptHistory: boolean;
  persistTerminalOutput: boolean;
  autoNameSessions: boolean;
  autoRunSavedCommands: boolean;
  defaultShellId: string | null;
  /** Pixel size new terminal nodes spawn at on the canvas. */
  defaultTerminalSize: { width: number; height: number };
}

export interface WorkspaceViewport {
  x: number;
  y: number;
  zoom: number;
}

export interface WorkspaceEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
  type?: string;
  animated?: boolean;
  style?: Record<string, any>;
}

export interface Workspace {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  viewport: WorkspaceViewport;
  terminals: TerminalSession[];
  groups: Group[];
  edges: WorkspaceEdge[];
  stickyNotes: StickyNote[];
  /** Files detached from a terminal's tab strip onto the canvas as their own nodes. */
  files: FileNode[];
  promptHistory: PromptEntry[];
  settings: WorkspaceSettings;
}

/**
 * A file pinned to the canvas as a standalone node -- dragged out of a
 * terminal's tab strip so it can sit beside the session that's editing it.
 *
 * Only the path and geometry are persisted, never the contents: the file on
 * disk is the source of truth, and a workspace that carried a stale copy of it
 * would be actively misleading next to an agent that has since rewritten it.
 */
export interface FileNode {
  id: string;
  path: string;
  x: number;
  y: number;
  width: number;
  height: number;
  groupId?: string | null;
  /**
   * Terminal this file was dragged out of. A pinned file travels with that
   * terminal when it's dragged, and is unpinned (but kept) if it's closed.
   */
  pinnedToTerminalId?: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface StickyNote {
  id: string;
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  colorIndex?: number;
  pinnedToTerminalId?: string | null;
  groupId?: string | null;
  /** Render as a big canvas title/label (large text, minimal chrome, legible when zoomed way out) rather than a normal note. */
  isTitle?: boolean;
  /** Body text size in px for normal notes (user-adjustable via +/- ). Defaults to the small font when unset. */
  fontSize?: number;
  createdAt: number;
  updatedAt: number;
}

export interface Group {
  id: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  collapsed: boolean;
  color?: string;
  terminalIds: string[];
  parentId?: string | null;
  noteIds: string[];
}

export interface WorkspaceSummary {
  id: string;
  name: string;
  updatedAt: number;
  terminalCount: number;
  groupCount: number;
}

export type WorkspaceRestoreMode = "layout-only" | "start-shells" | "full-restore";

export interface RestoreWorkspaceOptions {
  workspaceId: string;
  mode: WorkspaceRestoreMode;
}

export interface SaveWorkspaceOptions {
  workspace: Workspace;
}
