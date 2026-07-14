<script setup lang="ts">
import { computed, onMounted, onUnmounted, markRaw, watch, ref, nextTick } from "vue";
import { VueFlow, useVueFlow, Panel, SelectionMode } from "@vue-flow/core";
import { Background, BackgroundVariant } from "@vue-flow/background";
import { Controls } from "@vue-flow/controls";
import { MiniMap } from "@vue-flow/minimap";
import type { Node, NodeChange, NodeDimensionChange, NodeSelectionChange, GraphNode } from "@vue-flow/core";
import { useTerminalStore } from "@renderer/store/terminal";
import { useWorkspaceStore } from "@renderer/store/workspace";
import { useUIStore } from "@renderer/store/ui";
import { usePromptStore } from "@renderer/store/prompt";
import { useSummaryStore } from "@renderer/store/summary";
import { AGENT_META } from "@renderer/util/agents";
import type { TerminalSession } from "@renderer/type/terminal";
import { ChevronLeft, ChevronRight, LayoutGrid, ArrowRight } from "lucide-vue-next";
import TerminalNode from "./TerminalNode.vue";
import GroupNode from "./GroupNode.vue";
import StickyNoteNode from "./StickyNoteNode.vue";

const terminalStore = useTerminalStore();
const workspaceStore = useWorkspaceStore();
const uiStore = useUIStore();
const promptStore = usePromptStore();
const summaryStore = useSummaryStore();

// ─── Zoomed-in hovered-terminal info popup ────────────────────────
// Complements the on-node hover preview (which only appears when zoomed OUT):
// when zoomed IN, hovering a terminal shows a compact card in the canvas's
// upper-left corner with its name and an AI-summarized last command.
const hoveredSession = computed(() =>
  uiStore.hoveredTerminalId
    ? terminalStore.sessions.get(uiStore.hoveredTerminalId) ?? null
    : null
);

const hoveredDisplayName = computed(() => {
  const s = hoveredSession.value;
  return s ? s.manualName || s.autoName || s.name : "";
});

const hoveredAgentColor = computed(() => {
  const agent = hoveredSession.value?.activeAgent;
  return agent ? AGENT_META[agent].color : null;
});

const hoveredLastCommand = computed<string | null>(() => {
  const s = hoveredSession.value;
  if (!s) return null;
  const prompts = promptStore
    .getPromptsForTerminal(s.id)
    .filter((p) => p.status !== "deleted");
  if (prompts.length === 0) return null;
  return [...prompts].sort((a, b) => b.submittedAt - a.submittedAt)[0].text;
});

// Kick off (cached, de-duplicated) AI summarization whenever the hovered
// terminal's last command is long enough to be worth condensing.
watch(hoveredLastCommand, (text) => {
  if (text) summaryStore.request(text);
});

const hoveredCommandDisplay = computed(() =>
  hoveredLastCommand.value ? summaryStore.display(hoveredLastCommand.value) : ""
);

// Only in the mid zoom band: above the zoomed-OUT threshold (where the on-node
// hover card takes over) but below "zoomed in close", where the terminal's own
// header is perfectly legible and a big corner card is just noise.
const showZoomedInPopup = computed(() => {
  const z = workspaceStore.viewport.zoom;
  return !!hoveredSession.value && z >= 0.75 && z < 1.05;
});

// Vue Flow's Background/MiniMap take plain color props (not CSS custom
// properties resolved through style), so they need theme-reactive JS values
// rather than var(--tc-...) references.
// Previous shades (#d6d3e6 light / #2a2a40 dark) sat only ~15-20 RGB levels
// off the canvas background (#f4f3fa / #1a1a2e), which rendered as a barely-
// visible haze rather than a legible grid, especially at 1px dot size on
// non-retina displays. Bumped contrast and dot size below.
const dotColor = computed(() => (uiStore.resolvedTheme === "light" ? "#bcb6d9" : "#43436a"));
const minimapMaskColor = computed(() =>
  uiStore.resolvedTheme === "light" ? "rgba(244, 243, 250, 0.7)" : "rgba(26, 26, 46, 0.7)"
);
// A bright, theme-independent highlight for the node currently hovered (in the
// sidebar Layers list or on the canvas) so it's easy to locate on the minimap.
const MINIMAP_HIGHLIGHT = "#ffcf4d";
// NB: both of these read uiStore.minimapHighlightId / resolvedTheme in the
// computed BODY (not only inside the returned closure) so the computed itself
// depends on them -- otherwise MiniMap would keep calling a stale function and
// the highlight would never update when the hovered item changes.
const minimapNodeColor = computed(() => {
  const highlight = uiStore.minimapHighlightId;
  const light = uiStore.resolvedTheme === "light";
  return (node: Node) => {
    if (node.id === highlight) return MINIMAP_HIGHLIGHT;
    if (node.type === "group") return "rgba(78, 204, 163, 0.35)";
    if (node.type === "note") return light ? "#f0d878" : "#7a6a2a";
    // Terminal nodes get a bright, high-contrast fill so they read clearly
    // against the minimap's own background at a glance.
    return light ? "#8a7fc2" : "#e94560";
  };
});
// node-stroke-color only accepts a plain string (unlike node-color, which can
// be a per-node function), so the hovered-item highlight rides entirely on the
// bright fill from minimapNodeColor above.
const minimapStrokeColor = computed(() =>
  uiStore.resolvedTheme === "light" ? "#6b5fb8" : "#ff6b81"
);

// --- Figma-like Pan / Select State --------------------------------
// isPanKeyPressed lives in uiStore (not a local ref) so XtermView.vue can
// also read it -- it needs to yield its own mousedown handling to let a
// pan-drag gesture reach the pane even when it starts over xterm's text.

const selectionKeyCode = computed<true | null>(() =>
  uiStore.isPanKeyPressed ? null : true
);

const panOnDrag = computed<boolean | number[]>(() =>
  uiStore.isPanKeyPressed ? true : [1]
);

// Space is the pan modifier. Shift is reserved for Figma-style multi-select
// (see :multi-selection-key-code below), so it no longer pans. We ignore Space
// while the user is typing into a field or a focused terminal -- there it's a
// literal space, not a pan gesture.
function isTypingContext(): boolean {
  if (terminalStore.focusedTerminalId) return true;
  const active = document.activeElement;
  return !!(
    active &&
    (active.tagName === "INPUT" ||
      active.tagName === "TEXTAREA" ||
      (active as HTMLElement).isContentEditable)
  );
}

function onPanKeyDown(e: KeyboardEvent): void {
  if (e.key === " " && !isTypingContext()) {
    uiStore.isPanKeyPressed = true;
  }
}

function onPanKeyUp(e: KeyboardEvent): void {
  if (e.key === " ") {
    uiStore.isPanKeyPressed = false;
  }
}

// Must match the <VueFlow id="canvas"> below. useVueFlow() looks up (or
// creates) a store instance by id in a shared registry -- calling it with no
// id here would create a SEPARATE, disconnected store, since this component
// is the parent of <VueFlow>, not a descendant that could inject its
// provided instance. That silently broke onPaneClick, onSelectionDragStop,
// zoomIn/zoomOut/zoomTo, and the store-selection-sync watch below.
const {
  onPaneClick,
  onSelectionDragStop,
  getSelectedNodes,
  getNode,
  addSelectedNodes,
  removeSelectedNodes,
  zoomIn,
  zoomOut,
  zoomTo,
  setCenter,
  getViewport,
} = useVueFlow("canvas");

// Register custom node types
const nodeTypes: Record<string, any> = {
  terminal: markRaw(TerminalNode),
  group: markRaw(GroupNode),
  note: markRaw(StickyNoteNode),
};

// --- Node Conversion ----------------------------------------------

/**
 * Convert terminal sessions into Vue Flow node objects.
 * Each session maps to a "terminal" type node with its canvas position and size.
 */
const collapsedGroupIds = computed(() =>
  new Set((workspaceStore.groups || []).filter((g: { collapsed: boolean }) => g.collapsed).map((g: { id: string }) => g.id))
);

const terminalNodes = computed<Node[]>(() =>
  terminalStore.allSessions.map((session) => {
    const inCollapsedGroup =
      session.groupId !== null && collapsedGroupIds.value.has(session.groupId);
    return {
      id: session.id,
      type: "terminal",
      position: { x: session.node.x, y: session.node.y },
      width: session.node.width || 640,
      height: session.node.height || 400,
      data: { session },
      selectable: true,
      draggable: true,
      resizable: true,
      hidden: inCollapsedGroup,
    };
  })
);

/**
 * Convert workspace groups into Vue Flow node objects.
 */
const groupNodes = computed<Node[]>(() =>
  workspaceStore.groups.map((group: { id: string; x: number; y: number; width: number; height: number; collapsed: boolean; color?: string; terminalIds: string[] }) => ({
    id: group.id,
    type: "group",
    position: { x: group.x, y: group.y },
    width: group.width,
    height: group.height,
    data: { group },
    selectable: true,
    draggable: true,
    parentNode: undefined,
  }))
);

/**
 * Combined nodes for Vue Flow.
 */
/**
 * Edges from the workspace store.
 */
const allEdges = computed(() => (workspaceStore.edges || []) as any);

const stickyNoteNodes = computed<Node[]>(() =>
  (workspaceStore.stickyNotes || []).map((note) => ({
    id: note.id,
    type: "note",
    position: { x: note.x, y: note.y },
    width: note.width,
    height: note.height,
    data: { note },
    selectable: true,
    draggable: true,
    resizable: true,
  }))
);

const allNodes = computed<Node[]>(() => [
  ...groupNodes.value,      // groups rendered behind terminals
  ...terminalNodes.value,
  ...stickyNoteNodes.value,
]);

// --- Node Change Handlers -----------------------------------------

/**
 * Handle Vue Flow node changes -- filter for dimension changes (resize)
 * and update the terminal store with new sizes.
 */
function handleNodesChange(changes: NodeChange[]): void {
  for (const change of changes) {
    if (change.type === "dimensions") {
      const dimChange = change as NodeDimensionChange;
      const session = terminalStore.sessions.get(change.id);
      if (session && dimChange.dimensions) {
        terminalStore.updateNode(change.id, {
          width: dimChange.dimensions.width,
          height: dimChange.dimensions.height,
        });
      }
      const note = workspaceStore.stickyNotes.find((n) => n.id === change.id);
      if (note && dimChange.dimensions) {
        workspaceStore.updateStickyNote(change.id, {
          width: dimChange.dimensions.width,
          height: dimChange.dimensions.height,
        });
      }
      const group = workspaceStore.groups.find((g) => g.id === change.id);
      if (group && dimChange.dimensions) {
        workspaceStore.updateGroup(change.id, {
          width: dimChange.dimensions.width,
          height: dimChange.dimensions.height,
        });
      }
    } else if (change.type === "select") {
      const selectChange = change as NodeSelectionChange;
      if (terminalStore.sessions.has(selectChange.id)) {
        const newSet = new Set(terminalStore.selectedTerminalIds);
        if (selectChange.selected) {
          newSet.add(selectChange.id);
        } else {
          newSet.delete(selectChange.id);
        }
        terminalStore.selectedTerminalIds = newSet;
      } else if (workspaceStore.stickyNotes.find((n) => n.id === selectChange.id)) {
        const newSet = new Set(workspaceStore.selectedNoteIds);
        if (selectChange.selected) {
          newSet.add(selectChange.id);
        } else {
          newSet.delete(selectChange.id);
        }
        workspaceStore.selectedNoteIds = newSet;
      } else if (workspaceStore.groups.find((g) => g.id === selectChange.id)) {
        const newSet = new Set(workspaceStore.selectedGroupIds);
        if (selectChange.selected) {
          newSet.add(selectChange.id);
        } else {
          newSet.delete(selectChange.id);
        }
        workspaceStore.selectedGroupIds = newSet;
      }
    }
  }
}

/**
 * Sync store selections to Vue Flow when they diverge.
 * This handles sidebar clicks that update Pinia stores directly.
 */
watch(
  () => ({
    terminals: Array.from(terminalStore.selectedTerminalIds).sort().join(","),
    notes: Array.from(workspaceStore.selectedNoteIds).sort().join(","),
    groups: Array.from(workspaceStore.selectedGroupIds).sort().join(","),
  }),
  () => {
    const vfSelected = new Set(getSelectedNodes.value.map((n) => n.id));
    const storeSelected = new Set([
      ...terminalStore.selectedTerminalIds,
      ...workspaceStore.selectedNoteIds,
      ...workspaceStore.selectedGroupIds,
    ]);

    // Same selection — Vue Flow initiated this change, don't sync back
    if (
      vfSelected.size === storeSelected.size &&
      [...storeSelected].every((id) => vfSelected.has(id))
    ) {
      return;
    }

    const currentlySelected = getSelectedNodes.value;
    const toSelect = [...storeSelected]
      .map((id) => getNode.value(id))
      .filter(Boolean) as GraphNode[];
    const toUnselect = currentlySelected.filter((n) => !storeSelected.has(n.id));

    if (toUnselect.length > 0) removeSelectedNodes(toUnselect);
    if (toSelect.length > 0) addSelectedNodes(toSelect);
  }
);

/**
 * Handle node drag stop -- sync final position back to the store.
 * Also moves pinned sticky notes with their terminal.
 */

/**
 * Find the group whose bounds contain a given canvas-space point, so a
 * terminal dropped visually inside a group frame joins it (and one dragged
 * out of its group's bounds leaves it) -- the same "drop into a frame"
 * semantics as Figma, rather than requiring the explicit Ctrl+G/Group
 * button for every membership change.
 */
function groupContainingPoint(x: number, y: number): string | null {
  for (const g of workspaceStore.groups) {
    if (g.collapsed) continue;
    if (x >= g.x && x <= g.x + g.width && y >= g.y && y <= g.y + g.height) {
      return g.id;
    }
  }
  return null;
}

/**
 * Update a terminal's group membership based on where its center point
 * landed after a drag. No-ops if membership hasn't changed.
 */
function syncGroupMembershipAfterDrag(terminalId: string, node: Node): void {
  const session = terminalStore.sessions.get(terminalId);
  if (!session) return;
  // Dimensions don't change during a reposition drag, so the session's last
  // known size (kept up to date by resize handling) is accurate here.
  const width = session.node.width || 640;
  const height = session.node.height || 400;
  const centerX = node.position.x + width / 2;
  const centerY = node.position.y + height / 2;
  const targetGroupId = groupContainingPoint(centerX, centerY);

  if (targetGroupId === session.groupId) return;
  if (targetGroupId) {
    workspaceStore.addTerminalToGroup(terminalId, targetGroupId);
  } else if (session.groupId) {
    workspaceStore.removeTerminalFromGroup(terminalId, session.groupId);
  }
}

/**
 * Same "drop into a frame" membership sync as syncGroupMembershipAfterDrag,
 * for sticky notes. Previously notes could only ever join a group at the
 * moment it was created (groupSelectedTerminals) and could never join or
 * leave one afterward by dragging, unlike terminals.
 */
function syncNoteGroupMembershipAfterDrag(noteId: string, node: Node): void {
  const note = workspaceStore.stickyNotes.find((n) => n.id === noteId);
  if (!note) return;
  const centerX = node.position.x + (note.width || 200) / 2;
  const centerY = node.position.y + (note.height || 160) / 2;
  const targetGroupId = groupContainingPoint(centerX, centerY);

  if (targetGroupId === (note.groupId ?? null)) return;
  if (targetGroupId) {
    workspaceStore.addNoteToGroup(noteId, targetGroupId);
  } else if (note.groupId) {
    workspaceStore.removeNoteFromGroup(noteId, note.groupId);
  }
}

// --- Group-cohesive dragging --------------------------------------
// When a terminal that belongs to a group is dragged on its own, the whole
// group travels with it (its sibling terminals, member notes, and the group
// frame) -- the mirror of dragging the group frame, which already moves its
// members. Tracked across the drag via these refs.
let groupDragId: string | null = null;
let groupDragSiblings: string[] = [];
let groupDragNotes: string[] = [];
let groupDragLast: { x: number; y: number } | null = null;

function resetGroupDrag(): void {
  groupDragId = null;
  groupDragSiblings = [];
  groupDragNotes = [];
  groupDragLast = null;
}

function handleNodeDragStart({ node }: { node: Node }): void {
  resetGroupDrag();
  if (node.type !== "terminal") return;
  // A multi-node selection drag is handled by Vue Flow (it moves every
  // selected node) + onSelectionDragStop -- don't also apply group cohesion
  // there, or members could be moved twice.
  if (
    terminalStore.selectedTerminalIds.size > 1 &&
    terminalStore.selectedTerminalIds.has(node.id)
  ) {
    return;
  }
  const session = terminalStore.sessions.get(node.id);
  if (!session?.groupId) return;
  const group = workspaceStore.groups.find((g) => g.id === session.groupId);
  if (!group) return;
  groupDragId = group.id;
  groupDragSiblings = group.terminalIds.filter((id) => id !== node.id);
  groupDragNotes = [...group.noteIds];
  groupDragLast = { x: node.position.x, y: node.position.y };
}

function handleNodeDrag({ node }: { node: Node }): void {
  if (!groupDragId || !groupDragLast || node.type !== "terminal") return;
  const dx = node.position.x - groupDragLast.x;
  const dy = node.position.y - groupDragLast.y;
  if (dx === 0 && dy === 0) return;
  groupDragLast = { x: node.position.x, y: node.position.y };

  // Move sibling terminals live, reading each one's latest position so the
  // deltas accumulate correctly frame to frame.
  for (const id of groupDragSiblings) {
    const s = terminalStore.sessions.get(id);
    if (s) terminalStore.updateNode(id, { x: s.node.x + dx, y: s.node.y + dy });
  }
  // Move member notes live.
  for (const id of groupDragNotes) {
    const n = workspaceStore.stickyNotes.find((nn) => nn.id === id);
    if (n) workspaceStore.updateStickyNote(id, { x: n.x + dx, y: n.y + dy });
  }
  // Move the group frame itself so it stays wrapped around its contents.
  const g = workspaceStore.groups.find((gg) => gg.id === groupDragId);
  if (g) workspaceStore.updateGroup(groupDragId, { x: g.x + dx, y: g.y + dy });
}

function handleNodeDragStop({ node }: { node: Node }): void {
  if (node.type === "terminal") {
    const session = terminalStore.sessions.get(node.id);
    const oldX = session?.node.x ?? node.position.x;
    const oldY = session?.node.y ?? node.position.y;
    const dx = node.position.x - oldX;
    const dy = node.position.y - oldY;

    terminalStore.updateNode(node.id, {
      x: node.position.x,
      y: node.position.y,
    });
    // When the terminal moved as part of its group (frame dragged along with
    // it), it never left the group's bounds, so membership is unchanged --
    // skip the drop-into-frame sync so a cohesive move can't reshuffle groups.
    if (!groupDragId) {
      syncGroupMembershipAfterDrag(node.id, node);
    }

    // Move pinned notes with the terminal (skip any already moved live as a
    // group member, to avoid double-shifting them).
    if (dx !== 0 || dy !== 0) {
      for (const note of workspaceStore.stickyNotes) {
        if (note.pinnedToTerminalId === node.id) {
          if (groupDragId && groupDragNotes.includes(note.id)) continue;
          workspaceStore.updateStickyNote(note.id, {
            x: note.x + dx,
            y: note.y + dy,
          });
        }
      }
    }
    resetGroupDrag();
  } else if (node.type === "group") {
    workspaceStore.updateGroup(node.id, {
      x: node.position.x,
      y: node.position.y,
    });
  } else if (node.type === "note") {
    workspaceStore.updateStickyNote(node.id, {
      x: node.position.x,
      y: node.position.y,
    });
    syncNoteGroupMembershipAfterDrag(node.id, node);
  }
}

/**
 * Handle new connections between terminals.
 */
function handleConnect(params: { source: string; target: string }): void {
  workspaceStore.addEdge({ source: params.source, target: params.target });
}

/**
 * Handle viewport changes -- persist to workspace store.
 */
function handleViewportChange(viewport: { x: number; y: number; zoom: number }): void {
  workspaceStore.updateViewport(viewport.x, viewport.y, viewport.zoom);
}

// --- Node Click / Selection ---------------------------------------

/**
 * Note: clicking a terminal node does NOT set keyboard focus here.
 * Vue Flow's onNodeClick fires for a click anywhere on the card -- header,
 * footer, chrome -- which previously grabbed real keyboard focus for the
 * whole card (via a watcher that calls xterm.focus()) just from a plain
 * *selection* click. That silently swallowed canvas shortcuts like Ctrl+G
 * the moment you selected two terminals to group them. Focus is granted
 * exclusively by clicking into the terminal's own body (see
 * TerminalNode.vue's .terminal-area and XtermView.vue's mousedown handler),
 * which is the only place "I want to type here" actually means that.
 */

/**
 * When the canvas (pane) is clicked, unfocus any focused terminal.
 */
onPaneClick(() => {
  terminalStore.setFocused(null);
});

/**
 * When a selection of nodes is dragged, sync all terminal positions back to store.
 * Also moves pinned sticky notes with their terminals.
 */
onSelectionDragStop(({ nodes }) => {
  const movedTerminals: Array<{ id: string; dx: number; dy: number }> = [];
  for (const node of nodes) {
    if (node.type === "terminal") {
      const session = terminalStore.sessions.get(node.id);
      const oldX = session?.node.x ?? node.position.x;
      const oldY = session?.node.y ?? node.position.y;
      terminalStore.updateNode(node.id, {
        x: node.position.x,
        y: node.position.y,
      });
      syncGroupMembershipAfterDrag(node.id, node);
      movedTerminals.push({ id: node.id, dx: node.position.x - oldX, dy: node.position.y - oldY });
    } else if (node.type === "group") {
      workspaceStore.updateGroup(node.id, {
        x: node.position.x,
        y: node.position.y,
      });
    } else if (node.type === "note") {
      workspaceStore.updateStickyNote(node.id, {
        x: node.position.x,
        y: node.position.y,
      });
    }
  }
  for (const { id, dx, dy } of movedTerminals) {
    if (dx === 0 && dy === 0) continue;
    for (const note of workspaceStore.stickyNotes) {
      if (note.pinnedToTerminalId === id) {
        workspaceStore.updateStickyNote(note.id, {
          x: note.x + dx,
          y: note.y + dy,
        });
      }
    }
  }
});

// --- Keyboard Shortcuts -------------------------------------------

/**
 * Handle canvas-level keyboard shortcuts.
 * These are only active when NO terminal is focused.
 */
function handleKeyDown(e: KeyboardEvent): void {
  // Never intercept when an input, textarea, or contenteditable is focused
  const active = document.activeElement;
  if (
    active &&
    (active.tagName === "INPUT" ||
      active.tagName === "TEXTAREA" ||
      (active as HTMLElement).isContentEditable)
  ) {
    return;
  }

  // If a terminal has focus, canvas shortcuts are disabled
  if (terminalStore.focusedTerminalId) {
    if (e.key === "Escape") {
      terminalStore.setFocused(null);
      e.preventDefault();
    }
    return;
  }

  // Ctrl/Cmd + Plus (or =): zoom in
  const mod = e.ctrlKey || e.metaKey;
  if (mod && (e.key === "+" || e.key === "=")) {
    zoomIn({ duration: 150 });
    e.preventDefault();
    return;
  }

  // Ctrl/Cmd + Minus: zoom out
  if (mod && (e.key === "-" || e.key === "_")) {
    zoomOut({ duration: 150 });
    e.preventDefault();
    return;
  }

  // Ctrl/Cmd + 0: reset zoom to 100%
  if (mod && e.key === "0") {
    zoomTo(1, { duration: 150 });
    e.preventDefault();
    return;
  }

  // Delete / Backspace: remove selected terminals, notes, and groups
  if (e.key === "Delete" || e.key === "Backspace") {
    const selectedTerminals = Array.from(terminalStore.selectedTerminalIds);
    const selectedNotes = Array.from(workspaceStore.selectedNoteIds);
    const selectedGroups = Array.from(workspaceStore.selectedGroupIds);
    const total = selectedTerminals.length + selectedNotes.length + selectedGroups.length;
    if (total === 0) return;

    for (const id of selectedTerminals) {
      terminalStore.killSession(id);
      terminalStore.removeSession(id);
      workspaceStore.removeEdgesForTerminal(id);
      workspaceStore.unpinNotesForTerminal(id);
    }
    terminalStore.clearSelection();

    for (const id of selectedNotes) {
      workspaceStore.removeStickyNote(id);
    }
    workspaceStore.clearNoteSelection();

    // Ungroup (not destructive to the terminals inside) rather than kill them.
    for (const id of selectedGroups) {
      workspaceStore.removeGroup(id);
    }
    workspaceStore.clearGroupSelection();

    const parts: string[] = [];
    if (selectedTerminals.length) parts.push(`${selectedTerminals.length} terminal(s)`);
    if (selectedNotes.length) parts.push(`${selectedNotes.length} note(s)`);
    if (selectedGroups.length) parts.push(`${selectedGroups.length} group(s)`);
    uiStore.showToast(`Removed ${parts.join(", ")}`);

    e.preventDefault();
    return;
  }
}

// --- Terminal Navigation & Arrange (top-right controls) -----------

/**
 * Center the canvas on a terminal and focus it. Zoom is bumped to at least
 * a legible level so prev/next stepping from a far-zoomed-out view actually
 * shows you the terminal, not a distant speck.
 */
function centerOnTerminal(session: TerminalSession): void {
  const width = session.node.width || 900;
  const height = session.node.height || 640;
  const cx = session.node.x + width / 2;
  const cy = session.node.y + height / 2;
  setCenter(cx, cy, { zoom: Math.max(getViewport().zoom, 0.8), duration: 400 });
  terminalStore.setFocused(session.id);
  // Also make it the selection so it's clearly highlighted in the Layers
  // sidebar (and on the canvas) as you step through terminals with the arrows.
  terminalStore.setSelected([session.id]);
  workspaceStore.clearNoteSelection();
  workspaceStore.clearGroupSelection();
}

// Stable ordering for prev/next: top-to-bottom, then left-to-right, so
// stepping follows the visual layout rather than creation order.
const orderedTerminals = computed(() =>
  [...terminalStore.allSessions].sort((a, b) => {
    if (Math.abs(a.node.y - b.node.y) > 40) return a.node.y - b.node.y;
    return a.node.x - b.node.x;
  })
);

/**
 * Double-clicking a terminal on the canvas while zoomed out zooms/pans to it
 * and focuses it -- a fast way to dive into a specific terminal from a
 * bird's-eye view. When zoomed in a double-click is left alone (it's xterm's
 * word-select / the header's rename), so this only kicks in below the
 * legibility threshold.
 */
function handleNodeDoubleClick({ node }: { node: Node }): void {
  if (node.type !== "terminal") return;
  if (workspaceStore.viewport.zoom >= 0.75) return;
  const session = terminalStore.sessions.get(node.id);
  if (session) centerOnTerminal(session);
}

function navToTerminal(step: 1 | -1): void {
  const list = orderedTerminals.value;
  if (list.length === 0) return;
  const currentId = terminalStore.focusedTerminalId;
  const currentIdx = currentId ? list.findIndex((s) => s.id === currentId) : -1;
  // From nothing focused: forward starts at the first, back at the last.
  const nextIdx =
    currentIdx === -1
      ? step === 1
        ? 0
        : list.length - 1
      : (currentIdx + step + list.length) % list.length;
  centerOnTerminal(list[nextIdx]);
}

/** Shift every note pinned to a terminal by the same delta the terminal moved. */
function shiftPinnedNotes(terminalId: string, dx: number, dy: number): void {
  if (dx === 0 && dy === 0) return;
  for (const note of workspaceStore.stickyNotes) {
    if (note.pinnedToTerminalId === terminalId) {
      workspaceStore.updateStickyNote(note.id, { x: note.x + dx, y: note.y + dy });
    }
  }
}

/** Move a single terminal to an absolute position, carrying its pinned notes. */
function placeTerminal(s: TerminalSession, x: number, y: number): void {
  const dx = x - s.node.x;
  const dy = y - s.node.y;
  terminalStore.updateNode(s.id, { x, y });
  shiftPinnedNotes(s.id, dx, dy);
}

/**
 * Move a whole group by a delta -- its frame, every member terminal, every
 * member note, and any notes pinned to its members -- so a group stays a
 * coherent block and its frame never gets left behind (the arrange bug). Each
 * note is moved exactly once even if it's both a member and pinned.
 */
function shiftGroupBlock(
  g: { id: string; x: number; y: number; terminalIds: string[]; noteIds: string[] },
  dx: number,
  dy: number
): void {
  if (dx === 0 && dy === 0) return;
  workspaceStore.updateGroup(g.id, { x: g.x + dx, y: g.y + dy });
  const noteIdsToMove = new Set<string>(g.noteIds);
  for (const tid of g.terminalIds) {
    const s = terminalStore.sessions.get(tid);
    if (s) terminalStore.updateNode(tid, { x: s.node.x + dx, y: s.node.y + dy });
    for (const note of workspaceStore.stickyNotes) {
      if (note.pinnedToTerminalId === tid) noteIdsToMove.add(note.id);
    }
  }
  for (const nid of noteIdsToMove) {
    const n = workspaceStore.stickyNotes.find((nn) => nn.id === nid);
    if (n) workspaceStore.updateStickyNote(nid, { x: n.x + dx, y: n.y + dy });
  }
}

/**
 * Auto-arrange the canvas: ungrouped terminals into columns by working
 * directory (same folder ends up adjacent), then each group placed after them
 * as a single intact block. Groups move as a unit -- frame, members, and notes
 * all travel together -- so the frame always follows its terminals rather than
 * being stranded where it started. Explicitly user-triggered (a button), never
 * automatic, since it repositions everything.
 */
function arrangeByPath(): void {
  const sessions = terminalStore.allSessions;
  if (sessions.length === 0) {
    uiStore.showToast("No terminals to arrange");
    return;
  }

  const GAP = 40;
  const COL_GAP = 80;
  const START_X = 80;
  const START_Y = 80;

  // Terminals that belong to a live group are laid out via their group block,
  // not as loose columns.
  const groupedTerminalIds = new Set<string>();
  for (const g of workspaceStore.groups) {
    for (const tid of g.terminalIds) groupedTerminalIds.add(tid);
  }
  const ungrouped = sessions.filter((s) => !groupedTerminalIds.has(s.id));

  // Bucket the ungrouped by cwd, preserving first-seen order.
  const buckets = new Map<string, TerminalSession[]>();
  for (const s of ungrouped) {
    const key = s.cwd || "~";
    const bucket = buckets.get(key);
    if (bucket) bucket.push(s);
    else buckets.set(key, [s]);
  }

  let colX = START_X;
  for (const [, list] of buckets) {
    let rowY = START_Y;
    let colWidth = 0;
    for (const s of list) {
      placeTerminal(s, colX, rowY);
      rowY += (s.node.height || 640) + GAP;
      colWidth = Math.max(colWidth, s.node.width || 900);
    }
    colX += colWidth + COL_GAP;
  }

  // Then drop each group in as an intact block to the right of the columns,
  // aligning its top-left to (colX, START_Y).
  for (const g of workspaceStore.groups) {
    shiftGroupBlock(g, colX - g.x, START_Y - g.y);
    colX += (g.width || 400) + COL_GAP;
  }

  uiStore.showToast(`Arranged ${sessions.length} terminal(s) by folder`);
}

// --- New-item reveal (center+focus, or temporary pointer arrow) ----

const rootEl = ref<HTMLElement | null>(null);
const pointerVisible = ref(false);
const pointer = ref<{ x: number; y: number; angle: number; offscreen: boolean }>({
  x: 0,
  y: 0,
  angle: 0,
  offscreen: false,
});
let pointerTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Project a canvas-space point to screen space and show a pointer there.
 * If the point is off-screen it's clamped to the nearest edge and the arrow
 * rotates to point toward it; if on-screen it's a pulsing ring at the spot.
 */
function showPointerAt(cx: number, cy: number): void {
  const el = rootEl.value;
  if (!el) return;
  const rect = el.getBoundingClientRect();
  const vp = getViewport();
  // Vue Flow pane transform is translate(vp.x, vp.y) scale(vp.zoom).
  const sx = vp.x + cx * vp.zoom;
  const sy = vp.y + cy * vp.zoom;
  const margin = 56;
  const clampedX = Math.max(margin, Math.min(rect.width - margin, sx));
  const clampedY = Math.max(margin, Math.min(rect.height - margin, sy));
  const offscreen = Math.abs(clampedX - sx) > 0.5 || Math.abs(clampedY - sy) > 0.5;
  const angle = (Math.atan2(sy - clampedY, sx - clampedX) * 180) / Math.PI;
  pointer.value = { x: clampedX, y: clampedY, angle, offscreen };
  pointerVisible.value = true;
  if (pointerTimer) clearTimeout(pointerTimer);
  pointerTimer = setTimeout(() => {
    pointerVisible.value = false;
  }, 2600);
}

watch(
  () => uiStore.revealTarget,
  (target) => {
    if (!target) return;
    const cx = target.x + target.width / 2;
    const cy = target.y + target.height / 2;
    // target.focus forces center-and-focus (new terminals, so the user can
    // type right away); otherwise the user's placement preference decides.
    if (target.focus || uiStore.newItemPlacement === "focus") {
      setCenter(cx, cy, { zoom: Math.max(getViewport().zoom, 0.8), duration: 400 });
      if (target.id) {
        // Focus after the node has had a chance to mount.
        nextTick(() => target.id && terminalStore.setFocused(target.id));
      }
    } else {
      showPointerAt(cx, cy);
    }
  }
);

onMounted(() => {
  window.addEventListener("keydown", handleKeyDown);
  window.addEventListener("keydown", onPanKeyDown);
  window.addEventListener("keyup", onPanKeyUp);
});

onUnmounted(() => {
  window.removeEventListener("keydown", handleKeyDown);
  window.removeEventListener("keydown", onPanKeyDown);
  window.removeEventListener("keyup", onPanKeyUp);
  if (pointerTimer) clearTimeout(pointerTimer);
});
</script>

<template>
  <div ref="rootEl" class="workspace-canvas-root">
  <VueFlow
    id="canvas"
    class="workspace-canvas"
    :nodes="allNodes"
    :edges="allEdges"
    :node-types="nodeTypes"
    :default-viewport="workspaceStore.viewport"
    :min-zoom="0.1"
    :max-zoom="2"
    :pan-on-scroll="true"
    :zoom-on-scroll="false"
    :zoom-on-pinch="true"
    :connectable="true"
    :delete-key-code="null"
    :selection-key-code="selectionKeyCode"
    :multi-selection-key-code="['Control', 'Meta', 'Shift']"
    :pan-on-drag="panOnDrag"
    :selection-mode="SelectionMode.Partial"
    :fit-view-on-init="true"
    @nodes-change="handleNodesChange"
    @node-drag-start="handleNodeDragStart"
    @node-drag="handleNodeDrag"
    @node-drag-stop="handleNodeDragStop"
    @node-double-click="handleNodeDoubleClick"
    @connect="handleConnect"
    @viewport-change="handleViewportChange"
  >
    <!-- Dotted background grid -->
    <Background
      :variant="BackgroundVariant.Dots"
      :gap="22"
      :size="1.6"
      :color="dotColor"
    />

    <!-- Zoom controls -->
    <Controls />

    <!-- Mini map for navigation -->
    <MiniMap
      pannable
      zoomable
      :width="140"
      :height="100"
      :node-color="minimapNodeColor"
      :node-stroke-color="minimapStrokeColor"
      :node-stroke-width="2"
      :node-border-radius="3"
      :mask-color="minimapMaskColor"
      :mask-stroke-color="minimapStrokeColor"
      :mask-stroke-width="1.5"
      class="canvas-minimap"
    />

    <!-- Status overlay panel -->
    <Panel position="top-left" class="canvas-status-panel">
      <span class="canvas-status-text">
        {{ terminalStore.sessionCount }} terminal(s)
        <span v-if="terminalStore.runningSessions.length > 0" class="canvas-status-running">
          &bull; {{ terminalStore.runningSessions.length }} running
        </span>
      </span>
    </Panel>

    <!-- Navigate / arrange controls -->
    <Panel position="top-right" class="canvas-nav-panel">
      <button
        class="canvas-nav-btn"
        title="Previous terminal"
        :disabled="terminalStore.sessionCount === 0"
        @click="navToTerminal(-1)"
      >
        <ChevronLeft :size="16" />
      </button>
      <button
        class="canvas-nav-btn"
        title="Next terminal"
        :disabled="terminalStore.sessionCount === 0"
        @click="navToTerminal(1)"
      >
        <ChevronRight :size="16" />
      </button>
      <div class="canvas-nav-divider" />
      <button
        class="canvas-nav-btn canvas-nav-btn-wide"
        title="Arrange terminals by folder"
        :disabled="terminalStore.sessionCount === 0"
        @click="arrangeByPath"
      >
        <LayoutGrid :size="15" />
        <span>Arrange</span>
      </button>
    </Panel>
  </VueFlow>

    <!-- Temporary pointer showing where a new item landed (arrow placement mode) -->
    <div
      v-if="pointerVisible"
      class="placement-pointer"
      :class="{ offscreen: pointer.offscreen }"
      :style="{ left: pointer.x + 'px', top: pointer.y + 'px' }"
    >
      <ArrowRight
        v-if="pointer.offscreen"
        class="placement-arrow"
        :size="26"
        :style="{ transform: `rotate(${pointer.angle}deg)` }"
      />
      <span v-else class="placement-ring" />
    </div>

    <!-- Zoomed-in hovered-terminal info: name + AI-summarized last command,
         pinned to the canvas corner so it's readable and never obstructed by
         the nodes themselves. -->
    <Transition name="hover-popup">
      <div v-if="showZoomedInPopup" class="hovered-info-popup">
        <div class="hovered-info-name">
          <span
            v-if="hoveredAgentColor"
            class="hovered-info-dot"
            :style="{ background: hoveredAgentColor }"
          />
          {{ hoveredDisplayName }}
        </div>
        <div v-if="hoveredCommandDisplay" class="hovered-info-cmd">
          {{ hoveredCommandDisplay }}
        </div>
        <div v-else class="hovered-info-cmd hovered-info-empty">No commands yet</div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.workspace-canvas-root {
  position: relative;
  width: 100%;
  height: 100%;
}

.workspace-canvas {
  width: 100%;
  height: 100%;
  background: var(--tc-bg-primary);
}

/* Lift a hovered terminal above its neighbours so its hover-detail card (which
   overflows the node's top edge) is never clipped or covered by an adjacent
   terminal sitting in front of it. !important overrides Vue Flow's inline
   per-node z-index; scoped to terminal nodes so groups/notes don't jump. */
.workspace-canvas :deep(.vue-flow__node-terminal:hover) {
  z-index: 1000 !important;
}

/* Placement pointer (arrow reveal mode): a screen-space overlay, positioned
   in pixels relative to the canvas root, so it stays put regardless of the
   flow pane's own pan/zoom transform. */
.placement-pointer {
  position: absolute;
  transform: translate(-50%, -50%);
  z-index: 20;
  pointer-events: none;
  color: var(--tc-accent);
  animation: placement-pop 0.25s ease-out;
}

.placement-arrow {
  filter: drop-shadow(0 1px 3px rgba(0, 0, 0, 0.4));
}

.placement-ring {
  display: block;
  width: 26px;
  height: 26px;
  border-radius: 50%;
  border: 3px solid var(--tc-accent);
  box-shadow: 0 0 0 4px color-mix(in srgb, var(--tc-accent) 25%, transparent);
  animation: placement-pulse 1s ease-out infinite;
}

@keyframes placement-pop {
  from { opacity: 0; transform: translate(-50%, -50%) scale(0.4); }
  to { opacity: 1; transform: translate(-50%, -50%) scale(1); }
}

@keyframes placement-pulse {
  0% { box-shadow: 0 0 0 2px color-mix(in srgb, var(--tc-accent) 40%, transparent); }
  70% { box-shadow: 0 0 0 12px color-mix(in srgb, var(--tc-accent) 0%, transparent); }
  100% { box-shadow: 0 0 0 2px color-mix(in srgb, var(--tc-accent) 0%, transparent); }
}

.canvas-status-panel {
  background: var(--tc-bg-card);
  border: 1px solid var(--tc-border-color);
  border-radius: var(--tc-border-radius-sm);
  padding: 4px 10px;
  pointer-events: none;
  user-select: none;
}

/* Zoomed-in hovered-terminal info popup (upper-left of the canvas). Sits below
   the status panel so the two never overlap. */
.hovered-info-popup {
  position: absolute;
  top: 40px;
  left: 10px;
  z-index: 21;
  width: 208px;
  max-width: calc(100% - 20px);
  padding: 6px 9px;
  background: var(--tc-bg-card);
  border: 1px solid var(--tc-border-color);
  border-left: 2px solid var(--tc-accent);
  border-radius: var(--tc-border-radius-sm);
  box-shadow: var(--tc-shadow-md);
  pointer-events: none;
  user-select: none;
  opacity: 0.96;
}

.hovered-info-name {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 11.5px;
  font-weight: 600;
  color: var(--tc-text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.hovered-info-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex-shrink: 0;
}

.hovered-info-cmd {
  margin-top: 3px;
  font-size: 10.5px;
  line-height: 1.35;
  color: var(--tc-text-secondary);
  font-family: var(--tc-font-mono);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.hovered-info-empty {
  font-style: italic;
  opacity: 0.6;
  font-family: var(--tc-font-sans);
}

.hover-popup-enter-active,
.hover-popup-leave-active {
  transition: opacity 140ms ease, transform 140ms ease;
}

.hover-popup-enter-from,
.hover-popup-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}

.canvas-nav-panel {
  display: flex;
  align-items: center;
  gap: 2px;
  background: var(--tc-bg-card);
  border: 1px solid var(--tc-border-color);
  border-radius: var(--tc-border-radius-sm);
  padding: 3px;
  box-shadow: var(--tc-shadow-sm);
}

.canvas-nav-btn {
  height: 28px;
  min-width: 28px;
  border: none;
  background: transparent;
  color: var(--tc-text-secondary);
  cursor: pointer;
  border-radius: var(--tc-border-radius-sm);
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  padding: 0 6px;
  font-size: var(--tc-font-size-sm);
  transition: all var(--tc-transition-fast);
}

.canvas-nav-btn:hover:not(:disabled) {
  background: var(--tc-bg-hover);
  color: var(--tc-text-primary);
}

.canvas-nav-btn:disabled {
  opacity: 0.4;
  cursor: default;
}

.canvas-nav-btn-wide {
  padding: 0 10px;
  font-weight: 500;
}

.canvas-nav-divider {
  width: 1px;
  height: 18px;
  background: var(--tc-border-color);
  margin: 0 2px;
}

.canvas-status-text {
  font-size: var(--tc-font-size-xs);
  color: var(--tc-text-muted);
}

.canvas-status-running {
  color: var(--tc-status-running);
}

/* Vue Flow's minimap package hardcodes a white SVG background
   (.vue-flow__minimap { background-color: #fff }) which clashes badly with
   the dark theme and makes the whole thing read as a washed-out blob rather
   than a legible overview. Override it to match the app chrome. */
.canvas-minimap :deep(.vue-flow__minimap) {
  background-color: var(--tc-bg-card) !important;
  border: 1px solid var(--tc-border-color);
  border-radius: var(--tc-border-radius);
  box-shadow: var(--tc-shadow-md);
  overflow: hidden;
  /* Small by default (it was covering too much canvas) -- grows toward the
     canvas on hover so it's still readable when you actually need it. Scales
     via CSS transform rather than the width/height props so it stays a
     crisp vector redraw, not a resized raster. */
  transform-origin: bottom right;
  transition: transform var(--tc-transition-fast), box-shadow var(--tc-transition-fast);
}

.canvas-minimap:hover :deep(.vue-flow__minimap) {
  transform: scale(1.7);
  box-shadow: var(--tc-shadow-lg);
}
</style>
