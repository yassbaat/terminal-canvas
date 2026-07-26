import { spawn } from "node-pty";
import os from "os";
import path from "path";
import { execFile } from "child_process";
import { promises as fsp } from "fs";
import { createLogger } from "../util/logger";
import { generateId } from "../util/ids";
import { findRepoRoot, resolveFileRoot } from "../util/repo";
import { registerRoot } from "../util/path-guard";
import { detectShells } from "./shell-detector";
import { processInputBuffer, stripInputEscapeSequences } from "./prompt-capture";
import type { ActiveTerminal, ShellConfig, SpawnOptions } from "./terminal-types";
import type { TerminalSession, AttentionReason } from "@renderer/type/terminal";
import type { PromptEntry } from "@renderer/type/prompt";
import { BrowserWindow } from "electron";

const logger = createLogger("TerminalManager");

// How long output must have been quiet before we consider a busy terminal
// "settled" (i.e. the running command/agent turn has finished). This is a
// fixed implementation detail, distinct from the user-configurable
// idleThresholdMs below (how long it must have been busy beforehand to be
// worth notifying about at all). Coding agents commonly pause well over a
// second between visible output bursts (waiting on a tool call, a web
// request, extended thinking) while still mid-task, so this needs to be a
// generous backstop rather than a tight "done typing" window -- the cursor-
// visibility check below is the primary signal now, this just bounds how
// long we wait when that signal is unavailable.
const QUIET_MS = 4000;

// How recently the user must have typed into a terminal for a subsequent
// quiet period there to be treated as "still composing/interacting" rather
// than "a background command/agent settled." Deliberately longer than
// QUIET_MS: the quiet timer itself only fires after QUIET_MS of silence, so
// a shorter window here would never actually suppress anything -- by the
// time the callback runs, at least QUIET_MS has already elapsed since the
// last keystroke. Typing keeps re-arming this on every character, so it
// only matters right after the user stops typing (e.g. a pause mid-prompt,
// or the moment right after hitting Enter) -- a real agent run continues
// well past this window with no further input at all.
const TYPING_GRACE_MS = 8000;

// Hard cap on how many "idle" (heuristic) attention notifications can fire
// across all terminals combined per rolling minute. This is a backstop for
// the heuristic firing more than is useful (e.g. several terminals settling
// in quick succession) -- deliberately does not apply to "bell" (\x07),
// which is an explicit, deliberate signal from the program itself rather
// than a guess.
const MAX_IDLE_NOTIFICATIONS_PER_MINUTE = 4;

// Cap on the per-terminal replay buffer (raw output). ~256KB is plenty to
// reconstruct a screenful-plus of scrollback while bounding memory.
const OUTPUT_BUFFER_LIMIT = 256 * 1024;

// How long output must be quiet before we probe the shell process's real cwd
// from the OS (see probeCwd / scheduleCwdProbe). Prompt-text parsing misses a
// `cd` whenever the prompt doesn't print the full path (the default macOS zsh
// prompt shows only the last segment, oh-my-zsh themes abbreviate, agents draw
// their own prompt, etc.), so we ask the OS directly once things settle. The
// probe is debounced so a busy/streaming terminal never triggers it mid-run.
const CWD_PROBE_DEBOUNCE_MS = 400;

/**
 * Ask the OS for a process's current working directory by PID. This is the
 * authoritative source (it reflects `cd` regardless of what the prompt prints)
 * and works for the shell PID node-pty gives us. Platform-specific:
 *   - Linux:  read the /proc/<pid>/cwd symlink.
 *   - macOS:  `lsof -a -d cwd -p <pid> -Fn`, parse the `n` (name) field.
 *   - Windows: not supported here -- prompt-text parsing (PowerShell shows the
 *     full path) already handles the common case.
 * Returns null on any error so callers simply keep the previous cwd.
 */
async function probeCwd(pid: number): Promise<string | null> {
  if (!pid || pid <= 0) return null;
  try {
    if (process.platform === "linux") {
      const p = await fsp.readlink(`/proc/${pid}/cwd`);
      return p ? p.trim() || null : null;
    }
    if (process.platform === "darwin") {
      return await new Promise<string | null>((resolve) => {
        execFile(
          "lsof",
          ["-a", "-d", "cwd", "-p", String(pid), "-Fn"],
          { timeout: 2000 },
          (err, stdout) => {
            if (err) return resolve(null);
            // Output is field-per-line: "p<pid>", "fcwd", "n<path>". Take the
            // path from the first n-line.
            const line = stdout.split("\n").find((l) => l.startsWith("n"));
            const p = line ? line.slice(1).trim() : "";
            resolve(p || null);
          }
        );
      });
    }
    return null;
  } catch {
    return null;
  }
}

// How long to wait before the SAME terminal can raise another "input" prompt
// notification. Interactive menus redraw on every arrow-key press (the
// highlighted row moves), so without this the same "choose an option" prompt
// would re-fire on each redraw. Deliberately short: distinct prompts in
// different terminals are each allowed through immediately (see
// detectInputPrompt / the onData handler) -- the user explicitly wants every
// blocked agent surfaced even when several land in quick succession.
const INPUT_PROMPT_DEBOUNCE_MS = 6000;

// Signals that a terminal's output is an interactive prompt actively blocked
// on the user. Matches the common shapes coding agents and CLIs use: a
// highlighted selection row (❯ / › / >), a yes/no confirm, an inquirer-style
// "? question", or an explicit "press enter to continue". Kept deliberately
// broad -- a false positive costs one extra chime; a false negative means a
// stalled agent goes unnoticed, which is the failure mode we're fixing.
const INPUT_PROMPT_PATTERNS: RegExp[] = [
  /(?:^|\n)\s*[❯➜▸‣➤]\s+\S/, // highlighted selection row in a menu (agent/inquirer style)
  /\((?:y\/n|yes\/no|y\/n\/a)\)\s*[?:：]?\s*$/im, // (y/n) style confirm at end
  /\[(?:y\/n|yes\/no)\]\s*[?:：]?\s*$/im, // [y/n] style confirm at end
  /\b(?:do you want to|would you like to|are you sure|ok to proceed|overwrite\??|proceed\??|continue\??)\s*[?：]/i,
  /press\s+(?:enter|return|any key)\s+to\s+(?:continue|proceed|confirm)/i,
  /(?:^|\n)\s*\?\s+\S.+[?:]\s*$/m, // inquirer-style "? Select ...:" prompt
];

export class TerminalManager {
  private terminals = new Map<string, ActiveTerminal>();
  private shellConfigs: ShellConfig[] = [];
  private ipcWindow: BrowserWindow | null = null;
  private idleThresholdMs = 2000;
  private recentIdleNotifications: number[] = [];

  constructor() {
    this.shellConfigs = detectShells();
  }

  /** How long (ms) a terminal must be continuously busy before its next
   * quiet period is considered notification-worthy. Guards against firing
   * on every trivial command. */
  setIdleThresholdMs(ms: number): void {
    this.idleThresholdMs = Math.max(0, ms);
    logger.info(`Idle notification threshold set to ${this.idleThresholdMs}ms`);
  }

  /** Per-terminal opt-out ("Off Duty") from idle/bell attention detection. */
  setIdleDetectionEnabled(id: string, enabled: boolean): void {
    const active = this.terminals.get(id);
    if (!active) return;
    active.session.idleDetectionEnabled = enabled;
    if (!enabled) {
      active.session.needsAttention = false;
      this.clearQuietTimer(active);
    }
    active.session.updatedAt = Date.now();
  }

  /**
   * Sliding-window cap on how many attention *sounds* can play per minute
   * (see MAX_IDLE_NOTIFICATIONS_PER_MINUTE). Deliberately only gates the
   * chime, not the badge -- badges must never silently drop (that's the
   * one thing this feature can't get wrong), so the throttle only ever
   * takes away noise, never information.
   */
  private canPlayChime(): boolean {
    const oneMinuteAgo = Date.now() - 60000;
    this.recentIdleNotifications = this.recentIdleNotifications.filter((t) => t > oneMinuteAgo);
    if (this.recentIdleNotifications.length >= MAX_IDLE_NOTIFICATIONS_PER_MINUTE) {
      return false;
    }
    this.recentIdleNotifications.push(Date.now());
    return true;
  }

  /**
   * Has this terminal been typed into recently enough that a "settled" or
   * "bell" signal right now is more likely keyboard noise (a pause mid-
   * prompt, a backspace-on-empty beep, a failed tab-complete) than an
   * actual finished task? See TYPING_GRACE_MS for why the window has to be
   * longer than QUIET_MS to matter for the idle path; it applies just as
   * well to bell, since readline/shell beeps fire in the same onData burst
   * as the keystroke that caused them.
   */
  private wasRecentlyTyped(active: ActiveTerminal): boolean {
    if (active.lastInputAt === null) return false;
    return Date.now() - active.lastInputAt < TYPING_GRACE_MS;
  }

  private clearQuietTimer(active: ActiveTerminal): void {
    if (active.quietTimer) {
      clearTimeout(active.quietTimer);
      active.quietTimer = null;
    }
    active.busyStartedAt = null;
    // Called on every teardown path (kill/restart/dispose), so also stop the
    // pending cwd probe here rather than leaking a stray timer.
    if (active.cwdProbeTimer) {
      clearTimeout(active.cwdProbeTimer);
      active.cwdProbeTimer = null;
    }
  }

  /**
   * Track cursor visibility from \x1b[?25l (hide) / \x1b[?25h (show) codes
   * seen in this chunk. A chunk can contain several of these (e.g. a
   * spinner frame hides then re-shows), so take whichever appears last.
   * This is a suppression-only signal (see the idle timer below): it can
   * delay/mute a false "idle" flag, but a shell that never emits these
   * codes just keeps the default (visible) and behaves exactly as before.
   */
  private updateCursorVisibility(active: ActiveTerminal, data: string): void {
    const lastHide = data.lastIndexOf("\x1b[?25l");
    const lastShow = data.lastIndexOf("\x1b[?25h");
    if (lastHide === -1 && lastShow === -1) return;
    active.cursorVisible = lastShow > lastHide;
  }

  /**
   * Does this output chunk look like an interactive prompt waiting on the
   * user? Escape codes (colors, cursor moves, the highlight SGR on a selected
   * menu row) are stripped first so the patterns see plain text. This is an
   * additive signal only -- it can raise a notification but never suppress
   * one.
   */
  private looksLikeInputPrompt(data: string): boolean {
    if (!data.includes("\n") && data.length < 2) return false;
    const clean = stripInputEscapeSequences(data);
    // Only the tail matters for "waiting on you" prompts, and it keeps the
    // regex work bounded on large chunks.
    const tail = clean.length > 1200 ? clean.slice(-1200) : clean;
    return INPUT_PROMPT_PATTERNS.some((re) => re.test(tail));
  }

  /**
   * Flag a terminal for attention. `chime` controls only whether the
   * renderer should play a sound for this occurrence -- the badge
   * (needsAttention) is always set, since missing that a terminal finished
   * is worse than an occasional silent one.
   */
  private flagAttention(id: string, reason: AttentionReason, chime: boolean): void {
    const active = this.terminals.get(id);
    if (!active) return;
    if (!active.session.idleDetectionEnabled) return;
    if (active.session.status !== "running") return;

    active.session.needsAttention = true;
    active.session.attentionReason = reason;
    active.session.lastAttentionAt = Date.now();
    active.session.updatedAt = Date.now();

    if (this.ipcWindow && !this.ipcWindow.isDestroyed()) {
      this.ipcWindow.webContents.send("terminal:attention", { terminalId: id, reason, chime });
    }
    logger.debug(`Terminal ${id} flagged for attention (${reason}, chime=${chime})`);
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
    // process.cwd() is meaningless for a packaged desktop app (it's wherever
    // the OS happened to launch the process from). Home directory matches
    // what a normal terminal app opens into.
    const cwd = options.cwd ?? os.homedir();

    // Spawn the PTY process
    const pty = spawn(shellConfig.path, shellConfig.args, {
      name: "xterm-256color",
      cols,
      rows,
      cwd,
      env: process.env as { [key: string]: string },
      // ConPTY is a Windows-only backend; node-pty ignores this on
      // macOS/Linux, but keep it explicit so intent is clear per platform.
      ...(process.platform === "win32" ? { useConpty: true } : {}),
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
      repoRoot: findRepoRoot(cwd),
      fileRoot: resolveFileRoot(cwd),
      fileRootPinned: false,
      openFiles: [],
      activeFile: null,
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
        width: options.width ?? 900,
        height: options.height ?? 760,
      },
      naming: {
        enabled: true,
        lastNamedAt: null,
        lastNameReason: null,
        pending: false,
        error: null,
      },
      needsAttention: false,
      lastAttentionAt: null,
      attentionReason: null,
      idleDetectionEnabled: true,
      activeAgent: null,
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
        // Larger rolling buffer for replay-on-mount (Focus stage <-> canvas).
        active.outputBuffer += data;
        if (active.outputBuffer.length > OUTPUT_BUFFER_LIMIT) {
          active.outputBuffer = active.outputBuffer.slice(-OUTPUT_BUFFER_LIMIT);
        }
        this.updateCursorVisibility(active, data);
      }

      // Forward data to renderer
      if (this.ipcWindow && !this.ipcWindow.isDestroyed()) {
        this.ipcWindow.webContents.send("terminal:data", { terminalId: id, data });
      }

      // Attempt CWD detection from prompt-like output (fast path), plus an
      // authoritative OS-level probe once output settles (catches `cd` even
      // when the prompt never prints the full path).
      this.detectCwdChange(data, session);
      this.scheduleCwdProbe(id);

      // First shell prompt seen -- safe to inject an auto-run command now
      // (rc files have finished loading). See checkPromptReady.
      this.checkPromptReady(data, id);

      // Bell (\x07) is usually an explicit "look at me" signal many CLIs
      // (including coding agents) send on completion -- flag immediately
      // regardless of how long the command has been running. But readline/
      // shells also ring it for mundane keystroke feedback (backspace on an
      // empty line, a failed tab-complete), which fires in the very same
      // onData burst as the keystroke that caused it -- skip those so
      // ordinary typing doesn't chime.
      if (active && data.includes("\x07") && !this.wasRecentlyTyped(active)) {
        this.flagAttention(id, "bell", this.canPlayChime());
      }

      // Interactive prompt actively waiting on the user (a "choose an option"
      // menu, a (y/n) confirm, etc.). This is the highest-priority signal: it
      // always chimes and bypasses the idle-notification throttle entirely, so
      // a blocked coding agent is never missed even when several prompts land
      // in a short window. Per-terminal debounced so a menu redrawing on each
      // arrow-key press only notifies once.
      if (
        active &&
        active.session.idleDetectionEnabled &&
        !this.wasRecentlyTyped(active) &&
        this.looksLikeInputPrompt(data)
      ) {
        const sinceLast = active.lastInputPromptAt
          ? Date.now() - active.lastInputPromptAt
          : Infinity;
        if (sinceLast > INPUT_PROMPT_DEBOUNCE_MS) {
          active.lastInputPromptAt = Date.now();
          // chime=true unconditionally -- bypasses canPlayChime()'s per-minute
          // idle throttle. The renderer still honours the global sound-mute.
          this.flagAttention(id, "input", true);
        }
      }

      // Idle heuristic: (re)start a quiet-period timer on every chunk. If
      // no more output arrives before it fires, the terminal has "settled"
      // -- and if it was busy for at least idleThresholdMs beforehand, that
      // settling is worth surfacing (heuristic for "the command/agent
      // finished and is waiting on you").
      if (active) {
        if (active.busyStartedAt === null) {
          active.busyStartedAt = Date.now();
        }
        if (active.quietTimer) clearTimeout(active.quietTimer);
        active.quietTimer = setTimeout(() => {
          const stillActive = this.terminals.get(id);
          if (!stillActive) return;
          const busyDuration = stillActive.busyStartedAt
            ? Date.now() - stillActive.busyStartedAt
            : 0;
          stillActive.busyStartedAt = null;
          stillActive.quietTimer = null;
          // Suppress if the terminal's own UI has the cursor hidden -- a
          // common convention for "still actively rendering" (spinners,
          // progress bars, "thinking" indicators) as opposed to idle at an
          // input prompt (cursor shown). This can only mute a flag, never
          // cause one: terminals that never touch cursor visibility default
          // to true and are unaffected.
          const cursorSuppressed = stillActive.cursorVisible === false;
          // Suppress if the user was typing here moments ago -- a pause
          // mid-sentence while composing a prompt looks identical to "the
          // command settled" from pure output timing alone (see
          // TYPING_GRACE_MS above for why this only matters right after
          // typing stops, not during a genuine long-running agent turn).
          if (
            busyDuration >= this.idleThresholdMs &&
            !cursorSuppressed &&
            !this.wasRecentlyTyped(stillActive)
          ) {
            this.flagAttention(id, "idle", this.canPlayChime());
          }
        }, QUIET_MS);
      }
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
      outputBuffer: "",
      shellConfig,
      spawnOptions: { ...options },
      promptHistory: [],
      busyStartedAt: null,
      quietTimer: null,
      promptSeen: false,
      cursorVisible: true,
      lastInputAt: null,
      lastInputPromptAt: null,
      cwdProbeTimer: null,
      // Grants the file IPC read/write access to this terminal's project folder.
      // Nothing outside a live terminal's root (or a folder the user picked in a
      // native dialog) is reachable from the renderer -- see util/path-guard.
      releaseFileRoot: registerRoot(session.fileRoot),
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

    active.pty.write(data); // raw, unmodified -- the shell/program must still see everything
    active.session.lastActivityAt = Date.now();
    active.lastInputAt = Date.now();

    // Track input buffer for prompt capture. Strip control/escape sequences
    // first (arrow keys, mouse-tracking reports, paste markers, etc. --
    // see stripInputEscapeSequences) and walk what's left character by
    // character, since a single onData chunk can bundle e.g. a mouse report
    // followed by an Enter keystroke.
    const cleaned = stripInputEscapeSequences(data);
    for (let i = 0; i < cleaned.length; i++) {
      const ch = cleaned[i];
      const code = ch.charCodeAt(0);
      if (ch === "\r") {
        // Enter. Some pipelines pair CR with a following LF for a single
        // keypress ("\r\n") -- consume it too so it isn't then treated as
        // a Ctrl+J newline-insert into the *next* prompt's buffer.
        this.flushInputBuffer(id);
        if (cleaned[i + 1] === "\n") i++;
      } else if (ch === "\n") {
        // A bare LF (no preceding CR) is Ctrl+J in most shells and coding-
        // agent CLIs: "insert a newline without submitting," distinct from
        // Enter's \r above. Treating it as a submit was capturing a single
        // multi-line prompt as several separate ones the moment Ctrl+J was
        // used to compose it.
        active.inputBuffer += "\n";
      } else if (code === 127) {
        // Backspace: remove last char from buffer
        active.inputBuffer = active.inputBuffer.slice(0, -1);
      } else if (code < 32) {
        // Control character (e.g., Ctrl+C, Tab), ignore for buffer
      } else {
        active.inputBuffer += ch;
      }
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
    this.clearQuietTimer(active);
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
    this.clearQuietTimer(active);
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

    // Remove old entry. Release its file-root grant first -- the replacement
    // terminal takes its own, and leaving this one held would keep the folder
    // readable for the rest of the session.
    active.releaseFileRoot?.();
    active.releaseFileRoot = null;
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

  /** Recent raw output for replay into a freshly-mounted xterm (Focus stage). */
  getBuffer(id: string): string {
    return this.terminals.get(id)?.outputBuffer ?? "";
  }

  getAllSessions(): TerminalSession[] {
    return Array.from(this.terminals.values()).map((a) => ({ ...a.session }));
  }

  cleanupAll(): void {
    logger.info(`Cleaning up ${this.terminals.size} terminals`);
    for (const [, active] of this.terminals) {
      this.clearQuietTimer(active);
      active.releaseFileRoot?.();
      active.releaseFileRoot = null;
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

  /** Expand a leading "~" (as shown by the default zsh/bash prompt) to an absolute path. */
  private expandTilde(p: string): string {
    if (p === "~") return os.homedir();
    if (p.startsWith("~/")) return path.join(os.homedir(), p.slice(2));
    return p;
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
   * Fire terminal:ready exactly once per session, the first time output
   * looks like a shell prompt (same heuristic as detectCwdChange, but
   * unconditional on whether the cwd actually changed -- a terminal that
   * starts in its default directory never trips the cwd-change branch).
   * This is what gates auto-run commands (see CreateTerminalOptions):
   * injecting text before the shell has finished loading its rc files
   * would land in the wrong place or get silently eaten.
   */
  private checkPromptReady(data: string, id: string): void {
    const active = this.terminals.get(id);
    if (!active || active.promptSeen) return;

    // Real prompt output is riddled with SGR/cursor/bracketed-paste escape
    // codes (e.g. the zsh default prompt arrives as
    // "...% \x1b[K\x1b[?2004h", not a clean "...% "), which defeats a
    // naive end-of-string regex match -- strip them first, same as input
    // bookkeeping does for the opposite direction (see prompt-capture.ts).
    const clean = stripInputEscapeSequences(data);
    const looksLikePrompt =
      /([A-Za-z]:\\[^:]+)>/.test(clean) || /[:\s]((?:~|\/)[\w\-/.\s]*)\s*[$#%]\s*$/m.test(clean);
    if (!looksLikePrompt) return;

    active.promptSeen = true;
    if (this.ipcWindow && !this.ipcWindow.isDestroyed()) {
      this.ipcWindow.webContents.send("terminal:ready", { terminalId: id });
    }
  }

  /**
   * (Re)arm the debounced OS cwd probe. Every output chunk pushes it back, so
   * the probe only fires once a terminal has been quiet for
   * CWD_PROBE_DEBOUNCE_MS -- i.e. it's sitting at a prompt, exactly when a `cd`
   * would have taken effect.
   */
  private scheduleCwdProbe(id: string): void {
    const active = this.terminals.get(id);
    if (!active) return;
    if (active.cwdProbeTimer) clearTimeout(active.cwdProbeTimer);
    active.cwdProbeTimer = setTimeout(() => {
      const still = this.terminals.get(id);
      if (still) still.cwdProbeTimer = null;
      void this.probeAndUpdateCwd(id);
    }, CWD_PROBE_DEBOUNCE_MS);
  }

  /**
   * Apply a newly-detected cwd to a session: derived labels, the enclosing repo
   * root, the folder the file explorer is rooted at, and the renderer event.
   *
   * All three cwd detectors (the OS probe and the two prompt-text regexes) funnel
   * through here so they can't drift apart -- and so the file-root grant is
   * always released and re-taken together with the cwd it was derived from.
   */
  private applyCwdChange(id: string, detected: string): void {
    const active = this.terminals.get(id);
    if (!active || active.session.cwd === detected) return;

    const session = active.session;
    session.cwd = detected;
    session.cwdLabel = this.shortenCwd(detected);
    session.projectName = this.extractProjectName(detected);
    session.repoRoot = findRepoRoot(detected);
    session.updatedAt = Date.now();

    // Follow the cwd only while the user hasn't pinned a root themselves: once
    // they've picked a folder in the drawer, `cd`-ing around shouldn't yank the
    // tree out from under them.
    if (!session.fileRootPinned) {
      const nextRoot = resolveFileRoot(detected);
      if (nextRoot !== session.fileRoot) {
        active.releaseFileRoot?.();
        session.fileRoot = nextRoot;
        active.releaseFileRoot = registerRoot(nextRoot);
      }
    }

    if (this.ipcWindow && !this.ipcWindow.isDestroyed()) {
      this.ipcWindow.webContents.send("terminal:cwdChanged", {
        terminalId: id,
        cwd: detected,
        repoRoot: session.repoRoot,
        fileRoot: session.fileRoot,
      });
    }
  }

  /**
   * Pin the file explorer to a specific folder for this terminal (the drawer's
   * "Open folder…"). Pinning also grants read/write access to that tree.
   */
  setFileRoot(id: string, dir: string): void {
    const active = this.terminals.get(id);
    if (!active || !dir) return;
    active.releaseFileRoot?.();
    active.session.fileRoot = dir;
    active.session.fileRootPinned = true;
    active.session.updatedAt = Date.now();
    active.releaseFileRoot = registerRoot(dir);

    if (this.ipcWindow && !this.ipcWindow.isDestroyed()) {
      this.ipcWindow.webContents.send("terminal:cwdChanged", {
        terminalId: id,
        cwd: active.session.cwd,
        repoRoot: active.session.repoRoot,
        fileRoot: dir,
      });
    }
  }

  /** Remember which files a terminal has open, so a saved workspace can restore its tabs. */
  setOpenFiles(id: string, openFiles: string[], activeFile: string | null): void {
    const active = this.terminals.get(id);
    if (!active) return;
    active.session.openFiles = openFiles;
    active.session.activeFile = activeFile;
  }

  /**
   * Probe the shell's real cwd from the OS and, if it changed, update the
   * session and notify the renderer.
   */
  private async probeAndUpdateCwd(id: string): Promise<void> {
    const active = this.terminals.get(id);
    if (!active || active.session.status !== "running") return;
    const detected = await probeCwd(active.pty.pid);
    if (!detected) return;
    // The terminal may have been torn down while lsof was running.
    this.applyCwdChange(id, detected);
  }

  /**
   * Attempt to detect CWD changes from shell prompt output.
   * This is a heuristic based on common shell prompt patterns.
   */
  private detectCwdChange(data: string, session: TerminalSession): void {
    // Strip SGR/cursor/bracketed-paste escape codes first -- the real
    // prompt line is riddled with them (e.g. "...% \x1b[K\x1b[?2004h"),
    // which silently defeats these end-of-string regexes most of the time.
    data = stripInputEscapeSequences(data);

    // Look for PowerShell prompt pattern: C:\Users\...>
    const psMatch = data.match(/([A-Za-z]:\\[^:]+)>/);
    if (psMatch && psMatch[1]) {
      const detectedCwd = psMatch[1].trim();
      if (detectedCwd.length > 2) {
        this.applyCwdChange(session.id, detectedCwd);
      }
      return;
    }

    // Look for bash/zsh-like prompt: user@host:/path$ , /path # , or the
    // default zsh prompt which shows "~" / "~/sub/dir" and ends in "%".
    const bashMatch = data.match(/[:\s]((?:~|\/)[\w\-/.\s]*)\s*[\$#%]\s*$/m);
    if (bashMatch && bashMatch[1]) {
      const detectedCwd = this.expandTilde(bashMatch[1].trim());
      if (detectedCwd.length > 1) {
        this.applyCwdChange(session.id, detectedCwd);
      }
    }
  }
}

export const terminalManager = new TerminalManager();
