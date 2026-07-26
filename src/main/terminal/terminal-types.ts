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
  width?: number;
  height?: number;
}

export interface ActiveTerminal {
  pty: IPty;
  session: TerminalSession;
  inputBuffer: string;
  lastOutputChunk: string;
  /**
   * Rolling capture of recent raw PTY output (escape codes included), replayed
   * into a freshly-mounted xterm so a terminal keeps its on-screen content when
   * it moves between the canvas and the Focus stage (see getBuffer / the
   * terminal:getBuffer IPC and XtermView's replay-on-mount). Capped to bound
   * memory; not perfect for complex full-screen TUIs but reconstructs the view.
   */
  outputBuffer: string;
  shellConfig: ShellConfig;
  spawnOptions: SpawnOptions;
  promptHistory: string[];
  /** Idle/attention detection bookkeeping (see terminal-manager.ts). */
  busyStartedAt: number | null;
  quietTimer: ReturnType<typeof setTimeout> | null;
  /** Has the shell printed its first prompt yet? Gates auto-run commands. */
  promptSeen: boolean;
  /**
   * Last-known cursor visibility, tracked from \x1b[?25l (hide) / \x1b[?25h
   * (show) escape codes. Many TUIs (spinners, progress bars, "thinking"
   * indicators) hide the cursor while actively rendering and show it again
   * once idle at an input prompt -- used as a suppression-only signal for
   * idle detection (see terminal-manager.ts). Defaults to true so shells
   * that never touch cursor visibility are unaffected.
   */
  cursorVisible: boolean;
  /** When the user last actually typed into this terminal (see TYPING_GRACE_MS in terminal-manager.ts). */
  lastInputAt: number | null;
  /**
   * When this terminal was last flagged for an interactive-input prompt (see
   * detectInputPrompt in terminal-manager.ts). Used to debounce the same menu
   * re-rendering (arrow-key redraws) into a single notification.
   */
  lastInputPromptAt: number | null;
  /**
   * Debounce timer for the OS-level cwd probe (see scheduleCwdProbe /
   * CWD_PROBE_DEBOUNCE_MS). Runs once output settles so a busy terminal never
   * triggers the probe mid-run.
   */
  cwdProbeTimer: ReturnType<typeof setTimeout> | null;
  /**
   * Disposer for this terminal's file-root grant (util/path-guard). Held for as
   * long as the terminal is alive, re-taken when its root changes, and released
   * on teardown -- that grant is the only reason the renderer can read or write
   * anything in this project folder.
   */
  releaseFileRoot: (() => void) | null;
}
