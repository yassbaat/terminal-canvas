import { defineStore } from "pinia";
import { ref, computed } from "vue";
import type {
  Workspace,
  Group,
  WorkspaceSettings,
  WorkspaceSummary,
} from "@renderer/type/workspace";
import type { GroupNamingContext } from "@renderer/type/groq";
import { useTerminalStore } from "@renderer/store/terminal";
import { usePromptStore } from "@renderer/store/prompt";
import { generateId } from "@renderer/util/ids";

const DEFAULT_SETTINGS: WorkspaceSettings = {
  persistPromptHistory: true,
  persistTerminalOutput: false,
  autoNameSessions: true,
  autoRunSavedCommands: false,
  defaultShellId: null,
  defaultTerminalSize: { width: 760, height: 480 },
};

// Cycled automatically so every new group is visually distinct without the
// user having to pick a color manually (color-coding was previously dead:
// nothing ever passed `color`, so every group rendered with no color at all).
const GROUP_COLORS = [
  "#e94560", // accent red
  "#4ecca3", // green
  "#64b5f6", // blue
  "#f9a825", // amber
  "#e040fb", // magenta
  "#4dd0e1", // cyan
  "#ab47bc", // purple
  "#ff8a65", // orange
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
  const selectedNoteIds = ref<Set<string>>(new Set());
  const selectedGroupIds = ref<Set<string>>(new Set());
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

  const groups = computed(() => currentWorkspace.value?.groups || []);

  const groupCount = computed(() => currentWorkspace.value?.groups.length || 0);

  const edges = computed(() => currentWorkspace.value?.edges || []);

  const stickyNotes = computed(() => currentWorkspace.value?.stickyNotes || []);

  // ─── Actions ─────────────────────────────────────────────────────

  /**
   * Create a brand-new empty workspace and set it as current.
   */
  function createNewWorkspace(name = "Untitled Workspace"): Workspace {
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
  async function saveCurrentWorkspace(): Promise<void> {
    if (!currentWorkspace.value) return;
    isSaving.value = true;
    try {
      currentWorkspace.value.updatedAt = Date.now();

      // Sync terminal sessions from terminalStore
      const terminalStore = useTerminalStore();
      currentWorkspace.value.terminals = terminalStore.allSessions.map((s) => ({ ...s }));

      // Sync prompt history from promptStore
      const promptStore = usePromptStore();
      currentWorkspace.value.promptHistory = promptStore.getAllPrompts();

      // Sync edges & sticky notes from workspace state (already in currentWorkspace)

      await window.api.workspace.save({ workspace: currentWorkspace.value as Workspace });
      lastSavedAt.value = Date.now();
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
    lastSavedAt.value = Date.now();

    const terminalStore = useTerminalStore();
    // Kill any real PTY processes left running from whatever was loaded
    // before -- otherwise switching workspaces orphans them: they keep
    // running in the main process even once the renderer stops referencing
    // them here.
    await Promise.all(
      Array.from(terminalStore.sessions.keys()).map((sessionId) =>
        window.api.terminal.kill(sessionId).catch(() => {})
      )
    );
    terminalStore.sessions = new Map();
    terminalStore.focusedTerminalId = null;
    terminalStore.selectedTerminalIds = new Set();

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
      } catch (err) {
        console.error("[Workspace] Failed to restore terminal", saved.id, err);
      }
    }

    // Restore prompt history
    const promptStore = usePromptStore();
    promptStore.loadFromWorkspace(ws.promptHistory);

    return ws;
  }

  /**
   * Save the current workspace (if any, and if switching to a different one)
   * before loading another -- the shared "switch workspace" path for both
   * the sidebar's Workspaces tab and the home/launcher screen, so navigating
   * away from a session never silently drops unsaved layout changes.
   */
  async function switchToWorkspace(id: string): Promise<Workspace | null> {
    if (currentWorkspace.value && currentWorkspace.value.id !== id) {
      await saveCurrentWorkspace();
    }
    return loadWorkspace(id);
  }

  /**
   * Delete a saved workspace by ID.
   */
  async function deleteWorkspace(id: string): Promise<void> {
    await window.api.workspace.delete(id);
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
    await window.api.workspace.rename(id, trimmed);
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
   * Note: does NOT delete the terminals inside — they become ungrouped.
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

    // Assign groupId to selected terminals
    for (const s of sessions) {
      if (s) s.groupId = group.id;
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
      currentWorkspace.value.edges.push({
        id: `edge_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        source: edge.source,
        target: edge.target,
        label: edge.label,
        type: "smoothstep",
        animated: true,
        style: { stroke: "var(--tc-accent)", strokeWidth: 2 },
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
   * Remove all edges connected to a terminal.
   */
  function removeEdgesForTerminal(terminalId: string): void {
    if (!currentWorkspace.value) return;
    currentWorkspace.value.edges = currentWorkspace.value.edges.filter(
      (e) => e.source !== terminalId && e.target !== terminalId
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
    // Actions
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
    groupSelectedTerminals,
    addEdge,
    removeEdge,
    removeEdgesForTerminal,
    createStickyNote,
    updateStickyNote,
    removeStickyNote,
    unpinNotesForTerminal,
    setNoteSelected,
    toggleNoteSelected,
    clearNoteSelection,
    setGroupSelected,
    toggleGroupSelected,
    clearGroupSelection,
    updateSettings,
  };
});
 