import { acceptHMRUpdate, defineStore } from "pinia";
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
import { useFileStore } from "@renderer/store/file";
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
      /**
       * Center the canvas on the new terminal and focus it. Default true.
       * Option-drag duplication sets this false: the copy lands exactly where
       * the user dropped it, and yanking the viewport there -- or moving
       * keyboard focus off the session they were watching -- is the opposite
       * of what that gesture promises.
       */
      reveal?: boolean;
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

    // Whether a new terminal opens showing its files is the user's call
    // (Settings > General > "Open the file explorer in new terminals").
    //
    // Still conditional on there being a project to show: `options.cwd` means
    // the directory was chosen deliberately (the New Terminal dialog, a folder
    // opened from Finder), and `repoRoot` catches a terminal that landed inside
    // a repo anyway. Main falls back to the home directory when neither caller
    // nor detection supplies a cwd, and a 240px-wide tree of someone's home
    // folder is not what "show me my files" means -- those stay closed, and the
    // header's Files button still opens them on demand.
    //
    // `options.id === undefined` is the same check the reveal-new-item logic
    // below uses to distinguish a genuinely new terminal from a workspace
    // restore -- a restore always passes the saved id, and its drawer state
    // comes from the saved workspace instead.
    //
    // The width bump is not cosmetic: an open drawer's width is baked into its
    // node's geometry (see TerminalNode's toggleDrawer), so a node opened
    // without it would shrink by a width it never had the first time the user
    // closes the drawer. It also has to happen before placement below, which
    // reads node.width to find a non-overlapping spot.
    if (options.id === undefined && (options.cwd || session.repoRoot)) {
      const uiStore = useUIStore();
      if (uiStore.fileExplorerDefaultOpen) {
        session.fileDrawerOpen = true;
        session.node.width = Math.max(300, session.node.width + uiStore.fileDrawerWidth);
      }
    }

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
    if (options.id === undefined && options.reveal !== false) {
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


  /**
   * Tell the workspace store that persisted terminal state changed.
   *
   * `isDirty` only watches `currentWorkspace.updatedAt`, and none of the
   * mutations below touch it -- so renames, cwd changes, node geometry and
   * open file drawers were all invisible to the save-on-close prompt. Called
   * only from mutations that change something the workspace file actually
   * stores; pure runtime signals (output activity, idle/attention badges,
   * exit status) deliberately do not mark the workspace dirty.
   */
  function markWorkspaceDirty(): void {
    useWorkspaceStore().markDirty();
  }

  /**
   * Copy a terminal: a fresh PTY in the same working directory, relaunching
   * whichever agent the original is running, at the same box size.
   *
   * "The agent it's running" is `activeAgent`, which is also exactly the
   * command that starts it (see BUILT_IN_AGENT_PROFILES) -- so this follows
   * what the terminal is doing now rather than what it was launched with an
   * hour ago. A terminal running a plain shell duplicates as a plain shell.
   *
   * Deliberately NOT AGENT_RELAUNCH_COMMANDS, which workspace restore uses:
   * those resume the previous conversation (`claude --continue`,
   * `codex resume --last`), which is right when reopening a saved workspace
   * and wrong here -- a duplicate would attach a second terminal to the same
   * conversation. A copy starts fresh in the same directory.
   *
   * Files: only the tabs the user explicitly marked (Cmd/Ctrl-click in the tab
   * strip) travel with the copy. Carrying all of them would make every
   * duplicate of a terminal with a dozen files open a mess nobody asked for.
   */
  async function duplicateSession(
    sourceId: string,
    position?: { x: number; y: number }
  ): Promise<TerminalSession | null> {
    const source = sessions.value.get(sourceId);
    if (!source) return null;

    const workspaceStore = useWorkspaceStore();
    const fileStore = useFileStore();
    const size = { width: source.node.width, height: source.node.height };

    // Drop it where it was let go, then let the spiral search push it clear of
    // anything already there -- including the original it came from.
    const spot = findNonOverlappingPosition(
      allSessions.value,
      workspaceStore.groups,
      null,
      position ?? { x: source.node.x + 48, y: source.node.y + 48 },
      size,
      workspaceStore.stickyNotes
    );

    const created = await createSession({
      shellId: source.shellId,
      cols: source.cols,
      rows: source.rows,
      cwd: source.cwd,
      width: size.width,
      height: size.height,
      x: spot.x,
      y: spot.y,
      autoRunCommand: source.activeAgent ?? undefined,
      reveal: false,
    });

    // createSession may have opened the drawer (and widened the node for it) on
    // its own default. Mirror the original instead: a copy that's a different
    // width from what was dragged doesn't read as a copy.
    created.fileDrawerOpen = source.fileDrawerOpen;
    updateNode(created.id, { x: spot.x, y: spot.y, width: size.width, height: size.height });

    // Name it after the original rather than letting it auto-name from the
    // folder, which would give both terminals the same name.
    updateSession(created.id, { manualName: duplicateName(source) });

    const carried = fileStore.getMarkedTabs(sourceId);
    for (const path of carried) {
      await fileStore.openInTerminal(created.id, path);
    }
    // openInTerminal activates each tab as it opens; a duplicate should come up
    // showing its terminal, with the carried files waiting as tabs.
    if (carried.length > 0) fileStore.setActiveTab(created.id, null);

    return created;
  }

  /** "api" -> "api copy" -> "api copy 2" …, skipping names already in use. */
  function duplicateName(source: TerminalSession): string {
    const base = (source.manualName || source.autoName || source.name).replace(
      / copy(?: \d+)?$/,
      ""
    );
    const taken = new Set(allSessions.value.map((s) => s.manualName || s.autoName || s.name));
    let candidate = `${base} copy`;
    let n = 2;
    while (taken.has(candidate)) candidate = `${base} copy ${n++}`;
    return candidate;
  }

  function updateSession(id: string, patch: Partial<TerminalSession>): void {
    const s = sessions.value.get(id);
    if (s) {
      Object.assign(s, patch);
      s.updatedAt = Date.now();
      markWorkspaceDirty();
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
      markWorkspaceDirty();
      // Force reactivity so computed getters depending on the Map
      // iteration (e.g. allSessions -> terminalNodes) recompute.
      triggerRef(sessions);
    }
  }

  /**
   * Remove a session from the store entirely.
   */
  /**
   * Close a terminal for good: confirm any unsaved file edits, kill the PTY,
   * then tear down everything anchored to it.
   *
   * There are five ways to close a terminal (sidebar, node header, focus tile,
   * command palette, canvas Delete) and removeSession drops the terminal's file
   * tabs unconditionally, so the confirmation has to live in one shared place
   * in front of it -- removeSession itself is synchronous and can't await a
   * dialog. Returns false if the user cancelled and nothing was closed.
   */
  async function closeSession(id: string): Promise<boolean> {
    const fileStore = useFileStore();
    const ok = await fileStore.confirmDiscard(fileStore.dirtyPathsForTerminal(id));
    if (!ok) return false;
    await killSession(id);
    removeSession(id);
    return true;
  }

  /**
   * Remove a session from the store entirely, along with everything anchored
   * to it.
   *
   * The cleanup lives here rather than at each call site because there are
   * five ways to close a terminal -- the sidebar, the node header, a focus
   * tile, the command palette and the canvas Delete key -- and only the canvas
   * one ever did it. The others left the terminal's connections in
   * `currentWorkspace.edges` forever: Vue Flow silently drops edges whose
   * endpoints are missing, so the links were invisible but still saved to
   * disk, still counted by link cohesion, and would tug unrelated nodes around
   * if a new terminal ever reused the id.
   */
  function removeSession(id: string): void {
    sessions.value.delete(id);
    if (focusedTerminalId.value === id) focusedTerminalId.value = null;
    selectedTerminalIds.value.delete(id);

    const workspaceStore = useWorkspaceStore();
    workspaceStore.removeEdgesForTerminal(id);
    workspaceStore.unpinNotesForTerminal(id);
    // The file node stays on the canvas -- it's still a real file worth
    // reading -- it just stops travelling with a terminal that's gone.
    workspaceStore.unpinFilesForTerminal(id);
    // Lazily resolved: file.ts imports terminal.ts, so the store can only be
    // read at call time, not at module scope.
    useFileStore().clearForTerminal(id);

    markWorkspaceDirty();
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
      markWorkspaceDirty();
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
      markWorkspaceDirty();
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
        markWorkspaceDirty();
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
        markWorkspaceDirty();
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
        markWorkspaceDirty();
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
    duplicateSession,
    scheduleAutoRun,
    killSession,
    restartSession,
    updateSession,
    updateNode,
    adjustOpenDrawerNodes,
    closeSession,
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

// Pinia caches store instances by id, so a hot-swapped store module would
// otherwise leave every component bound to the instance built from the *old*
// code -- newly added state and getters simply wouldn't exist on it, and the
// symptom is a component rendering as if half its data vanished. This patches
// the live instance instead. Dev only: `import.meta.hot` is undefined in a
// production build, so the block drops out.
if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useTerminalStore, import.meta.hot));
}
