import type { TerminalSession } from "@renderer/type/terminal";
import type { Group, FileNode, WorkspaceSettings } from "@renderer/type/workspace";
import type { PromptEntry } from "@renderer/type/prompt";

export interface WorkspaceFile {
  version: number;
  workspaceId: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  viewport: { x: number; y: number; zoom: number };
  terminals: TerminalSession[];
  groups: Group[];
  files: FileNode[];
  promptHistory: PromptEntry[];
  settings: WorkspaceSettings;
}

/**
 * 2 -- added canvas file nodes (`files`) plus the per-terminal file explorer
 * state on sessions (fileRoot, openFiles, fileDrawerOpen). Loading tolerates a
 * mismatch and defaults the new keys, so v1 files still open.
 */
export const WORKSPACE_VERSION = 2;
