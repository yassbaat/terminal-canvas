import type { TerminalSession } from "@renderer/type/terminal";
import type { Group, WorkspaceSettings } from "@renderer/type/workspace";
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
  promptHistory: PromptEntry[];
  settings: WorkspaceSettings;
}

export const WORKSPACE_VERSION = 1;
