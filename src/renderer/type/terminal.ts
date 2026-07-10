import type { KnownAgentId } from "@renderer/util/agents";

export interface TerminalNodeData {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface TerminalNamingState {
  enabled: boolean;
  lastNamedAt: number | null;
  lastNameReason: string | null;
  pending: boolean;
  error: string | null;
}

/**
 * Why a terminal was flagged as needing attention:
 * - "idle" -- it produced output continuously for at least the configured
 *   threshold, then went quiet (heuristic for "the command/agent finished").
 * - "bell" -- it emitted a BEL (\x07) character, an explicit signal many
 *   CLIs (including coding agents) send when they want your attention.
 */
export type AttentionReason = "idle" | "bell";

export interface TerminalSession {
  id: string;
  name: string;
  autoName: string | null;
  manualName: string | null;
  shellId: string;
  shellName: string;
  shellPath: string;
  shellArgs: string[];
  cwd: string;
  cwdLabel: string;
  projectName: string | null;
  repoRoot: string | null;
  status: "starting" | "running" | "exited" | "crashed" | "killed";
  pid: number | null;
  createdAt: number;
  updatedAt: number;
  exitedAt: number | null;
  exitCode: number | null;
  lastActivityAt: number | null;
  lastPromptAt: number | null;
  cols: number;
  rows: number;
  bufferPreview: string;
  promptCount: number;
  groupId: string | null;
  node: TerminalNodeData;
  naming: TerminalNamingState;
  needsAttention: boolean;
  lastAttentionAt: number | null;
  attentionReason: AttentionReason | null;
  /** "Off duty" terminals are excluded from idle/bell attention detection. */
  idleDetectionEnabled: boolean;
  /** Best-effort guess at which coding-agent CLI is running in the foreground, if any. */
  activeAgent: KnownAgentId | null;
}

export interface ShellInfo {
  id: string;
  name: string;
  path: string;
  args: string[];
  icon: string;
}

export interface CreateTerminalOptions {
  shellId: string;
  cols: number;
  rows: number;
  cwd?: string;
  name?: string;
  id?: string;
  width?: number;
  height?: number;
}

export interface TerminalWriteOptions {
  terminalId: string;
  data: string;
}

export interface TerminalResizeOptions {
  terminalId: string;
  cols: number;
  rows: number;
}

export interface TerminalIdOptions {
  terminalId: string;
}

export interface TerminalDataEvent {
  terminalId: string;
  data: string;
}

export interface TerminalExitEvent {
  terminalId: string;
  exitCode: number;
}

export interface TerminalCwdEvent {
  terminalId: string;
  cwd: string;
}

export interface TerminalRenamedEvent {
  terminalId: string;
  name: string;
  reason: string;
}

export interface TerminalAttentionEvent {
  terminalId: string;
  reason: AttentionReason;
  /** Whether the renderer should also play a sound for this occurrence (see MAX_IDLE_NOTIFICATIONS_PER_MINUTE). */
  chime: boolean;
}

export interface TerminalReadyEvent {
  terminalId: string;
}

export interface TerminalNodeProps {
  id: string;
  label?: string;
  data: {
    session: TerminalSession;
  };
  selected?: boolean;
  dragging?: boolean;
  position: { x: number; y: number };
  dimensions: { width: number; height: number };
}
