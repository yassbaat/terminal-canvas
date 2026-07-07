import type { TerminalSession } from "@renderer/type/terminal";
import type { IPty } from "node-pty";

export interface ShellConfig {
  id: string;
  name: string;
  path: string;
  args: string[];
  icon: string;
}

export interface SpawnOptions {
  shellId: string;
  cols?: number;
  rows?: number;
  cwd?: string;
  name?: string;
  id?: string;
}

export interface ActiveTerminal {
  pty: IPty;
  session: TerminalSession;
  inputBuffer: string;
  lastOutputChunk: string;
  shellConfig: ShellConfig;
  spawnOptions: SpawnOptions;
  promptHistory: string[];
  /** Idle/attention detection bookkeeping (see terminal-manager.ts). */
  busyStartedAt: number | null;
  quietTimer: ReturnType<typeof setTimeout> | null;
}
