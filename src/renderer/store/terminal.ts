import { defineStore } from "pinia";
import { ref, computed, triggerRef } from "vue";
import type {
  TerminalSession,
  ShellInfo,
  CreateTerminalOptions,
} from "@renderer/type/terminal";
import type { Group } from "@renderer/type/workspace";
import { findNonOverlappingPosition } from "@renderer/util/placement";
import { playAttentionChime } from "@renderer/util/sound";
import { useUIStore } from "@renderer/store/ui";
import { useWorkspaceStore } from "@renderer/store/workspace";
import { detectAgentFromCommand } from "@renderer/util/agents";

/**
 * Pinia store for managing terminal sessions.
 * Handles session lifecycle, selection, focus, and IPC event listeners.
 */
export const useTerminalStore = defineStore("terminal", () => {
  // ─── State ───────────────────────────────────────────────────────
  const sessions = ref<Map<string, TerminalSession>>(new Map());
  const shells = ref<ShellInfo[]>([]);
  const focusedTerminalId = ref<string | null>(null);
  const selectedTerminalIds = ref<Set<string>>(new Set());
  const sessionDefaultShellId = ref<string | null>(null);

  // ─── Getters ─────────────────────────────────────────────────────
  const allSessions = computed(() => Array.from(sessions.value.values()));

  const runningSessions = computed(() =>
    allSessions.value.filter((s) => s.status === "running")
  );

  const sessionCount = computed(() => allSessions.value.length);

  const focusedSession = computed(() =>
    focusedTerminalId.value
      ? sessions.value.get(focusedTerminalId.value) || null
      : null
  );

  const getSession = computed(
    () => (id: string) => sessions.value.get(id) || null
  );

  const sessionsInGroup = computed(
    () => (groupId: string) =>
      allSessions.value.filter((s) => s.groupId === groupId)
  );

  const selectedSessions = computed(() =>
    Array.from(selectedTerminalIds.value)
      .map((id) => sessions.value.get(id))
      .filter(Boolean) as TerminalSession[]
  );

  /** Terminals currently flagged for attention, most-recently-flagged first --
   * the order the "jump to idle terminal" toolbar button steps through. */
  const attentionSessions = computed(() =>
    allSessions.value
      .filter((s) => s.needsAttention)
      .sort((a, b) => (b.lastAttentionAt ?? 0) - (a.lastAttentionAt ?? 0))
  );

  // ─── Actions ─────────────────────────────────────────────────────

  /**
   * Create a new terminal session via main process.
   * Computes a non-overlapping canvas position automatically.
   */
  async function createSession(
    options: CreateTerminalOptions & {
      x?: number;
      y?: number;
      viewport?: { x: number; y: number; zoom: number } | null;
      groups?: Group[];
      /** Typed and submitted automatically once the shell's first prompt appears (see scheduleAutoRun). */
      autoRunCommand?: string;
    }
  ): Promise<TerminalSession> {
    // New terminals spawn at the user-configurable default box size
    // (Settings > General > Default Terminal Size); explicit width/height
    // (e.g. restoring a saved workspace layout) still win via updateNode
    // right after creation.
    const workspaceStore = useWorkspaceStore();
    const defaultSize = workspaceStore.settings.defaultTerminalSize;

    const session = await window.api.terminal.create({
      shellId: options.shellId,
      cols: options.cols || 80,
      rows: options.rows || 24,
      cwd: options.cwd,
      id: options.id,
      width: options.width ?? defaultSize?.width ?? 900,
      height: options.height ?? defaultSize?.height ?? 760,
    });

    session.activeAgent = null;

    // Use explicit position if provided, otherwise find non-overlapping position
    if (options.x !== undefined && options.y !== undefined) {
      session.node.x = options.x;
      session.node.y = options.y;
    } else {
      const pos = findNonOverlappingPosition(
        allSessions.value,
        options.groups || [],
        options.viewport || null,
        null,
        { width: session.node.width, height: session.node.height }
      );
      session.node.x = pos.x;
      session.node.y = pos.y;
    }

    sessions.value.set(session.id, session);

    if (options.autoRunCommand) {
      scheduleAutoRun(session.id, options.autoRunCommand);
    }

    // Reveal genuinely-new terminals on the canvas (center+focus or a
    // pointer arrow, per the user's setting). Skip workspace restores --
    // those pass the saved id + explicit x/y and would otherwise fire a
    // reveal for every terminal on load.
    // A freshly-created terminal always centers and takes focus (focus: true)
    // regardless of the "arrow" placement preference, so the user can start
    // typing into it immediately without hunting for it on the canvas.
    if (options.id === undefined) {
      const uiStore = useUIStore();
      uiStore.revealNewItem({ ...session.node, id: session.id, focus: true });
    }

    return session;
  }

  /**
   * Type and submit a command automatically once a freshly-created
   * terminal's shell has printed its first prompt (see terminal:ready /
   * checkPromptReady in the main process). Injecting text before then would
   * land before rc files finish loading -- either getting silently eaten or
   * landing in the wrong place. Falls back to a fixed delay if no prompt is
   * ever detected (an unusual custom prompt that doesn't match the shared
   * heuristic), so the command still runs rather than silently never firing.
   */
  function scheduleAutoRun(terminalId: string, command: string): void {
    let fired = false;
    const run = () => {
      if (fired) return;
      fired = true;
      unsubscribe();
      clearTimeout(fallbackTimer);
      const s = sessions.value.get(terminalId);
      if (s && s.status === "running") {
        writeToTerminal(terminalId, command + "\r");
      }
    };
    const unsubscribe = window.api.terminal.onReady(({ terminalId: readyId }) => {
      if (readyId === terminalId) run();
    });
    const fallbackTimer = setTimeout(run, 4000);
  }

  /**
   * Kill a terminal session (sends SIGKILL to the PTY process).
   */
  async function killSession(id: string): Promise<void> {
    await window.api.terminal.kill(id);
    const s = sessions.value.get(id);
    if (s) {
      s.status = "killed";
      s.updatedAt = Date.now();
    }
  }

  /**
   * Restart a terminal session with the same shell config.
   * Preserves the node's canvas position and dimensions.
   */
  async function restartSession(id: string): Promise<TerminalSession> {
    const old = sessions.value.get(id);
    const node = old?.node;

    const newSession = await window.api.terminal.restart(id);

    if (node) {
      newSession.node = { ...node };
    }
    // Fresh process -- whatever was running before is gone.
    newSession.activeAgent = null;

    sessions.value.set(newSession.id, newSession);

    // If the old session had a manual name, preserve it
    if (old?.manualName) {
      newSession.manualName = old.manualName;
      newSession.name = old.manualName;
    }

    return newSession;
  }

  /**
   * Update arbitrary session properties.
   */
  /**
   * Apply a file-drawer width change to every node that currently has one open.
   *
   * The drawer width is a single global preference, but each open drawer's width
   * is baked into its node's x/width. Without this, resizing one terminal's
   * drawer would leave every other open drawer rendering at the new width inside
   * a box sized for the old one -- and closing it would then subtract a number
   * that was never added, permanently shrinking the node.
   */
  function adjustOpenDrawerNodes(delta: number, exceptId?: string): void {
    if (delta === 0) return;
    for (const session of sessions.value.values()) {
      if (!session.fileDrawerOpen || session.id === exceptId) continue;
      updateNode(session.id, {
        x: session.node.x - delta,
        width: session.node.width + delta,
      });
    }
  }

  function updateSession(id: string, patch: Partial<TerminalSession>): void {
    const s = sessions.value.get(id);
    if (s) {
      Object.assign(s, patch);
      s.updatedAt = Date.now();
    }
  }

  /**
   * Update the canvas node position/size for a session.
   */
  function updateNode(
    id: string,
    node: { x?: number; y?: number; width?: number; height?: number }
  ): void {
    const s = sessions.value.get(id);
    if (s) {
      if (node.x !== undefined) s.node.x = node.x;
      if (node.y !== undefined) s.node.y = node.y;
      if (node.width !== undefined) s.node.width = node.width;
      if (node.height !== undefined) s.node.height = node.height;
      s.updatedAt = Date.now();
      // Force reactivity so computed getters depending on the Map
      // iteration (e.g. allSessions -> terminalNodes) recompute.
      triggerRef(sessions);
    }
  }

  /**
   * Remove a session from the store entirely.
   */
  function removeSession(id: string): void {
    sessions.value.delete(id);
    if (focusedTerminalId.value === id) focusedTerminalId.value = null;
    selectedTerminalIds.value.delete(id);
  }

  /**
   * Set which terminal is currently focused (receives keyboard input).
   * Viewing/focusing a terminal counts as having "seen" it, so this also
   * clears its attention flag (bell/idle notification), matching how most
   * apps treat unread badges.
   */
  function setFocused(id: string | null): void {
    focusedTerminalId.value = id;
    if (id) {
      const s = sessions.value.get(id);
      if (s) s.needsAttention = false;
    }
  }

  /**
   * Toggle idle/bell attention detection for a single terminal ("Off Duty").
   */
  async function setIdleDetectionEnabled(id: string, enabled: boolean): Promise<void> {
    await window.api.terminal.setIdleDetectionEnabled(id, enabled);
    const s = sessions.value.get(id);
    if (s) {
      s.idleDetectionEnabled = enabled;
      if (!enabled) s.needsAttention = false;
      s.updatedAt = Date.now();
    }
  }

  /**
   * Replace the current selection with a new set of terminal IDs.
   */
  function setSelected(ids: string[]): void {
    selectedTerminalIds.value = new Set(ids);
  }

  /**
   * Toggle a single terminal ID in the selection.
   */
  function toggleSelected(id: string): void {
    if (selectedTerminalIds.value.has(id)) {
      selectedTerminalIds.value.delete(id);
    } else {
      selectedTerminalIds.value.add(id);
    }
  }

  /**
   * Clear all selected terminals.
   */
  function clearSelection(): void {
    selectedTerminalIds.value.clear();
  }

  /**
   * Load available shells from the main process.
   */
  async function loadShells(): Promise<void> {
    shells.value = await window.api.terminal.listShells();
  }

  /**
   * Manually set a session name (overrides auto-naming).
   */
  function updateSessionName(id: string, name: string): void {
    const s = sessions.value.get(id);
    if (s) {
      s.manualName = name;
      s.name = name;
      s.updatedAt = Date.now();
    }
  }

  /**
   * Set an auto-generated name (only if user hasn't manually renamed).
   */
  function setAutoName(id: string, name: string): void {
    const s = sessions.value.get(id);
    if (s && !s.manualName) {
      s.autoName = name;
      s.name = name;
      s.updatedAt = Date.now();
    }
  }

  /**
   * Resize a terminal's PTY dimensions.
   */
  async function resizeTerminal(
    id: string,
    cols: number,
    rows: number
  ): Promise<void> {
    await window.api.terminal.resize(id, cols, rows);
    const s = sessions.value.get(id);
    if (s) {
      s.cols = cols;
      s.rows = rows;
      s.updatedAt = Date.now();
    }
  }

  /**
   * Write data to a terminal's PTY stdin.
   */
  async function writeToTerminal(id: string, data: string): Promise<void> {
    await window.api.terminal.write(id, data);
  }

  /**
   * Clear a terminal's screen.
   */
  async function clearTerminal(id: string): Promise<void> {
    await window.api.terminal.clear(id);
  }

  /**
   * Open the terminal's current working directory in Windows Explorer.
   */
  async function openCwdInExplorer(id: string): Promise<void> {
    await window.api.terminal.openCwdInExplorer(id);
  }

  /**
   * Best-effort detection of a coding-agent CLI (Claude Code, Codex, Kimi,
   * etc.) starting or exiting in a terminal, driven by what the user typed
   * at the shell. Called from the prompt-capture listener below. See
   * detectAgentFromCommand for why this is intentionally sticky.
   */
  function detectAgentFromPrompt(id: string, text: string): void {
    const s = sessions.value.get(id);
    if (!s) return;
    const result = detectAgentFromCommand(text);
    if (result.action === "start" && s.activeAgent !== result.agent) {
      s.activeAgent = result.agent;
      s.updatedAt = Date.now();
    } else if (result.action === "stop" && s.activeAgent) {
      s.activeAgent = null;
      s.updatedAt = Date.now();
    }
  }

  // ─── IPC Listeners ───────────────────────────────────────────────

  /**
   * Set up all IPC event listeners from the main process.
   * Call this once during app initialization.
   */
  function setupListeners(): void {
    // Terminal output data — xterm components subscribe directly,
    // but we track lastActivityAt here
    window.api.terminal.onData(({ terminalId }) => {
      const s = sessions.value.get(terminalId);
      if (s) {
        s.lastActivityAt = Date.now();
      }
    });

    // Terminal process exited
    window.api.terminal.onExit(({ terminalId, exitCode }) => {
      const s = sessions.value.get(terminalId);
      if (s) {
        s.status = exitCode === 0 ? "exited" : "crashed";
        s.exitCode = exitCode;
        s.exitedAt = Date.now();
        s.activeAgent = null;
        s.updatedAt = Date.now();
      }
    });

    // Current working directory changed
    window.api.terminal.onCwdChanged(({ terminalId, cwd, repoRoot, fileRoot }) => {
      const s = sessions.value.get(terminalId);
      if (s) {
        s.cwd = cwd;
        s.projectName = cwd.split(/[\\/]/).pop() || null;
        s.cwdLabel = cwd.length > 40 ? "..." + cwd.slice(-37) : cwd;
        s.repoRoot = repoRoot ?? null;
        // The pinned case is authoritative on this side -- main only recomputes
        // fileRoot when it isn't pinned, and echoes the pinned value back.
        if (!s.fileRootPinned && fileRoot) s.fileRoot = fileRoot;
        s.updatedAt = Date.now();
      }
    });

    // The running program retitled itself (OSC 0/1/2). Stored raw; whether it
    // becomes the visible name is decided in util/sessionName.ts.
    window.api.terminal.onTitle(({ terminalId, title }) => {
      const s = sessions.value.get(terminalId);
      if (s) s.oscTitle = title || null;
    });

    // Prompt captured from terminal input
    window.api.prompt.onAdd(({ terminalId, text }) => {
      const s = sessions.value.get(terminalId);
      if (s) {
        s.promptCount += 1;
        s.lastPromptAt = Date.now();
        s.updatedAt = Date.now();
      }
      detectAgentFromPrompt(terminalId, text);
    });

    // Terminal auto-renamed by Groq or fallback
    window.api.terminal.onRenamed(({ terminalId, name }) => {
      const s = sessions.value.get(terminalId);
      if (s && !s.manualName) {
        s.autoName = name;
        s.name = name;
        s.updatedAt = Date.now();
      }
    });

    // Terminal needs attention (idle after being busy, or rang the bell).
    // Fires regardless of focus -- being focused doesn't mean you're
    // actively watching it finish (you could be scrolled up reading old
    // output, or focus could just be stale from whatever you clicked last),
    // so the badge should still confirm it's done. The sound is throttled
    // separately by the main process (see MAX_IDLE_NOTIFICATIONS_PER_MINUTE)
    // -- `chime` reflects that decision, so the badge is never dropped even
    // when the sound is.
    window.api.terminal.onAttention(({ terminalId, reason, chime }) => {
      const s = sessions.value.get(terminalId);
      if (!s) return;

      s.needsAttention = true;
      s.attentionReason = reason;
      s.lastAttentionAt = Date.now();
      s.updatedAt = Date.now();

      const uiStore = useUIStore();
      if (chime && !uiStore.soundMuted) {
        playAttentionChime();
      }
    });
  }

  return {
    // State
    sessions,
    shells,
    focusedTerminalId,
    selectedTerminalIds,
    // Getters
    allSessions,
    runningSessions,
    sessionCount,
    focusedSession,
    getSession,
    sessionsInGroup,
    selectedSessions,
    attentionSessions,
    // Actions
    createSession,
    killSession,
    restartSession,
    updateSession,
    updateNode,
    adjustOpenDrawerNodes,
    removeSession,
    setFocused,
    setSelected,
    toggleSelected,
    clearSelection,
    loadShells,
    sessionDefaultShellId,
    updateSessionName,
    setAutoName,
    resizeTerminal,
    writeToTerminal,
    clearTerminal,
    openCwdInExplorer,
    setIdleDetectionEnabled,
    setupListeners,
  };
});
