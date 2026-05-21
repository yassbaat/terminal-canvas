export type PromptKind = "shell-command" | "agent-prompt" | "multiline" | "unknown";
export type PromptStatus = "submitted" | "resent" | "deleted";

export interface PromptEntry {
  id: string;
  terminalId: string;
  text: string;
  normalizedText: string;
  kind: PromptKind;
  cwd: string;
  shellName: string;
  createdAt: number;
  submittedAt: number;
  pinned: boolean;
  status: PromptStatus;
  outputSummary?: string;
  tags: string[];
}

export interface CreatePromptOptions {
  terminalId: string;
  text: string;
  kind?: PromptKind;
  cwd: string;
}

export interface PromptFilterOptions {
  terminalId?: string;
  kind?: PromptKind;
  pinned?: boolean;
  search?: string;
}

export interface PromptResendOptions {
  promptId: string;
  targetTerminalId?: string;
}
