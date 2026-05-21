import { spawn } from "node-pty";
import { createLogger } from "../util/logger";
import { generateId } from "../util/ids";
import { detectShells } from "./shell-detector";
import { processInputBuffer } from "./prompt-capture";
import type { ActiveTerminal, ShellConfig, SpawnOptions } from "./terminal-types";
import type { TerminalSession } from "@renderer/type/terminal";
import type { PromptEntry } from "@renderer/type/prompt";
import { BrowserWindow } from "electron";

const logger = createLogger("TerminalManager");

export class TerminalManager {
  private terminals = new Map<string, ActiveTerminal>();
  private shellConfigs: ShellConfig[] = [];
  private ipcWindow: BrowserWindow | null = null;

  constructor() {
    this.shellConfigs = detectShells();
  }

  setWindow(window: BrowserWindow): void {
    this.ipcWindow = window;
  }

  getShells(): ShellConfig[] {
    return this.shellConfigs;
  }

  createTerminal(options: SpawnOptions): TerminalSession {
    const shellConfig = this.shellConfigs.find((s) => s.id === options.shellId);
    if (!shellConfig) {
      throw new Error(`Shell not found: ${options.shellId}`);
    }

    const id = options.id || generateId();
    const cols = options.cols ?? 80;
    const rows = options.rows ?? 24;
    const cwd = options.cwd ?? process.cwd();

    // Spawn the PTY process
    const pty = spawn(shellConfig.path, shellConfig.args, {
      name: "xterm-color",
      cols,
      rows,
      cwd,
      env: process.env as { [key: string]: string },
      useConpty: true,
    } as any);

    const now = Date.now();

    // Build a short CWD label for display
    const cwdLabel = this.shortenCwd(cwd);
    const projectName = this.extractProjectName(cwd);

    // Default node position — renderer will compute non-overlapping placement
    const defaultX = 100;
    const defaultY = 100;

    const session: TerminalSession = {
      id,
      name: options.name ?? `${shellConfig.name} Terminal`,
      autoName: null,
      manualName: null,
      shellId: shellConfig.id,
      shellName: shellConfig.name,
      shellPath: shellConfig.path,
      shellArgs: shellConfig.args,
      cwd,
      cwdLabel,
      projectName,
      repoRoot: null,
      status: "starting",
      pid: pty.pid,
      createdAt: now,
      updatedAt: now,
      exitedAt: null,
      exitCode: null,
      lastActivityAt: now,
      lastPromptAt: null,
      cols,
      rows,
      bufferPreview: "",
      promptCount: 0,
      groupId: null,
      node: {
        x: defaultX,
        y: defaultY,
        width: 640,
        height: 400,
      },
      naming: {
        enabled: true,
        lastNamedAt: null,
        lastNameReason: null,
        pending: false,
        error: null,
      },
    };

    // Set up PTY data handler
    pty.onData((data: string) => {
      session.lastActivityAt = Date.now();
      session.bufferPreview += data;
      // Keep buffer preview bounded
      if (session.bufferPreview.length > 2000) {
        session.bufferPreview = session.bufferPreview.slice(-2000);
      }

      const active = this.terminals.get(id);
      if (active) {
        active.lastOutputChunk += data;
        if (active.lastOutputChunk.length > 5000) {
          active.lastOutputChunk = active.lastOutputChunk.slice(-5000);
        }
      }

      // Forward data to renderer
      if (this.ipcWindow && !this.ipcWindow.isDestroyed()) {
        this.ipcWindow.webContents.send("terminal:data", { terminalId: id, data });
      }

      // Attempt CWD detection from prompt-like output
      this.detectCwdChange(data, session);
    });

    // Set up PTY exit handler
    pty.onExit(({ exitCode, signal }: { exitCode: number; signal?: number }) => {
      logger.info(`Terminal ${id} exited with code ${exitCode}, signal ${signal ?? "none"}`);
      session.status = exitCode === 0 ? "exited" : "crashed";
      session.exitCode = exitCode;
      session.exitedAt = Date.now();
      session.updatedAt = Date.now();

      if (this.ipcWindow && !this.ipcWindow.isDestroyed()) {
        this.ipcWindow.webContents.send("terminal:exit", { terminalId: id, exitCode });
      }
    });

    const active: ActiveTerminal = {
      pty,
      session,
      inputBuffer: "",
      lastOutputChunk: "",
      shellConfig,
      spawnOptions: { ...options },
      promptHistory: [],
    };

    this.terminals.set(id, active);

    // Mark as running once spawned
    session.status = "running";
    logger.info(`Created terminal ${id} with shell ${shellConfig.name} (PID: ${pty.pid})`);

    return { ...session };
  }

  writeToTerminal(id: string, data: string): void {
    const active = this.terminals.get(id);
    if (!active) {
      logger.warn(`writeToTerminal: terminal ${id} not found`);
      return;
    }
    if (active.session.status !== "running") {
      logger.warn(`writeToTerminal: terminal ${id} is not running (status: ${active.session.status})`);
      return;
    }

    active.pty.write(data);
    active.session.lastActivityAt = Date.now();

    // Track input buffer for prompt capture
    if (data === "\r" || data === "\n" || data === "\r\n") {
      this.flushInputBuffer(id);
    } else if (data.length === 1 && data.charCodeAt(0) === 127) {
      // Backspace: remove last char from buffer
      active.inputBuffer = active.inputBuffer.slice(0, -1);
    } else if (data.length === 1 && data.charCodeAt(0) < 32) {
      // Control character (e.g., Ctrl+C, Tab), ignore for buffer
    } else {
      active.inputBuffer += data;
    }
  }

  private flushInputBuffer(id: string): void {
    const active = this.terminals.get(id);
    if (!active) return;

    const buffer = active.inputBuffer;
    active.inputBuffer = "";

    if (buffer.trim().length === 0) return;

    const result = processInputBuffer(buffer);
    if (!result.shouldCapture) return;

    const entry: PromptEntry = {
      id: generateId(),
      terminalId: id,
      text: result.text,
      normalizedText: result.text,
      kind: result.kind,
      cwd: active.session.cwd,
      shellName: active.session.shellName,
      createdAt: Date.now(),
      submittedAt: Date.now(),
      pinned: false,
      status: "submitted",
      tags: [],
    };

    active.session.promptCount += 1;
    active.session.lastPromptAt = Date.now();
    active.session.updatedAt = Date.now();
    active.promptHistory.push(result.text);
    if (active.promptHistory.length > 20) {
      active.promptHistory.shift();
    }

    // Send prompt:add event to renderer
    if (this.ipcWindow && !this.ipcWindow.isDestroyed()) {
      this.ipcWindow.webContents.send("prompt:add", entry);
    }

    // Trigger auto-naming after 1st and 3rd prompts if enabled and not manually renamed
    if (
      active.session.naming.enabled &&
      !active.session.manualName &&
      (active.session.promptCount === 1 || active.session.promptCount === 3)
    ) {
      this.renameTerminal(id).catch(() => {
        // Silently ignore naming failures
      });
    }

    logger.debug(`Captured prompt for terminal ${id}: kind=${result.kind}`);
  }

  resizeTerminal(id: string, cols: number, rows: number): void {
    const active = this.terminals.get(id);
    if (!active) {
      logger.warn(`resizeTerminal: terminal ${id} not found`);
      return;
    }
    active.pty.resize(cols, rows);
    active.session.cols = cols;
    active.session.rows = rows;
    active.session.updatedAt = Date.now();
    logger.debug(`Resized terminal ${id} to ${cols}x${rows}`);
  }

  killTerminal(id: string): void {
    const active = this.terminals.get(id);
    if (!active) {
      logger.warn(`killTerminal: terminal ${id} not found`);
      return;
    }
    logger.info(`Killing terminal ${id} (PID: ${active.session.pid})`);
    active.session.status = "killed";
    active.session.updatedAt = Date.now();
    try {
      active.pty.kill();
    } catch (err) {
      logger.error(`Error killing terminal ${id}:`, err);
    }
  }

  restartTerminal(id: string): TerminalSession {
    const active = this.terminals.get(id);
    if (!active) {
      throw new Error(`Terminal not found: ${id}`);
    }

    // Kill the old PTY
    try {
      active.pty.kill();
    } catch {
      // ignore errors during kill
    }

    // Preserve node position, size, and name
    const preservedNode = { ...active.session.node };
    const preservedName = active.session.manualName ?? active.session.name;

    // Create new terminal with same config
    const newOptions: SpawnOptions = {
      shellId: active.spawnOptions.shellId,
      cols: active.session.cols,
      rows: active.session.rows,
      cwd: active.session.cwd,
      name: preservedName,
    };

    // Remove old entry
    this.terminals.delete(id);

    // Create new terminal
    const newSession = this.createTerminal(newOptions);

    // Restore preserved node position and name
    const newActive = this.terminals.get(newSession.id);
    if (newActive) {
      newActive.session.node = preservedNode;
      if (preservedName && preservedName !== `${active.shellConfig.name} Terminal`) {
        newActive.session.name = preservedName;
      }
    }

    logger.info(`Restarted terminal ${id} -> ${newSession.id}`);
    return newActive ? { ...newActive.session } : { ...newSession };
  }

  clearTerminal(id: string): void {
    const active = this.terminals.get(id);
    if (!active) {
      logger.warn(`clearTerminal: terminal ${id} not found`);
      return;
    }
    active.pty.write("\x1bc"); // ESC c - full reset
    logger.debug(`Cleared terminal ${id}`);
  }

  getSession(id: string): TerminalSession | undefined {
    const active = this.terminals.get(id);
    return active ? { ...active.session } : undefined;
  }

  getAllSessions(): TerminalSession[] {
    return Array.from(this.terminals.values()).map((a) => ({ ...a.session }));
  }

  cleanupAll(): void {
    logger.info(`Cleaning up ${this.terminals.size} terminals`);
    for (const [, active] of this.terminals) {
      try {
        active.pty.kill();
      } catch {
        // ignore errors during cleanup
      }
    }
    this.terminals.clear();
  }

  /**
   * Get terminal context for Groq auto-naming.
   */
  getTerminalContext(
    id: string
  ): {
    cwdLabel: string;
    shellName: string;
    recentPrompts: string[];
    outputPreview: string;
    projectName: string | null;
    promptCount: number;
  } | null {
    const active = this.terminals.get(id);
    if (!active) return null;

    return {
      cwdLabel: active.session.cwdLabel,
      shellName: active.session.shellName,
      recentPrompts: active.promptHistory.slice(-5),
      outputPreview: active.lastOutputChunk.slice(0, 500),
      projectName: active.session.projectName,
      promptCount: active.session.promptCount,
    };
  }

  /**
   * Rename a terminal using Groq or fallback naming.
   * Updates session state and notifies renderer.
   */
  async renameTerminal(id: string): Promise<{ name: string; reason: string } | null> {
    const active = this.terminals.get(id);
    if (!active) {
      logger.warn(`renameTerminal: terminal ${id} not found`);
      return null;
    }

    if (active.session.manualName) {
      logger.debug(`Terminal ${id} has manual name, skipping auto-rename`);
      return null;
    }

    const ctx = this.getTerminalContext(id);
    if (!ctx) return null;

    // Import here to avoid circular dependency at module load time
    const { generateTerminalName } = await import("../groq/groq-naming-service");
    const result = await generateTerminalName({
      ...ctx,
      existingTitle: active.session.name,
    });

    active.session.autoName = result.name;
    active.session.name = result.name;
    active.session.naming.lastNamedAt = Date.now();
    active.session.naming.lastNameReason = result.reason;
    active.session.naming.pending = false;
    active.session.updatedAt = Date.now();

    if (this.ipcWindow && !this.ipcWindow.isDestroyed()) {
      this.ipcWindow.webContents.send("terminal:renamed", {
        terminalId: id,
        name: result.name,
        reason: result.reason,
      });
    }

    logger.info(`Renamed terminal ${id} to "${result.name}" (${result.reason})`);
    return { name: result.name, reason: result.reason };
  }

  /** Extract a display-friendly CWD string. */
  private shortenCwd(cwd: string): string {
    const home = process.env.USERPROFILE || process.env.HOME || "";
    if (home && cwd.startsWith(home)) {
      return cwd.replace(home, "~");
    }
    return cwd;
  }

  /** Extract the project (folder) name from a CWD path. */
  private extractProjectName(cwd: string): string | null {
    if (!cwd || cwd === ".") return null;
    const parts = cwd.split(/[\\\/]/).filter(Boolean);
    if (parts.length === 0) return null;
    const last = parts[parts.length - 1];
    return last && last !== "~" ? last : parts[parts.length - 2] || null;
  }

  /**
   * Attempt to detect CWD changes from shell prompt output.
   * This is a heuristic based on common shell prompt patterns.
   */
  private detectCwdChange(data: string, session: TerminalSession): void {
    // Look for PowerShell prompt pattern: C:\Users\...>
    const psMatch = data.match(/([A-Za-z]:\\[^:]+)>/);
    if (psMatch && psMatch[1]) {
      const detectedCwd = psMatch[1].trim();
      if (detectedCwd !== session.cwd && detectedCwd.length > 2) {
        session.cwd = detectedCwd;
        session.cwdLabel = this.shortenCwd(detectedCwd);
        session.projectName = this.extractProjectName(detectedCwd);
        session.updatedAt = Date.now();

        if (this.ipcWindow && !this.ipcWindow.isDestroyed()) {
          this.ipcWindow.webContents.send("terminal:cwdChanged", {
            terminalId: session.id,
            cwd: detectedCwd,
          });
        }
      }
      return;
    }

    // Look for bash-like prompt: user@host:/path$ or /path $
    const bashMatch = data.match(/[:\s](\/[\w\-/.\s]*)\s*[\$#]\s*$/m);
    if (bashMatch && bashMatch[1]) {
      const detectedCwd = bashMatch[1].trim();
      if (detectedCwd !== session.cwd && detectedCwd.length > 1) {
        session.cwd = detectedCwd;
        session.cwdLabel = this.shortenCwd(detectedCwd);
        session.projectName = this.extractProjectName(detectedCwd);
        session.updatedAt = Date.now();

        if (this.ipcWindow && !this.ipcWindow.isDestroyed()) {
          this.ipcWindow.webContents.send("terminal:cwdChanged", {
            terminalId: session.id,
            cwd: detectedCwd,
          });
        }
      }
    }
  }
}

export const terminalManager = new TerminalManager();
