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
  promptHistory: PromptEntry[];
  settings: WorkspaceSettings;
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
  noteIds?: string[];
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
