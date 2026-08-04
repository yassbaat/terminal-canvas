import { acceptHMRUpdate, defineStore } from "pinia";
import { ref, computed } from "vue";
import type {
  Workspace,
  Group,
  FileNode,
  WorkspaceSettings,
  WorkspaceSummary,
} from "@renderer/type/workspace";
import type { GroupNamingContext } from "@renderer/type/groq";
import { useTerminalStore } from "@renderer/store/terminal";
import { usePromptStore } from "@renderer/store/prompt";
import { useUIStore } from "@renderer/store/ui";
import { useFileStore } from "@renderer/store/file";
import { generateId } from "@renderer/util/ids";
import { AGENT_RELAUNCH_COMMANDS } from "@renderer/util/agents";

const DEFAULT_SETTINGS: WorkspaceSettings = {
  persistPromptHistory: true,
  persistTerminalOutput: false,
  autoNameSessions: true,
  autoRunSavedCommands: false,
  defaultShellId: null,
  // Taller by default -- coding-agent TUIs (Claude Code, Codex, etc.) render a
  // scrolling conversation plus a multi-line input box, so vertical room is
  // what makes them comfortable. ~760px yields roughly 34 rows at the current
  // font metrics, versus ~28 before.
  defaultTerminalSize: { width: 900, height: 760 },
};

// Cycled automatically so every new group is visually distinct without the
// user having to pick a color manually (color-coding was previously dead:
// nothing ever passed `color`, so every group rendered with no color at all).
const GROUP_COLORS = [
  "hsl(218, 94%, 51%)", // accent blue -- keep in sync with GroupNode.vue
  "hsl(152, 62%, 45%)", // green
  "hsl(199, 88%, 58%)", // info cyan-blue
  "hsl(38, 92%, 56%)", // amber
  "hsl(300, 75%, 65%)", // magenta
  "hsl(180, 70%, 55%)", // cyan
  "hsl(280, 60%, 62%)", // purple
  "hsl(22, 85%, 58%)", // orange
];

/**
 * Pinia store for managing workspace state.
 * Handles workspace CRUD, viewport tracking, groups, and persistence.
 */
export const useWorkspaceStore = defineStore("workspace", () => {
  // ─── State ───────────────────────────────────────────────────────
  const currentWorkspace = ref<Workspace | null>(null);
  const workspaceList = ref<WorkspaceSummary[]>([]);
  const isSaving = ref(false);
  const lastSavedAt = ref<number | null>(null);
  // True while loadWorkspace is replaying saved terminals, so the mutations it
  // drives don't mark the freshly-opened workspace dirty. See markDirty.
  const restoring = ref(false);
  /**
   * Terminals from the saved file that could not be respawned this session --
   * their cwd was renamed, unmounted, or their shell is no longer installed.
   *
   * They are kept so the next save writes them back out instead of erasing
   * them. Losing a terminal because an external drive happened to be
   * unplugged, permanently and with no warning, is the worst kind of quiet
   * data loss. Cleared whenever the live set is cleared, so an unrestorable
   * terminal from workspace A can never leak into workspace B's file.
   */
  const unrestoredTerminals = ref<import("@renderer/type/terminal").TerminalSession[]>([]);
  const selectedNoteIds = ref<Set<string>>(new Set());
  const selectedGroupIds = ref<Set<string>>(new Set());
  const selectedFileIds = ref<Set<string>>(new Set());
  const fitViewTargetId = ref<string | null>(null);

  // ─── Getters ─────────────────────────────────────────────────────
  const viewport = computed(
    () => currentWorkspace.value?.viewport || { x: 0, y: 0, zoom: 1 }
  );

  const settings = computed<WorkspaceSettings>(
    () => currentWorkspace.value?.settings || { ...DEFAULT_SETTINGS }
  );

  const workspaceName = computed(() => currentWorkspace.value?.name || "Untitled");

  const isDirty = computed(() => {
    if (!currentWorkspace.value) return false;
    return !lastSavedAt.value || currentWorkspace.value.updatedAt > lastSavedAt.value;
  });

  /**
   * Record that something worth saving changed.
   *
   * Terminal state -- names, cwd, node geometry, open file drawers -- lives in
   * terminalStore and only ever bumped its own per-session `updatedAt`, which
   * `isDirty` never looks at. So renaming a terminal, letting an agent set its
   * title, or opening a file drawer left the workspace looking clean, and
   * closing the window discarded all of it with no prompt.
   *
   * Suppressed while `restoring` is set: loadWorkspace replays every saved
   * terminal through these same mutations, and a workspace that reports itself
   * dirty the instant it opens would prompt on every quit -- which trains
   * people to click straight through the one dialog that protects their work.
   */
  function markDirty(): void {
    if (restoring.value) return;
    if (!currentWorkspace.value) return;
    currentWorkspace.value.updatedAt = Date.now();
  }

  const groups = computed(() => currentWorkspace.value?.groups || []);

  const groupCount = computed(() => currentWorkspace.value?.groups.length || 0);

  const edges = computed(() => currentWorkspace.value?.edges || []);

  const stickyNotes = computed(() => currentWorkspace.value?.stickyNotes || []);

  const fileNodes = computed(() => currentWorkspace.value?.files || []);

  // ─── Actions ─────────────────────────────────────────────────────

  /**
   * Create a brand-new empty workspace and set it as current.
   */
  async function createNewWorkspace(name = "Untitled Workspace"): Promise<Workspace | null> {
    // A new workspace starts empty. Without this, "New Workspace" from the
    // Home screen only swapped the workspace object and left the previous
    // workspace's live terminals on the canvas -- so two workspace files ended
    // up claiming the same session ids, and the new one inherited the old
    // one's prompt history on its first save.
    if (!(await resetLiveSessions())) return null;

    const workspace: Workspace = {
      id: generateId("ws"),
      name,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      viewport: { x: 0, y: 0, zoom: 1 },
      terminals: [],
      groups: [],
      edges: [],
      stickyNotes: [],
      files: [],
      promptHistory: [],
      settings: { ...DEFAULT_SETTINGS },
    };
    currentWorkspace.value = workspace;
    lastSavedAt.value = null;
    return workspace;
  }

  /**
   * Persist the current workspace to disk via main process.
   * Syncs terminal sessions and prompt history before saving.
   */
  async function saveCurrentWorkspace(): Promise<boolean> {
    if (!currentWorkspace.value) return false;
    isSaving.value = true;
    try {
      currentWorkspace.value.updatedAt = Date.now();

      // Sync terminal sessions from terminalStore
      const terminalStore = useTerminalStore();
      // Carry forward terminals that failed to restore, minus any the user has
      // since recreated under the same id -- otherwise the save that follows a
      // failed restore deletes them from the file for good.
      const stillMissing = unrestoredTerminals.value.filter(
        (t) => !terminalStore.sessions.has(t.id)
      );
      currentWorkspace.value.terminals = [
        ...terminalStore.allSessions.map((s) => ({ ...s })),
        ...stillMissing.map((s) => ({ ...s })),
      ];

      // Sync prompt history from promptStore
      const promptStore = usePromptStore();
      currentWorkspace.value.promptHistory = promptStore.getAllPrompts();

      // Sync edges & sticky notes from workspace state (already in currentWorkspace)

      // CRITICAL: `currentWorkspace.value` is a Vue reactive proxy, and Electron's
      // IPC uses the structured-clone algorithm, which throws DataCloneError
      // ("could not be cloned") on a Proxy. Passing it directly made EVERY save
      // silently reject -- no file was ever written, which in turn left the
      // Workspaces list permanently empty. Snapshot to a plain object first
      // (same trick already used for Groq settings in SettingsDialog).
      const snapshot = JSON.parse(JSON.stringify(currentWorkspace.value)) as Workspace;
      await window.api.workspace.save({ workspace: snapshot });
      lastSavedAt.value = Date.now();
      return true;
    } catch (err) {
      console.error("[Workspace] Save failed", err);
      const uiStore = useUIStore();
      uiStore.showToast("Failed to save workspace");
      return false;
    } finally {
      isSaving.value = false;
    }
  }

  /**
   * Load the list of saved workspaces (lightweight summaries).
   */
  async function loadWorkspaceList(): Promise<void> {
    workspaceList.value = await window.api.workspace.list();
  }

  /**
   * Load a full workspace by ID and set it as current.
   * Restores terminal sessions (layout-only, no auto-run) and prompt history.
   */
  async function loadWorkspace(id: string): Promise<Workspace | null> {
    const ws = await window.api.workspace.load(id);
    if (!ws) return null;

    currentWorkspace.value = ws;
    // Workspaces saved before a settings field existed won't have it on disk --
    // merge over defaults so older saved files don't crash on a missing key.
    currentWorkspace.value.settings = { ...DEFAULT_SETTINGS, ...ws.settings };
    // Same for groups saved before note-grouping existed -- noteIds wouldn't
    // be in the JSON at all, and it's just a plain parse with no validation
    // on the way in (see workspace-service.ts's loadWorkspace).
    currentWorkspace.value.groups = ws.groups.map((g) => ({ ...g, noteIds: g.noteIds ?? [] }));
    // Workspaces saved before canvas file nodes existed have no `files` key at
    // all, and load does a plain JSON.parse with no validation.
    currentWorkspace.value.files = ws.files ?? [];
    lastSavedAt.value = Date.now();

    if (!(await resetLiveSessions())) return null;

    const terminalStore = useTerminalStore();
    unrestoredTerminals.value = [];

    // Everything below replays saved state through the normal mutations, which
    // would otherwise mark the workspace dirty the moment it opened.
    restoring.value = true;
    try {
    // Recreate terminals with preserved layout (no command auto-run)
    for (const saved of ws.terminals) {
      try {
        const session = await terminalStore.createSession({
          shellId: saved.shellId,
          cols: saved.cols,
          rows: saved.rows,
          cwd: saved.cwd,
          id: saved.id,
          x: saved.node.x,
          y: saved.node.y,
        });
        // Restore node size and names
        terminalStore.updateNode(session.id, {
          width: saved.node.width,
          height: saved.node.height,
        });
        if (saved.manualName) {
          terminalStore.updateSessionName(session.id, saved.manualName);
        } else if (saved.autoName) {
          terminalStore.setAutoName(session.id, saved.autoName);
        }
        // The drawer's width is baked into the restored node.width above, so
        // the flag has to come back with it or the node keeps a blank gutter.
        if (saved.fileDrawerOpen) {
          terminalStore.updateSession(session.id, { fileDrawerOpen: true });
        }
        if (saved.fileRootPinned && saved.fileRoot) {
          terminalStore.updateSession(session.id, {
            fileRoot: saved.fileRoot,
            fileRootPinned: true,
          });
          await window.api.terminal.setFileRoot(session.id, saved.fileRoot);
        }
        if (saved.openFiles?.length) {
          await useFileStore().restoreTabs(
            session.id,
            saved.openFiles,
            saved.activeFile ?? null
          );
        }
        // A coding agent was running here when the workspace was saved. The
        // process itself is gone, so relaunch its CLI once the fresh shell's
        // prompt appears -- with the agent's own resume flag where it has one,
        // so the conversation actually comes back (see AGENT_RELAUNCH_COMMANDS).
        if (saved.activeAgent) {
          const cmd = AGENT_RELAUNCH_COMMANDS[saved.activeAgent];
          if (cmd) {
            terminalStore.scheduleAutoRun(session.id, cmd);
            terminalStore.updateSession(session.id, { activeAgent: saved.activeAgent });
          }
        }
      } catch (err) {
        console.error("[Workspace] Failed to restore terminal", saved.id, err);
        unrestoredTerminals.value.push({ ...saved, status: "exited", pid: null });
      }
    }

    if (unrestoredTerminals.value.length > 0) {
      const n = unrestoredTerminals.value.length;
      useUIStore().showToast(
        n === 1
          ? "1 terminal couldn't be restored (its folder or shell is missing) — it's been kept in the workspace"
          : `${n} terminals couldn't be restored (their folders or shells are missing) — they've been kept in the workspace`
      );
    }

    // Restore prompt history
    const promptStore = usePromptStore();
    promptStore.loadFromWorkspace(ws.promptHistory);
    } finally {
      restoring.value = false;
    }

    return ws;
  }

  /**
   * Tear down every live session so a different workspace can take over.
   *
   * PTYs live in the main process, so dropping the renderer's map is not
   * enough -- the shells keep running with nothing referencing them. This also
   * clears the two stores that `saveCurrentWorkspace` serializes but that are
   * not per-workspace: prompt history (which would otherwise follow you into
   * the next workspace and get written into its file) and the file store's
   * per-terminal tabs (whose watchers would fire into components that no
   * longer exist).
   */
  async function resetLiveSessions(): Promise<boolean> {
    const terminalStore = useTerminalStore();
    const fileStore = useFileStore();

    const ids = Array.from(terminalStore.sessions.keys());

    // Clearing the board drops every open file buffer, so ask once for the
    // whole set rather than per terminal. False means the caller must abandon
    // whatever it was doing -- nothing has been killed at this point.
    const dirty = ids.flatMap((id) => fileStore.dirtyPathsForTerminal(id));
    if (!(await fileStore.confirmDiscard(dirty))) return false;

    await Promise.all(
      ids.map((sessionId) => window.api.terminal.kill(sessionId).catch(() => {}))
    );
    for (const id of ids) {
      fileStore.clearForTerminal(id);
    }

    terminalStore.sessions = new Map();
    terminalStore.focusedTerminalId = null;
    terminalStore.selectedTerminalIds = new Set();
    usePromptStore().loadFromWorkspace([]);
    unrestoredTerminals.value = [];
    return true;
  }

  /**
   * Save the current workspace (if any, and if switching to a different one)
   * before loading another -- the shared "switch workspace" path for both
   * the sidebar's Workspaces tab and the home/launcher screen, so navigating
   * away from a session never silently drops unsaved layout changes.
   */
  async function switchToWorkspace(id: string): Promise<Workspace | null> {
    if (currentWorkspace.value && currentWorkspace.value.id !== id) {
      // A failed save must not fall through to loadWorkspace -- that kills
      // every PTY and replaces currentWorkspace, so proceeding would destroy
      // exactly the state the save was supposed to preserve. The store already
      // toasts the failure.
      if (!(await saveCurrentWorkspace())) return null;
    }
    return loadWorkspace(id);
  }

  /**
   * Delete a saved workspace by ID.
   */
  async function deleteWorkspace(id: string): Promise<void> {
    // Main rethrows now (an unwritable directory, or an id that fails the
    // filename check) rather than failing quietly, so the local list must only
    // be updated once the file is really gone -- otherwise the workspace
    // vanishes from the UI and comes back on the next launch.
    try {
      await window.api.workspace.delete(id);
    } catch (err) {
      console.error("[Workspace] Delete failed", err);
      useUIStore().showToast("Couldn't delete that workspace");
      return;
    }
    workspaceList.value = workspaceList.value.filter((w) => w.id !== id);
    if (currentWorkspace.value?.id === id) {
      currentWorkspace.value = null;
    }
  }

  /**
   * Rename a saved workspace by ID. Works whether or not it's the currently
   * loaded workspace -- does NOT load it into a live session to do so (see
   * the main-process renameWorkspace(), which patches the file directly).
   */
  async function renameWorkspace(id: string, name: string): Promise<void> {
    const trimmed = name.trim();
    if (!trimmed) return;
    try {
      await window.api.workspace.rename(id, trimmed);
    } catch (err) {
      console.error("[Workspace] Rename failed", err);
      useUIStore().showToast("Couldn't rename that workspace");
      return;
    }
    const entry = workspaceList.value.find((w) => w.id === id);
    if (entry) entry.name = trimmed;
    if (currentWorkspace.value?.id === id) {
      currentWorkspace.value.name = trimmed;
    }
  }

  /**
   * Update the canvas viewport (x, y, zoom).
   * Persists to main process for cross-session tracking.
   */
  function updateViewport(x: number, y: number, zoom: number): void {
    if (currentWorkspace.value) {
      currentWorkspace.value.viewport = { x, y, zoom };
      currentWorkspace.value.updatedAt = Date.now();
    }
    // Also notify main process for background persistence
    if (typeof window.api !== "undefined") {
      window.api.workspace.updateViewport(x, y, zoom).catch(() => {
        // Silently fail — viewport is non-critical
      });
    }
  }

  // ─── Group Management ────────────────────────────────────────────

  /**
   * Add a group to the current workspace (idempotent).
   */
  function addGroup(group: Group): void {
    if (!currentWorkspace.value) return;
    const exists = currentWorkspace.value.groups.find((g) => g.id === group.id);
    if (!exists) {
      currentWorkspace.value.groups.push(group);
      currentWorkspace.value.updatedAt = Date.now();
    }
  }

  /**
   * Create a new group with defaults and add it.
   */
  function createGroup(
    name: string,
    options: Partial<Omit<Group, "id" | "name">> = {}
  ): Group {
    const group: Group = {
      id: generateId("grp"),
      name,
      x: options.x ?? 0,
      y: options.y ?? 0,
      width: options.width ?? 400,
      height: options.height ?? 300,
      collapsed: options.collapsed ?? false,
      color: options.color ?? GROUP_COLORS[groupCount.value % GROUP_COLORS.length],
      terminalIds: options.terminalIds ?? [],
      noteIds: options.noteIds ?? [],
    };
    addGroup(group);
    return group;
  }

  /**
   * Apply a partial update to an existing group.
   */
  function updateGroup(id: string, patch: Partial<Group>): void {
    if (!currentWorkspace.value) return;
    const g = currentWorkspace.value.groups.find((g) => g.id === id);
    if (g) {
      Object.assign(g, patch);
      currentWorkspace.value.updatedAt = Date.now();
    }
  }

  /**
   * Remove a group from the workspace.
   * Note: does NOT delete the terminals/notes inside — they become ungrouped.
   */
  function removeGroup(id: string): void {
    if (!currentWorkspace.value) return;
    const g = currentWorkspace.value.groups.find((g) => g.id === id);
    if (g) {
      const terminalStore = useTerminalStore();
      for (const terminalId of g.terminalIds) {
        const s = terminalStore.sessions.get(terminalId);
        if (s) s.groupId = null;
      }
      for (const noteId of g.noteIds) {
        const note = currentWorkspace.value.stickyNotes.find((n) => n.id === noteId);
        if (note) note.groupId = null;
      }
    }
    currentWorkspace.value.groups = currentWorkspace.value.groups.filter(
      (g) => g.id !== id
    );
    currentWorkspace.value.updatedAt = Date.now();
  }

  /**
   * Add a terminal ID to a group's member list.
   */
  function addTerminalToGroup(terminalId: string, groupId: string): void {
    if (!currentWorkspace.value) return;
    const terminalStore = useTerminalStore();
    const s = terminalStore.sessions.get(terminalId);

    // If it belongs to a different group, leave that one first so a
    // terminal is never listed under two groups at once.
    if (s?.groupId && s.groupId !== groupId) {
      const prev = currentWorkspace.value.groups.find((g) => g.id === s.groupId);
      if (prev) prev.terminalIds = prev.terminalIds.filter((id) => id !== terminalId);
    }

    const g = currentWorkspace.value.groups.find((g) => g.id === groupId);
    if (g && !g.terminalIds.includes(terminalId)) {
      g.terminalIds.push(terminalId);
      currentWorkspace.value.updatedAt = Date.now();
    }
    if (s) s.groupId = groupId;
  }

  /**
   * Remove a terminal ID from a group's member list.
   */
  function removeTerminalFromGroup(terminalId: string, groupId: string): void {
    if (!currentWorkspace.value) return;
    const g = currentWorkspace.value.groups.find((g) => g.id === groupId);
    if (g) {
      g.terminalIds = g.terminalIds.filter((id) => id !== terminalId);
      currentWorkspace.value.updatedAt = Date.now();
    }
    const terminalStore = useTerminalStore();
    const s = terminalStore.sessions.get(terminalId);
    if (s && s.groupId === groupId) {
      s.groupId = null;
    }
  }

  /**
   * Add a sticky note to a group's member list. Mirrors addTerminalToGroup
   * -- notes previously only ever got assigned to a group at the moment it
   * was created (via groupSelectedTerminals), with no way to join one
   * afterward and no reverse note.groupId link at all.
   */
  function addNoteToGroup(noteId: string, groupId: string): void {
    if (!currentWorkspace.value) return;
    const note = currentWorkspace.value.stickyNotes.find((n) => n.id === noteId);

    if (note?.groupId && note.groupId !== groupId) {
      const prev = currentWorkspace.value.groups.find((g) => g.id === note.groupId);
      if (prev) prev.noteIds = prev.noteIds.filter((id) => id !== noteId);
    }

    const g = currentWorkspace.value.groups.find((g) => g.id === groupId);
    if (g && !g.noteIds.includes(noteId)) {
      g.noteIds.push(noteId);
      currentWorkspace.value.updatedAt = Date.now();
    }
    if (note) note.groupId = groupId;
  }

  /**
   * Remove a sticky note from a group's member list. Mirrors removeTerminalFromGroup.
   */
  function removeNoteFromGroup(noteId: string, groupId: string): void {
    if (!currentWorkspace.value) return;
    const g = currentWorkspace.value.groups.find((g) => g.id === groupId);
    if (g) {
      g.noteIds = g.noteIds.filter((id) => id !== noteId);
      currentWorkspace.value.updatedAt = Date.now();
    }
    const note = currentWorkspace.value.stickyNotes.find((n) => n.id === noteId);
    if (note && note.groupId === groupId) {
      note.groupId = null;
    }
  }

  /**
   * Create a new group from the currently selected terminals, notes, and groups.
   */
  async function groupSelectedTerminals(name?: string): Promise<Group | null> {
    const terminalStore = useTerminalStore();
    const promptStore = usePromptStore();
    const selectedTerminalIds = Array.from(terminalStore.selectedTerminalIds);
    const selectedNoteIdsArr = Array.from(selectedNoteIds.value);
    const selectedGroupIdsArr = Array.from(selectedGroupIds.value);

    const hasSelection = selectedTerminalIds.length > 0 || selectedNoteIdsArr.length > 0 || selectedGroupIdsArr.length > 0;
    if (!hasSelection) return null;

    // Collect all items for bounds calculation
    const boundsItems: Array<{ x: number; y: number; width: number; height: number }> = [];

    const sessions = selectedTerminalIds
      .map((id) => terminalStore.sessions.get(id))
      .filter(Boolean);
    for (const s of sessions) {
      if (s) boundsItems.push({ x: s.node.x, y: s.node.y, width: s.node.width || 640, height: s.node.height || 400 });
    }

    const notes = selectedNoteIdsArr
      .map((id) => currentWorkspace.value?.stickyNotes.find((n) => n.id === id))
      .filter(Boolean);
    for (const n of notes) {
      if (n) boundsItems.push({ x: n.x, y: n.y, width: n.width, height: n.height });
    }

    const childGroups = selectedGroupIdsArr
      .map((id) => currentWorkspace.value?.groups.find((g) => g.id === id))
      .filter(Boolean);
    for (const g of childGroups) {
      if (g) boundsItems.push({ x: g.x, y: g.y, width: g.width, height: g.height });
    }

    const minX = Math.min(...boundsItems.map((b) => b.x));
    const minY = Math.min(...boundsItems.map((b) => b.y));
    const maxX = Math.max(...boundsItems.map((b) => b.x + b.width));
    const maxY = Math.max(...boundsItems.map((b) => b.y + b.height));

    const group = createGroup(name || `Group ${groupCount.value + 1}`, {
      x: minX - 20,
      y: minY - 40,
      width: maxX - minX + 40,
      height: maxY - minY + 60,
      terminalIds: selectedTerminalIds,
      noteIds: selectedNoteIdsArr,
    });

    // Assign groupId to selected terminals and notes
    for (const s of sessions) {
      if (s) s.groupId = group.id;
    }
    for (const n of notes) {
      if (n) n.groupId = group.id;
    }

    // Nest selected groups inside the new group
    for (const g of childGroups) {
      if (g) g.parentId = group.id;
    }

    terminalStore.clearSelection();
    clearNoteSelection();
    clearGroupSelection();

    // Auto-name the group with Groq
    if (!name) {
      try {
        const recentPrompts: string[] = [];
        for (const s of sessions) {
          if (s) {
            const prompts = promptStore.getPromptsForTerminal(s.id);
            recentPrompts.push(...prompts.slice(-3).map((p) => p.text));
          }
        }
        const context: GroupNamingContext = {
          terminalNames: sessions.map((s) => s!.name),
          projects: sessions.map((s) => s!.projectName),
          cwds: sessions.map((s) => s!.cwdLabel),
          shells: sessions.map((s) => s!.shellName),
          recentPrompts,
        };
        const result = await window.api.groq.generateGroupName(context);
        if (result.name) {
          updateGroup(group.id, { name: result.name });
        }
      } catch (err) {
        console.error("[Workspace] Failed to auto-name group", err);
      }
    }

    return group;
  }

  // ─── Edge Management ─────────────────────────────────────────────

  /**
   * Add a connection edge between two terminals.
   */
  function addEdge(edge: { source: string; target: string; label?: string }): void {
    if (!currentWorkspace.value) return;
    const exists = currentWorkspace.value.edges.find(
      (e) => e.source === edge.source && e.target === edge.target
    );
    if (!exists) {
      // Data only -- how a connection looks (color by what it joins, stroke
      // width, curve) is decided when the edges are handed to Vue Flow, so it
      // can't go stale against nodes that changed after the edge was drawn.
      currentWorkspace.value.edges.push({
        id: `edge_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        source: edge.source,
        target: edge.target,
        label: edge.label,
      });
      currentWorkspace.value.updatedAt = Date.now();
    }
  }

  /**
   * Remove an edge by ID.
   */
  function removeEdge(id: string): void {
    if (!currentWorkspace.value) return;
    currentWorkspace.value.edges = currentWorkspace.value.edges.filter((e) => e.id !== id);
    currentWorkspace.value.updatedAt = Date.now();
  }

  /**
   * Remove all edges connected to a node -- terminal or file. A connection to
   * something that no longer exists would render as a line to nowhere.
   */
  function removeEdgesForTerminal(nodeId: string): void {
    if (!currentWorkspace.value) return;
    currentWorkspace.value.edges = currentWorkspace.value.edges.filter(
      (e) => e.source !== nodeId && e.target !== nodeId
    );
    currentWorkspace.value.updatedAt = Date.now();
  }

  // ─── Sticky Note Management ──────────────────────────────────────

  /**
   * Create a new sticky note and add it to the workspace.
   */
  function createStickyNote(
    options: Partial<Omit<import("@renderer/type/workspace").StickyNote, "id" | "createdAt" | "updatedAt">> = {}
  ): import("@renderer/type/workspace").StickyNote {
    const note: import("@renderer/type/workspace").StickyNote = {
      id: generateId("note"),
      text: options.text || "",
      x: options.x ?? 100 + Math.random() * 100,
      y: options.y ?? 100 + Math.random() * 100,
      width: options.width ?? 200,
      height: options.height ?? 160,
      colorIndex: options.colorIndex ?? 0,
      pinnedToTerminalId: options.pinnedToTerminalId ?? null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    if (currentWorkspace.value) {
      currentWorkspace.value.stickyNotes.push(note);
      currentWorkspace.value.updatedAt = Date.now();
      // Reveal the new note on the canvas (center or pointer arrow, per the
      // user's setting). createStickyNote is only ever called for genuinely
      // new notes -- restores rehydrate stickyNotes straight from the saved
      // JSON, not through here -- so no restore guard is needed.
      const uiStore = useUIStore();
      uiStore.revealNewItem({ x: note.x, y: note.y, width: note.width, height: note.height, id: note.id });
    }
    return note;
  }

  /**
   * Apply a partial update to an existing sticky note.
   */
  function updateStickyNote(id: string, patch: Partial<import("@renderer/type/workspace").StickyNote>): void {
    if (!currentWorkspace.value) return;
    const note = currentWorkspace.value.stickyNotes.find((n) => n.id === id);
    if (note) {
      Object.assign(note, patch);
      note.updatedAt = Date.now();
      currentWorkspace.value.updatedAt = Date.now();
    }
  }

  /**
   * Remove a sticky note by ID.
   */
  function removeStickyNote(id: string): void {
    if (!currentWorkspace.value) return;
    currentWorkspace.value.stickyNotes = currentWorkspace.value.stickyNotes.filter((n) => n.id !== id);
    currentWorkspace.value.updatedAt = Date.now();
  }

  /**
   * Unpin all notes attached to a terminal.
   */
  function unpinNotesForTerminal(terminalId: string): void {
    if (!currentWorkspace.value) return;
    for (const note of currentWorkspace.value.stickyNotes) {
      if (note.pinnedToTerminalId === terminalId) {
        note.pinnedToTerminalId = null;
        note.updatedAt = Date.now();
      }
    }
    currentWorkspace.value.updatedAt = Date.now();
  }

  // ─── File Nodes (files detached onto the canvas) ─────────────────

  /**
   * Pin a file to the canvas as its own node. Re-pinning a path that's already
   * on the canvas returns the existing node instead of stacking duplicates.
   */
  function createFileNode(options: Partial<FileNode> & { path: string }): FileNode | null {
    if (!currentWorkspace.value) return null;

    const existing = currentWorkspace.value.files.find((f) => f.path === options.path);
    if (existing) return existing;

    const node: FileNode = {
      id: generateId("file"),
      path: options.path,
      x: options.x ?? 100,
      y: options.y ?? 100,
      width: options.width ?? 520,
      height: options.height ?? 460,
      groupId: options.groupId ?? null,
      pinnedToTerminalId: options.pinnedToTerminalId ?? null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    currentWorkspace.value.files.push(node);
    currentWorkspace.value.updatedAt = Date.now();

    const uiStore = useUIStore();
    uiStore.revealNewItem({
      x: node.x,
      y: node.y,
      width: node.width,
      height: node.height,
      id: node.id,
    });
    return node;
  }

  function updateFileNode(id: string, patch: Partial<FileNode>): void {
    if (!currentWorkspace.value) return;
    const node = currentWorkspace.value.files.find((f) => f.id === id);
    if (!node) return;
    Object.assign(node, patch);
    node.updatedAt = Date.now();
    currentWorkspace.value.updatedAt = Date.now();
  }

  function removeFileNode(id: string): void {
    if (!currentWorkspace.value) return;
    currentWorkspace.value.files = currentWorkspace.value.files.filter((f) => f.id !== id);
    removeEdgesForTerminal(id);
    currentWorkspace.value.updatedAt = Date.now();
  }

  /**
   * Detach a file node from a terminal that's going away. The node stays on the
   * canvas -- the file is still on disk and still worth reading -- it just stops
   * travelling with a terminal that no longer exists.
   */
  function unpinFilesForTerminal(terminalId: string): void {
    if (!currentWorkspace.value) return;
    for (const node of currentWorkspace.value.files) {
      if (node.pinnedToTerminalId === terminalId) {
        node.pinnedToTerminalId = null;
        node.updatedAt = Date.now();
      }
    }
    currentWorkspace.value.updatedAt = Date.now();
  }

  function setFileSelected(ids: string[]): void {
    selectedFileIds.value = new Set(ids);
  }

  /** Toggle a single file node in the selection (Ctrl/Cmd-click in Layers). */
  function toggleFileSelected(id: string): void {
    const newSet = new Set(selectedFileIds.value);
    if (newSet.has(id)) newSet.delete(id);
    else newSet.add(id);
    selectedFileIds.value = newSet;
  }

  function clearFileSelection(): void {
    selectedFileIds.value.clear();
  }

  // ─── Settings ────────────────────────────────────────────────────

  // ─── Selection ───────────────────────────────────────────────────

  /**
   * Replace the current note selection with a new set of IDs.
   */
  function setNoteSelected(ids: string[]): void {
    selectedNoteIds.value = new Set(ids);
  }

  /**
   * Toggle a single note ID in the selection.
   */
  function toggleNoteSelected(id: string): void {
    const newSet = new Set(selectedNoteIds.value);
    if (newSet.has(id)) newSet.delete(id);
    else newSet.add(id);
    selectedNoteIds.value = newSet;
  }

  /**
   * Clear all selected notes.
   */
  function clearNoteSelection(): void {
    selectedNoteIds.value.clear();
  }

  /**
   * Replace the current group selection with a new set of IDs.
   */
  function setGroupSelected(ids: string[]): void {
    selectedGroupIds.value = new Set(ids);
  }

  /**
   * Toggle a single group ID in the selection.
   */
  function toggleGroupSelected(id: string): void {
    const newSet = new Set(selectedGroupIds.value);
    if (newSet.has(id)) newSet.delete(id);
    else newSet.add(id);
    selectedGroupIds.value = newSet;
  }

  /**
   * Clear all selected groups.
   */
  function clearGroupSelection(): void {
    selectedGroupIds.value.clear();
  }

  /**
   * Apply a partial settings update to the current workspace.
   */
  function updateSettings(patch: Partial<WorkspaceSettings>): void {
    if (!currentWorkspace.value) return;
    currentWorkspace.value.settings = { ...currentWorkspace.value.settings, ...patch };
    currentWorkspace.value.updatedAt = Date.now();
  }

  return {
    // State
    currentWorkspace,
    workspaceList,
    isSaving,
    lastSavedAt,
    selectedNoteIds,
    selectedGroupIds,
    selectedFileIds,
    fitViewTargetId,
    // Getters
    viewport,
    settings,
    workspaceName,
    isDirty,
    groups,
    groupCount,
    edges,
    stickyNotes,
    fileNodes,
    // Actions
    markDirty,
    resetLiveSessions,
    createNewWorkspace,
    saveCurrentWorkspace,
    loadWorkspaceList,
    loadWorkspace,
    switchToWorkspace,
    deleteWorkspace,
    renameWorkspace,
    updateViewport,
    addGroup,
    createGroup,
    updateGroup,
    removeGroup,
    addTerminalToGroup,
    removeTerminalFromGroup,
    addNoteToGroup,
    removeNoteFromGroup,
    groupSelectedTerminals,
    addEdge,
    removeEdge,
    removeEdgesForTerminal,
    createStickyNote,
    updateStickyNote,
    removeStickyNote,
    unpinNotesForTerminal,
    createFileNode,
    updateFileNode,
    removeFileNode,
    unpinFilesForTerminal,
    setFileSelected,
    toggleFileSelected,
    clearFileSelection,
    setNoteSelected,
    toggleNoteSelected,
    clearNoteSelection,
    setGroupSelected,
    toggleGroupSelected,
    clearGroupSelection,
    updateSettings,
  };
});

// Pinia caches store instances by id, so a hot-swapped store module would
// otherwise leave every component bound to the instance built from the *old*
// code -- newly added state and getters simply wouldn't exist on it, and the
// symptom is a component rendering as if half its data vanished. This patches
// the live instance instead. Dev only: `import.meta.hot` is undefined in a
// production build, so the block drops out.
if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useWorkspaceStore, import.meta.hot));
}
