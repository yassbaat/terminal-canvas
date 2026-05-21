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
  /** Serialized terminal buffer for workspace restore */
  bufferSnapshot?: string | null;
  /** True if this terminal was restored from a snapshot rather than started fresh */
  restoredFromSnapshot?: boolean;
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
