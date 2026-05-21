import { defineStore } from "pinia";
import { ref, computed, triggerRef } from "vue";
import type {
  TerminalSession,
  ShellInfo,
  CreateTerminalOptions,
} from "@renderer/type/terminal";
import type { Group } from "@renderer/type/workspace";
import { findNonOverlappingPosition } from "@renderer/util/placement";

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
  const snapshotCallbacks = ref<Map<string, () => string>>(new Map());
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
    }
  ): Promise<TerminalSession> {
    const session = await window.api.terminal.create({
      shellId: options.shellId,
      cols: options.cols || 80,
      rows: options.rows || 24,
      cwd: options.cwd,
      id: options.id,
    });

    // Apply default node size if not set
    if (!session.node.width) session.node.width = 640;
    if (!session.node.height) session.node.height = 400;

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
    return session;
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
   */
  function setFocused(id: string | null): void {
    focusedTerminalId.value = id;
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

  // ─── IPC Listeners ───────────────────────────────────────────────

  /**
   * Register a callback to capture a terminal's buffer snapshot.
   * Called by XtermView on mount.
   */
  function registerSnapshotCallback(id: string, callback: () => string): void {
    snapshotCallbacks.value.set(id, callback);
  }

  /**
   * Unregister a snapshot callback.
   * Called by XtermView on unmount.
   */
  function unregisterSnapshotCallback(id: string): void {
    snapshotCallbacks.value.delete(id);
  }

  /**
   * Capture snapshots from all registered terminals.
   * Returns a map of terminalId → serialized buffer.
   */
  function captureAllSnapshots(): Record<string, string> {
    const result: Record<string, string> = {};
    for (const [id, callback] of snapshotCallbacks.value.entries()) {
      try {
        result[id] = callback();
      } catch (err) {
        console.error(`[TerminalStore] Failed to capture snapshot for ${id}`, err);
      }
    }
    return result;
  }

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
        s.updatedAt = Date.now();
      }
    });

    // Current working directory changed
    window.api.terminal.onCwdChanged(({ terminalId, cwd }) => {
      const s = sessions.value.get(terminalId);
      if (s) {
        s.cwd = cwd;
        s.projectName = cwd.split(/[\\/]/).pop() || null;
        s.cwdLabel = cwd.length > 40 ? "..." + cwd.slice(-37) : cwd;
        s.updatedAt = Date.now();
      }
    });

    // Prompt captured from terminal input
    window.api.prompt.onAdd(({ terminalId }) => {
      const s = sessions.value.get(terminalId);
      if (s) {
        s.promptCount += 1;
        s.lastPromptAt = Date.now();
        s.updatedAt = Date.now();
      }
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
    // Actions
    createSession,
    killSession,
    restartSession,
    updateSession,
    updateNode,
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
    setupListeners,
    registerSnapshotCallback,
    unregisterSnapshotCallback,
    captureAllSnapshots,
  };
});
