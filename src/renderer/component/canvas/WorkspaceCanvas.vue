<script setup lang="ts">
import { computed, onMounted, onUnmounted, markRaw, watch, ref, nextTick } from "vue";
import { VueFlow, useVueFlow, Panel, SelectionMode, ConnectionMode } from "@vue-flow/core";
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
import { sessionDisplayName } from "@renderer/util/sessionName";
import type { TerminalSession } from "@renderer/type/terminal";
import { ChevronLeft, ChevronRight, LayoutGrid, ArrowRight, SquareTerminal, FolderOpen, StickyNote } from "lucide-vue-next";
import TerminalNode from "./TerminalNode.vue";
import GroupNode from "./GroupNode.vue";
import StickyNoteNode from "./StickyNoteNode.vue";
import FileCanvasNode from "./FileCanvasNode.vue";
import { useFileStore } from "@renderer/store/file";

const terminalStore = useTerminalStore();
const workspaceStore = useWorkspaceStore();
const uiStore = useUIStore();
const promptStore = usePromptStore();
const summaryStore = useSummaryStore();

// ─── Empty-canvas start panel ──────────────────────────────────────
const modKeyLabel = window.api?.platform === "darwin" ? "⌘" : "Ctrl+";

async function emptyNewTerminal(): Promise<void> {
  const shellId = terminalStore.sessionDefaultShellId || workspaceStore.settings.defaultShellId;
  const shell = terminalStore.shells.find((s) => s.id === shellId);
  if (shell) {
    await terminalStore.createSession({ shellId: shell.id, cols: 80, rows: 24 });
  } else {
    uiStore.openNewTerminalDialog();
  }
}

function emptyNewTerminalInFolder(): void {
  uiStore.openNewTerminalDialog();
}

function emptyNewNote(): void {
  const size = { width: 200, height: 160 };
  const rect = rootEl.value?.getBoundingClientRect();
  const center = rect
    ? screenToFlowCoordinate({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 })
    : { x: 0, y: 0 };
  workspaceStore.createStickyNote({
    x: center.x - size.width / 2,
    y: center.y - size.height / 2,
    width: size.width,
    height: size.height,
  });
  uiStore.showToast("Sticky note added");
}

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
  return s ? sessionDisplayName(s) : "";
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

/**
 * The card shrinks as you close in. Across the narrow band it lives in
 * (0.75 -> 1.05) the ramp has to be steep to be visible at all: full size at
 * the far end, ~0.8 at the near end, where the node's own header is already
 * legible and the card is mostly a reminder.
 */
const hoveredInfoScale = computed(() => {
  const z = workspaceStore.viewport.zoom;
  const t = Math.min(1, Math.max(0, (z - 0.75) / 0.3));
  return (1 - t * 0.2).toFixed(3);
});

// Vue Flow's Background/MiniMap take plain color props (not CSS custom
// properties resolved through style), so they need theme-reactive JS values
// rather than var(--tc-...) references. Same hue-43 neutral family as
// --tc-bg-primary, just stepped enough away from it to read as a legible
// grid rather than a haze at 1px dot size on non-retina displays.
const dotColor = computed(() => (uiStore.resolvedTheme === "light" ? "hsl(40, 20%, 78%)" : "hsl(40, 15%, 24%)"));
const minimapMaskColor = computed(() =>
  uiStore.resolvedTheme === "light" ? "hsla(43, 30%, 97%, 0.7)" : "hsla(43, 28%, 5%, 0.7)"
);
// A bright, theme-independent highlight for the node currently hovered (in the
// sidebar Layers list or on the canvas) so it's easy to locate on the minimap.
const MINIMAP_HIGHLIGHT = "hsl(38, 92%, 62%)";
// NB: both of these read uiStore.minimapHighlightId / resolvedTheme in the
// computed BODY (not only inside the returned closure) so the computed itself
// depends on them -- otherwise MiniMap would keep calling a stale function and
// the highlight would never update when the hovered item changes.
const minimapNodeColor = computed(() => {
  const highlight = uiStore.minimapHighlightId;
  const light = uiStore.resolvedTheme === "light";
  return (node: Node) => {
    if (node.id === highlight) return MINIMAP_HIGHLIGHT;
    if (node.type === "group") return "hsla(152, 62%, 45%, 0.35)";
    if (node.type === "note") return light ? "hsl(43, 55%, 70%)" : "hsl(43, 45%, 24%)";
    if (node.type === "file") return light ? "hsl(203, 65%, 55%)" : "hsl(199, 88%, 58%)";
    // Terminal nodes get a bright, high-contrast fill so they read clearly
    // against the minimap's own background at a glance -- the same accent
    // hue as everywhere else, just resolved per theme.
    return light ? "hsl(221, 88%, 45%)" : "hsl(218, 94%, 51%)";
  };
});
// node-stroke-color only accepts a plain string (unlike node-color, which can
// be a per-node function), so the hovered-item highlight rides entirely on the
// bright fill from minimapNodeColor above.
const minimapStrokeColor = computed(() =>
  uiStore.resolvedTheme === "light" ? "hsl(221, 80%, 55%)" : "hsl(218, 96%, 61%)"
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
  getSelectedEdges,
  getNode,
  addSelectedNodes,
  removeSelectedNodes,
  zoomIn,
  zoomOut,
  zoomTo,
  setCenter,
  getViewport,
  screenToFlowCoordinate,
} = useVueFlow("canvas");

// Register custom node types
const nodeTypes: Record<string, any> = {
  terminal: markRaw(TerminalNode),
  group: markRaw(GroupNode),
  note: markRaw(StickyNoteNode),
  file: markRaw(FileCanvasNode),
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
/**
 * Connection colors are derived from what's at each end rather than stored on
 * the edge, so an edge can't drift out of sync with the nodes it joins. A
 * terminal-to-terminal link ("these two sessions are related") reads in the
 * accent (azure); a terminal-to-file link ("this file came out of that
 * session") reads in --tc-info (cyan-blue) -- the same color the file nodes
 * use on the minimap -- so the pairing is legible at a glance without a
 * legend even though both are now in the "cool" half of the palette.
 */
const TERMINAL_LINK_COLOR = "hsl(218, 94%, 51%)";
const FILE_LINK_COLOR = "hsl(199, 88%, 58%)";

function edgeColor(source: string, target: string): string {
  const fileIds = new Set(workspaceStore.fileNodes.map((f) => f.id));
  const touchesFile = fileIds.has(source) || fileIds.has(target);
  return touchesFile ? FILE_LINK_COLOR : TERMINAL_LINK_COLOR;
}

const allEdges = computed(() =>
  (workspaceStore.edges || []).map((edge) => {
    const color = edgeColor(edge.source, edge.target);
    return {
      ...edge,
      // Bezier: it curves away from the handle before heading for the target,
      // which stays readable when two nodes overlap or sit at odd angles.
      type: "default",
      animated: false,
      style: { stroke: color, strokeWidth: 2 },
      // Selection has to be visible for "click the link, press Delete" to be a
      // discoverable way to break one.
      selectable: true,
      // Renders Vue Flow's built-in edge-updater dots at both ends (see the
      // .vue-flow__edgeupdater rule below) -- grab one and drag it into empty
      // space to disconnect (handleEdgeUpdateEnd), or onto a different node's
      // handle to re-point the link there (handleEdgeUpdate).
      updatable: true,
      data: { color },
    };
  })
);

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

const fileCanvasNodes = computed<Node[]>(() =>
  workspaceStore.fileNodes.map((file) => ({
    id: file.id,
    type: "file",
    position: { x: file.x, y: file.y },
    width: file.width,
    height: file.height,
    data: { file },
    selectable: true,
    draggable: true,
    resizable: true,
  }))
);

const allNodes = computed<Node[]>(() => [
  ...groupNodes.value,      // groups rendered behind terminals
  ...terminalNodes.value,
  ...stickyNoteNodes.value,
  ...fileCanvasNodes.value,
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
      const fileNode = workspaceStore.fileNodes.find((f) => f.id === change.id);
      if (fileNode && dimChange.dimensions) {
        workspaceStore.updateFileNode(change.id, {
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
      } else if (workspaceStore.fileNodes.find((f) => f.id === selectChange.id)) {
        const newSet = new Set(workspaceStore.selectedFileIds);
        if (selectChange.selected) {
          newSet.add(selectChange.id);
        } else {
          newSet.delete(selectChange.id);
        }
        workspaceStore.selectedFileIds = newSet;
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
    // Files belong here too: selecting an editor row in the Layers tree writes
    // to the store, and without this the canvas never reflects it.
    files: Array.from(workspaceStore.selectedFileIds).sort().join(","),
  }),
  () => {
    const vfSelected = new Set(getSelectedNodes.value.map((n) => n.id));
    const storeSelected = new Set([
      ...terminalStore.selectedTerminalIds,
      ...workspaceStore.selectedNoteIds,
      ...workspaceStore.selectedGroupIds,
      ...workspaceStore.selectedFileIds,
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
/** Nodes linked to the dragged one by an edge; they travel with it. */
let linkedDragIds: string[] = [];

function resetGroupDrag(): void {
  groupDragId = null;
  groupDragSiblings = [];
  groupDragNotes = [];
  groupDragLast = null;
  linkedDragIds = [];
}

/**
 * Every node reachable from `startId` by following cohesive edges, excluding
 * itself.
 *
 * A hand-drawn terminal-to-terminal link means "these belong together", so
 * dragging one end brings the whole connected cluster along. Breaking the edge
 * (select it and press Delete) is how you opt out.
 *
 * Edges touching a file node are deliberately NOT cohesive. Those are drawn
 * automatically the moment a file is dragged out of a terminal (see
 * handleCanvasDrop) -- nobody asked for them, so they record provenance
 * ("this editor came out of that session") rather than gluing the two
 * together. The line stays; the editor moves on its own.
 */
function collectLinkedNodes(startId: string): string[] {
  const edges = workspaceStore.edges;
  if (edges.length === 0) return [];

  const fileIds = new Set(workspaceStore.fileNodes.map((f) => f.id));
  const cohesive = edges.filter((e) => !fileIds.has(e.source) && !fileIds.has(e.target));
  if (cohesive.length === 0) return [];

  const seen = new Set<string>([startId]);
  const queue = [startId];
  const found: string[] = [];

  while (queue.length > 0) {
    const current = queue.shift() as string;
    for (const edge of cohesive) {
      const neighbour =
        edge.source === current ? edge.target : edge.target === current ? edge.source : null;
      if (!neighbour || seen.has(neighbour)) continue;
      seen.add(neighbour);
      found.push(neighbour);
      queue.push(neighbour);
    }
  }
  return found;
}

/**
 * Move a node *live*, during an in-progress drag, without touching the
 * workspace store.
 *
 * Vue Flow's `:nodes` prop is two-way bound (see its `useWatchProps`): any
 * store mutation that changes the array we pass in makes Vue Flow re-sync its
 * whole internal node list from that array. That's exactly what a cohesion
 * nudge did every frame -- and since the node actually being dragged only has
 * its *final* position committed to the store at drag-stop (Vue Flow tracks
 * it internally in the meantime), that resync stomped the in-progress drag
 * position back to its stale, pre-drag value on every single frame. The
 * dragged node would freeze/jitter while the *other* end of the link visibly
 * moved -- "moving the file node instead moves the terminal".
 *
 * The fix: while the drag is live, move linked/sibling/group-frame nodes
 * through Vue Flow's own node lookup (the same object its drag code mutates
 * internally), which repaints them immediately but never touches our store,
 * so the prop array never changes shape mid-drag. `commitNodePosition` below
 * writes the real, final position to the store exactly once, at drag-stop.
 */
function nudgeNodeLive(id: string, dx: number, dy: number): void {
  const n = getNode.value(id);
  if (!n) return;
  n.position = { x: n.position.x + dx, y: n.position.y + dy };
}

/** Write a node's current (Vue-Flow-tracked) position back to whichever store owns it. */
function commitNodePosition(id: string): void {
  const n = getNode.value(id);
  if (!n) return;
  const { x, y } = n.position;
  if (terminalStore.sessions.has(id)) {
    terminalStore.updateNode(id, { x, y });
    return;
  }
  if (workspaceStore.fileNodes.some((f) => f.id === id)) {
    workspaceStore.updateFileNode(id, { x, y });
    return;
  }
  if (workspaceStore.stickyNotes.some((note) => note.id === id)) {
    workspaceStore.updateStickyNote(id, { x, y });
    return;
  }
  if (workspaceStore.groups.some((g) => g.id === id)) {
    workspaceStore.updateGroup(id, { x, y });
  }
}

/**
 * Option/Alt-drag duplicates a terminal, Figma-style: the original stays
 * exactly where it was and a copy appears where you let go.
 *
 * Alt is the only modifier free to mean this -- Ctrl, Meta and Shift are all
 * bound to multi-selection on the pane (see :multi-selection-key-code), and Alt
 * is also what Figma itself uses for duplicate-drag, so the gesture transfers.
 *
 * Implemented as "let the real node drag, then snap it back and create the copy
 * at the drop point" rather than by dragging a clone: a terminal is a live PTY,
 * and the session the user was watching must not be the one that moves.
 */
let duplicateDrag: { id: string; x: number; y: number } | null = null;

function handleNodeDragStart({ node, nodes, event }: { node: Node; nodes: Node[]; event: MouseEvent | TouchEvent }): void {
  resetGroupDrag();

  duplicateDrag =
    node.type === "terminal" &&
    (nodes?.length ?? 1) <= 1 &&
    "altKey" in event &&
    event.altKey
      ? { id: node.id, x: node.position.x, y: node.position.y }
      : null;

  // `nodes` is every node Vue Flow is moving this drag -- one for a plain
  // drag, all of them for a shift-selection or rubber-band drag. Vue Flow
  // moves those itself, so cohesion must only pull in nodes *outside* the
  // drag set or they get the delta twice and land at double the distance.
  const dragging = nodes?.length ? nodes : [node];
  const draggingIds = new Set(dragging.map((n) => n.id));

  groupDragLast = { x: node.position.x, y: node.position.y };
  linkedDragIds = [
    ...new Set(dragging.flatMap((n) => collectLinkedNodes(n.id))),
  ].filter((id) => !draggingIds.has(id));

  // Group cohesion stays a single-node gesture: dragging a whole selection
  // that happens to contain grouped terminals already moves them directly.
  if (draggingIds.size > 1) return;

  if (node.type !== "terminal") return;
  const session = terminalStore.sessions.get(node.id);
  if (!session?.groupId) return;
  const group = workspaceStore.groups.find((g) => g.id === session.groupId);
  if (!group) return;
  groupDragId = group.id;
  groupDragSiblings = group.terminalIds.filter((id) => id !== node.id);
  groupDragNotes = [...group.noteIds];
  // A node can be both grouped and linked; move it once, not twice.
  const alreadyMoving = new Set([...groupDragSiblings, ...groupDragNotes]);
  linkedDragIds = linkedDragIds.filter((id) => !alreadyMoving.has(id));
}

function handleNodeDrag({ node }: { node: Node }): void {
  if (!groupDragLast) return;
  const dx = node.position.x - groupDragLast.x;
  const dy = node.position.y - groupDragLast.y;
  if (dx === 0 && dy === 0) return;
  groupDragLast = { x: node.position.x, y: node.position.y };

  // Linked nodes travel with whatever they're connected to.
  for (const id of linkedDragIds) nudgeNodeLive(id, dx, dy);

  if (!groupDragId) return;

  // Move sibling terminals live.
  for (const id of groupDragSiblings) nudgeNodeLive(id, dx, dy);
  // Move member notes live.
  for (const id of groupDragNotes) nudgeNodeLive(id, dx, dy);
  // Move the group frame itself so it stays wrapped around its contents.
  nudgeNodeLive(groupDragId, dx, dy);
}

function handleNodeDragStop({ node, nodes }: { node: Node; nodes: Node[] }): void {
  // Option-drag: put the original back and spawn the copy where it was dropped.
  // Returns early -- none of the normal move bookkeeping applies to a node that
  // didn't actually move.
  if (duplicateDrag && duplicateDrag.id === node.id) {
    const { x, y } = duplicateDrag;
    const dropped = { x: node.position.x, y: node.position.y };
    duplicateDrag = null;
    node.position = { x, y };
    terminalStore.updateNode(node.id, { x, y });
    resetGroupDrag();
    void terminalStore.duplicateSession(node.id, dropped).then((copy) => {
      if (copy) uiStore.showToast(`Duplicated as ${copy.manualName ?? copy.name}`);
    });
    return;
  }
  duplicateDrag = null;

  // Linked nodes were only moved live inside Vue Flow during the drag (see
  // nudgeNodeLive) -- write their real final position to the store now, once.
  for (const id of linkedDragIds) commitNodePosition(id);

  // Everything else Vue Flow moved in this drag. Shift-clicking several nodes
  // and dragging one of them only ever committed the grabbed node, so the
  // rest snapped back to their old positions on the next store-driven render.
  for (const n of nodes ?? []) {
    if (n.id !== node.id) commitNodePosition(n.id);
  }

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
    // Same as linkedDragIds above: siblings, member notes and the group
    // frame were only moved live inside Vue Flow -- commit their real final
    // position to the store now that the drag is done.
    if (groupDragId) {
      for (const id of groupDragSiblings) commitNodePosition(id);
      for (const id of groupDragNotes) commitNodePosition(id);
      commitNodePosition(groupDragId);
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
  } else if (node.type === "file") {
    workspaceStore.updateFileNode(node.id, {
      x: node.position.x,
      y: node.position.y,
    });
  }
}

/**
 * Handle new connections between nodes.
 */
function handleConnect(params: { source: string; target: string }): void {
  if (params.source === params.target) return;
  workspaceStore.addEdge({ source: params.source, target: params.target });
}

/**
 * Double-clicking a connection cuts it. Selecting it and pressing Delete works
 * too (see handleKeyDown), but that isn't something anyone discovers on a line
 * they just drew, so the direct gesture exists as well.
 */
function handleEdgeDoubleClick({ edge }: { edge: { id: string } }): void {
  workspaceStore.removeEdge(edge.id);
  uiStore.showToast("Link removed");
}

/**
 * Edge-updater dots (rendered at both ends of a link via Vue Flow's built-in
 * `updatable` edges, styled in <style> below as small draggable circles):
 * grab one and drag it onto a different node to re-point the link there, or
 * drag it into empty space to disconnect -- the standard way node-graph
 * editors let you break a connection without hunting for a double-click
 * target on a thin line.
 *
 * Vue Flow only fires `edge-update` when the drag ends on a *valid* new
 * target; `edge-update-end` fires unconditionally on mouse-up. So: assume
 * failure at drag-start, flip the flag inside the success handler, and if
 * it's still unset by the time the drag ends, that was a drop into empty
 * space -- remove the edge.
 */
let edgeUpdateSucceeded = false;
// Where the endpoint drag began, so a click can be told apart from a drag.
let edgeUpdateStart: { x: number; y: number } | null = null;

// A mouseup this close to the mousedown is a click, not a drop into empty
// space -- and a click must never silently delete a link.
const EDGE_UPDATE_CLICK_SLOP = 4;

/** Screen coordinates of a pointer event, whether it came from mouse or touch. */
function pointerXY(event: MouseEvent | TouchEvent): { x: number; y: number } | null {
  if ("clientX" in event) return { x: event.clientX, y: event.clientY };
  const touch = event.changedTouches?.[0] ?? event.touches?.[0];
  return touch ? { x: touch.clientX, y: touch.clientY } : null;
}

function handleEdgeUpdateStart({ event }: { event: MouseEvent | TouchEvent }): void {
  edgeUpdateSucceeded = false;
  edgeUpdateStart = pointerXY(event);
}

function handleEdgeUpdate({
  edge,
  connection,
}: {
  edge: { id: string; label?: unknown };
  connection: { source: string | null; target: string | null };
}): void {
  // Set before the self-link guard: any drop Vue Flow accepted counts as
  // handled, so bailing out here leaves the original link intact instead of
  // letting handleEdgeUpdateEnd treat it as a drop into nowhere and delete it.
  edgeUpdateSucceeded = true;
  const { source, target } = connection;
  if (!source || !target || source === target) return;
  workspaceStore.removeEdge(edge.id);
  // Carry the label across -- re-adding without it silently dropped the link's
  // label on every successful reconnect.
  workspaceStore.addEdge({
    source,
    target,
    label: typeof edge.label === "string" ? edge.label : undefined,
  });
}

function handleEdgeUpdateEnd({
  edge,
  event,
}: {
  edge: { id: string };
  event: MouseEvent | TouchEvent;
}): void {
  const start = edgeUpdateStart;
  edgeUpdateStart = null;
  if (edgeUpdateSucceeded) return;

  // Deleting persisted workspace data with no undo needs a deliberate gesture.
  const end = pointerXY(event);
  if (start && end) {
    if (Math.hypot(end.x - start.x, end.y - start.y) < EDGE_UPDATE_CLICK_SLOP) return;
  }

  workspaceStore.removeEdge(edge.id);
  uiStore.showToast("Link removed");
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
    } else if (node.type === "file") {
      workspaceStore.updateFileNode(node.id, {
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
  // Link cohesion is deliberately NOT applied here. Vue Flow's NodesSelection
  // emits nodeDragStart/nodeDrag/nodeDragStop alongside the selection events,
  // so the node-drag handlers above have already nudged and committed every
  // linked node exactly once. Re-applying the delta here moved them twice --
  // a linked file node dragged 300px landed 600px away.
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

  // Focus Mode owns its own keys (see FocusMode.vue) -- don't let canvas
  // shortcuts (Delete, zoom, group) fire underneath the overlay.
  if (uiStore.focusModeActive) return;

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
    const selectedFiles = Array.from(workspaceStore.selectedFileIds);
    // Breaking a link is a deletion like any other: click the line, press
    // Delete. This is how a file stops travelling with the terminal it came out
    // of without having to close either one.
    const selectedEdges = getSelectedEdges.value.map((e) => e.id);
    const total =
      selectedTerminals.length +
      selectedNotes.length +
      selectedGroups.length +
      selectedFiles.length +
      selectedEdges.length;
    if (total === 0) return;

    for (const id of selectedEdges) {
      workspaceStore.removeEdge(id);
    }

    // Deleting terminals can discard unsaved file edits, so it goes through the
    // same guarded close as every other teardown path. Fire-and-forget is fine
    // here: the rest of the Delete branch only touches notes, files and groups.
    void (async () => {
      for (const id of selectedTerminals) {
        await terminalStore.closeSession(id);
      }
    })();
    terminalStore.clearSelection();

    for (const id of selectedNotes) {
      workspaceStore.removeStickyNote(id);
    }
    workspaceStore.clearNoteSelection();

    // Closing a file node only removes it from the canvas; nothing is deleted
    // from disk, which is why this needs no confirmation.
    for (const id of selectedFiles) {
      workspaceStore.removeFileNode(id);
    }
    workspaceStore.clearFileSelection();

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

/**
 * Stepping order for the prev/next arrows: project folder first, position
 * second.
 *
 * Terminals are bucketed by working directory -- the same key arrangeByPath
 * buckets on -- so stepping walks every terminal in one project before moving
 * to the next, instead of zig-zagging between projects because two unrelated
 * terminals happen to sit at a similar y. After Arrange this matches the
 * columns it just produced exactly: buckets ordered by their leftmost member,
 * top-to-bottom inside each. Before Arrange it still holds, since the ordering
 * is derived from live positions rather than from having run Arrange.
 */
const orderedTerminals = computed(() => {
  const buckets = new Map<string, TerminalSession[]>();
  for (const s of terminalStore.allSessions) {
    const key = s.cwd || "~";
    const bucket = buckets.get(key);
    if (bucket) bucket.push(s);
    else buckets.set(key, [s]);
  }

  const byPosition = (a: TerminalSession, b: TerminalSession) => {
    if (Math.abs(a.node.y - b.node.y) > 40) return a.node.y - b.node.y;
    return a.node.x - b.node.x;
  };

  return [...buckets.values()]
    .map((list) => [...list].sort(byPosition))
    .sort((a, b) => {
      const leftA = Math.min(...a.map((s) => s.node.x));
      const leftB = Math.min(...b.map((s) => s.node.x));
      if (leftA !== leftB) return leftA - leftB;
      return Math.min(...a.map((s) => s.node.y)) - Math.min(...b.map((s) => s.node.y));
    })
    .flat();
});

// The nav/arrange chrome recedes once you're zoomed in and working inside a
// terminal, and comes back to full strength on hover.
const navPanelFaded = computed(() => workspaceStore.viewport.zoom >= 1);

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

// --- Detaching a file tab onto the canvas -------------------------

const fileStore = useFileStore();

/**
 * A file tab dragged out of a terminal and dropped on empty canvas becomes its
 * own node at the drop point, pinned to the terminal it came from so it travels
 * with that session.
 */
function handleCanvasDrop(event: DragEvent): void {
  const path = event.dataTransfer?.getData("application/x-cate-file");
  if (!path) return;
  event.preventDefault();

  // Dropping onto an existing node means "put it there", not "detach it here" --
  // let that node's own handler deal with it instead of stacking a file on top.
  const overNode = (event.target as HTMLElement | null)?.closest(".vue-flow__node");
  if (overNode) return;

  const sourceTerminalId = event.dataTransfer?.getData("application/x-cate-file-terminal") || null;
  const position = screenToFlowCoordinate({ x: event.clientX, y: event.clientY });

  // Land at the height of the terminal it came out of, so the editor reads as
  // that session's file rather than an arbitrarily-sized card next to it. The
  // floor is NodeResizer's own min-height -- matching a terminal that has been
  // squashed below that would create a node the user can't shrink back into.
  const source = sourceTerminalId ? terminalStore.sessions.get(sourceTerminalId) : undefined;
  const height = source?.node.height ? Math.max(source.node.height, 180) : undefined;

  const created = workspaceStore.createFileNode({
    path,
    x: position.x,
    y: position.y,
    height,
    pinnedToTerminalId: sourceTerminalId,
  });
  if (!created) return;

  // Draw the link the moment the file lands, so where it came from is visible
  // rather than something you have to remember. It's an ordinary edge -- select
  // it and press Delete to cut the file loose.
  if (sourceTerminalId) {
    workspaceStore.addEdge({ source: sourceTerminalId, target: created.id });
  }

  // The canvas node takes its own reference to the buffer, so closing the tab
  // it came from doesn't tear the file down underneath it.
  void fileStore.open(path);
  if (sourceTerminalId) fileStore.closeInTerminal(sourceTerminalId, path);
}

function handleCanvasDragOver(event: DragEvent): void {
  if (!event.dataTransfer?.types.includes("application/x-cate-file")) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = "move";
}

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
  <div
    ref="rootEl"
    class="workspace-canvas-root"
    @dragover="handleCanvasDragOver"
    @drop="handleCanvasDrop"
  >
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
    :connection-mode="ConnectionMode.Loose"
    :connection-radius="45"
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
    @edge-double-click="handleEdgeDoubleClick"
    @edge-update-start="handleEdgeUpdateStart"
    @edge-update="handleEdgeUpdate"
    @edge-update-end="handleEdgeUpdateEnd"
    @viewport-change="handleViewportChange"
  >
    <!-- Dotted background grid -->
    <Background
      :variant="BackgroundVariant.Dots"
      :gap="22"
      :size="1.6"
      :color="dotColor"
    />

    <!-- Navigation cluster: minimap and zoom controls share the bottom-left
         corner as one unit, so "where am I / change what I can see" is a single
         place to look instead of two opposite corners. Both are nested inside
         one Panel and un-absoluted in CSS; the zoom column sits to the right of
         the minimap and slides into the corner on its own when the minimap is
         turned off. The interactive ("lock") toggle stays absent: it froze node
         dragging with no visible state anywhere, so the only way to discover
         you'd hit it was that the canvas stopped responding. -->
    <Panel position="bottom-left" class="canvas-nav-cluster">
      <!-- Zoom column first (hard against the corner) so the minimap, which
           scales up on hover, grows right into open canvas instead of over the
           buttons. -->
      <Controls :show-interactive="false" />
      <MiniMap
        v-if="uiStore.minimapVisible"
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
    </Panel>

    <!-- Navigate / arrange controls -->
    <Panel
      position="top-right"
      class="canvas-nav-panel"
      :class="{ 'canvas-nav-faded': navPanelFaded }"
    >
      <button
        class="canvas-nav-btn"
        title="Previous terminal in this project folder"
        :disabled="terminalStore.sessionCount === 0"
        @click="navToTerminal(-1)"
      >
        <ChevronLeft :size="16" />
      </button>
      <button
        class="canvas-nav-btn"
        title="Next terminal in this project folder"
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
      <div
        v-if="showZoomedInPopup"
        class="hovered-info-popup"
        :style="{ '--popup-scale': hoveredInfoScale }"
      >
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

    <!-- Empty-canvas start panel: shown until the first terminal exists, so a
         fresh workspace teaches its own controls instead of showing a blank
         dotted plane. Disappears the moment allSessions is non-empty and
         never comes back for this workspace (nothing to dismiss/remember). -->
    <!-- Only when the canvas is empty of *everything*. Gating on terminals
         alone left this card sitting over the middle of a populated canvas,
         swallowing clicks -- and its own "new note" action placed the note
         at the viewport centre, directly underneath it. -->
    <div
      v-if="
        terminalStore.allSessions.length === 0 &&
        workspaceStore.stickyNotes.length === 0 &&
        workspaceStore.fileNodes.length === 0 &&
        workspaceStore.groups.length === 0
      "
      class="canvas-empty"
    >
      <div class="canvas-empty-card">
        <SquareTerminal class="canvas-empty-icon" :size="30" />
        <h2 class="canvas-empty-title">Terminal Canvas</h2>
        <p class="canvas-empty-subtitle">Infinite canvas for coding-agent terminals</p>

        <div class="canvas-empty-section">
          <span class="canvas-empty-label">Start</span>
          <button class="canvas-empty-action" @click="emptyNewTerminal">
            <SquareTerminal :size="15" />
            <span>New Terminal</span>
            <kbd>{{ modKeyLabel }}N</kbd>
          </button>
          <button class="canvas-empty-action" @click="emptyNewTerminalInFolder">
            <FolderOpen :size="15" />
            <span>New Terminal in Folder…</span>
          </button>
          <button class="canvas-empty-action" @click="emptyNewNote">
            <StickyNote :size="15" />
            <span>Add Sticky Note</span>
          </button>
        </div>

        <div class="canvas-empty-section">
          <span class="canvas-empty-label">Keyboard shortcuts</span>
          <div class="canvas-empty-shortcuts">
            <div class="canvas-empty-shortcut"><kbd>{{ modKeyLabel }}N</kbd><span>New Terminal</span></div>
            <div class="canvas-empty-shortcut"><kbd>{{ modKeyLabel }}S</kbd><span>Save Workspace</span></div>
            <div class="canvas-empty-shortcut"><kbd>{{ modKeyLabel }}⇧P</kbd><span>Command Palette</span></div>
            <div class="canvas-empty-shortcut"><kbd>{{ modKeyLabel }}⇧F</kbd><span>Focus Mode</span></div>
            <div class="canvas-empty-shortcut"><kbd>{{ modKeyLabel }}G</kbd><span>Group Selected</span></div>
            <div class="canvas-empty-shortcut"><kbd>{{ modKeyLabel }}0</kbd><span>Reset Zoom</span></div>
          </div>
        </div>
      </div>
    </div>
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

/* ─── Empty-canvas start panel ─────────────────────────────────── */
.canvas-empty {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
  z-index: 20;
}

.canvas-empty-card {
  pointer-events: auto;
  width: 360px;
  max-width: calc(100vw - 48px);
  padding: 28px 26px 22px;
  border-radius: calc(var(--tc-border-radius) * 2);
  border: 1px solid var(--tc-border-color);
  background: var(--tc-hero-glow), var(--tc-bg-card);
  background-repeat: no-repeat;
  box-shadow: var(--tc-shadow-lg);
  text-align: center;
}

.canvas-empty-icon {
  color: var(--tc-accent);
  margin-bottom: 10px;
}

.canvas-empty-title {
  font-size: var(--tc-font-size-lg);
  font-weight: 700;
  color: var(--tc-text-primary);
  margin: 0 0 4px;
}

.canvas-empty-subtitle {
  font-size: var(--tc-font-size-sm);
  color: var(--tc-text-muted);
  margin: 0 0 22px;
}

.canvas-empty-section {
  text-align: left;
  margin-top: 18px;
}

.canvas-empty-section:first-of-type {
  margin-top: 0;
}

.canvas-empty-label {
  display: block;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--tc-text-muted);
  margin-bottom: 8px;
}

.canvas-empty-action {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 8px 10px;
  border: none;
  border-radius: var(--tc-border-radius-sm);
  background: transparent;
  color: var(--tc-text-primary);
  font-size: var(--tc-font-size-sm);
  font-family: var(--tc-font-sans);
  cursor: pointer;
  transition: background var(--tc-transition-fast);
}

.canvas-empty-action:hover {
  background: var(--tc-bg-hover);
}

.canvas-empty-action svg {
  color: var(--tc-accent);
  flex-shrink: 0;
}

.canvas-empty-action span {
  flex: 1;
  text-align: left;
}

.canvas-empty-action kbd {
  font-family: var(--tc-font-mono);
  font-size: 10px;
  color: var(--tc-text-muted);
  background: var(--tc-bg-secondary);
  border: 1px solid var(--tc-border-color);
  padding: 2px 5px;
  border-radius: 4px;
}

.canvas-empty-shortcuts {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px 14px;
}

.canvas-empty-shortcut {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: var(--tc-font-size-xs);
  color: var(--tc-text-secondary);
}

.canvas-empty-shortcut kbd {
  font-family: var(--tc-font-mono);
  font-size: 10px;
  color: var(--tc-text-secondary);
  background: var(--tc-bg-secondary);
  border: 1px solid var(--tc-border-color);
  padding: 2px 5px;
  border-radius: 4px;
  min-width: 20px;
  text-align: center;
  flex-shrink: 0;
}

/* Lift a hovered terminal above its neighbours so its hover-detail card (which
   overflows the node's top edge) is never clipped or covered by an adjacent
   terminal sitting in front of it. !important overrides Vue Flow's inline
   per-node z-index; scoped to terminal nodes so groups/notes don't jump. */
.workspace-canvas :deep(.vue-flow__node-terminal:hover) {
  z-index: 1000 !important;
}

/* A file dragged out of a terminal sits ON TOP of every terminal, always --
   including a hovered or selected one (both of which sit at 1000 above).
   Detaching an editor is an explicit "I want to read this next to the
   session", and it landing behind the terminal it came from read as the drag
   having failed. Trade-off accepted: an editor overlapping a hovered terminal
   now covers that terminal's hover card. */
.workspace-canvas :deep(.vue-flow__node-file) {
  z-index: 1100 !important;
}

.workspace-canvas :deep(.vue-flow__node-file.selected) {
  z-index: 1200 !important;
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

/* Zoomed-in hovered-terminal info popup (upper-left of the canvas). It owns
   that corner outright now that the terminal-count panel is gone. */
.hovered-info-popup {
  position: absolute;
  top: 10px;
  left: 10px;
  z-index: 21;
  width: 232px;
  max-width: calc(100% - 20px);
  padding: 7px 10px;
  /* Translucent rather than solid: it floats over live terminals, and at this
     zoom you can still read what's underneath it. The blur keeps the text
     legible against whatever it happens to be sitting on. */
  background: color-mix(in srgb, var(--tc-bg-card) 72%, transparent);
  backdrop-filter: blur(6px);
  border: 1px solid color-mix(in srgb, var(--tc-border-color) 70%, transparent);
  border-left: 2px solid color-mix(in srgb, var(--tc-accent) 75%, transparent);
  border-radius: var(--tc-border-radius-sm);
  box-shadow: var(--tc-shadow-md);
  pointer-events: none;
  user-select: none;
  opacity: 0.82;
  /* Set per-render from the canvas zoom (see hoveredInfoScale). Kept as a
     custom property so the enter/leave transition below can compose its own
     translate with it instead of overwriting the scale. */
  transform: scale(var(--popup-scale, 1));
  transform-origin: top left;
  transition: transform 120ms ease;
}

/* The terminal's name is the secondary line here -- kept small so the last
   command (the thing you're actually scanning for) leads. */
.hovered-info-name {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 10.5px;
  font-weight: 600;
  color: var(--tc-text-muted);
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

/* The last command reads first: larger, bolder, primary-coloured. */
.hovered-info-cmd {
  margin-top: 3px;
  font-size: 12.5px;
  font-weight: 600;
  line-height: 1.35;
  color: var(--tc-text-primary);
  font-family: var(--tc-font-mono);
  display: -webkit-box;
  -webkit-line-clamp: 3;
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
  transform: translateY(-4px) scale(var(--popup-scale, 1));
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
  transition: opacity var(--tc-transition-fast);
}

/* Zoomed in, this is chrome sitting over the terminal you're working in --
   present enough to find, quiet enough to ignore, full strength on hover. */
.canvas-nav-panel.canvas-nav-faded {
  opacity: 0.32;
}

.canvas-nav-panel.canvas-nav-faded:hover {
  opacity: 1;
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

/* Navigation cluster (minimap + zoom), bottom-left. Vue Flow positions both of
   these absolutely against the pane by default; nested inside one Panel they
   have to be un-absoluted so the flex row can lay them out side by side. Ends
   aligned so the short zoom column sits level with the minimap's bottom edge. */
.canvas-nav-cluster {
  display: flex;
  align-items: flex-end;
  gap: 8px;
}

.canvas-nav-cluster :deep(.vue-flow__minimap),
.canvas-nav-cluster :deep(.vue-flow__controls) {
  position: relative;
  margin: 0;
  inset: auto;
}

.canvas-nav-cluster :deep(.vue-flow__controls) {
  display: flex;
  flex-direction: column;
  background: var(--tc-bg-card);
  border: 1px solid var(--tc-border-color);
  border-radius: var(--tc-border-radius);
  box-shadow: var(--tc-shadow-md);
  overflow: hidden;
}

.canvas-nav-cluster :deep(.vue-flow__controls-button) {
  width: 26px;
  height: 26px;
  padding: 0;
  background: transparent;
  border: none;
  border-bottom: 1px solid var(--tc-border-color);
  fill: var(--tc-text-secondary);
  cursor: pointer;
  transition: background var(--tc-transition-fast), fill var(--tc-transition-fast);
}

.canvas-nav-cluster :deep(.vue-flow__controls-button:last-child) {
  border-bottom: none;
}

.canvas-nav-cluster :deep(.vue-flow__controls-button:hover) {
  background: var(--tc-bg-hover);
  fill: var(--tc-text-primary);
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
     crisp vector redraw, not a resized raster. Grows up-and-right from the
     bottom-left corner it now lives in, into open canvas. */
  transform-origin: bottom left;
  transition: transform var(--tc-transition-fast), box-shadow var(--tc-transition-fast);
}

.canvas-minimap:hover :deep(.vue-flow__minimap) {
  transform: scale(1.7);
  box-shadow: var(--tc-shadow-lg);
}
</style>

<!-- Not scoped: handles and edges are rendered by Vue Flow outside this
     component's style scope. -->
<style>
/* Connection handles were 6px dots at 1:1 and effectively ungrabbable once the
   canvas was zoomed out at all. Bigger, and they fade up on node hover so an
   idle canvas still reads clean. Paired with :connection-radius, a drop
   anywhere near the target node snaps to its nearest handle. */
.vue-flow__handle {
  width: 11px;
  height: 11px;
  border: 2px solid var(--tc-bg-card);
  background: var(--tc-text-muted);
  opacity: 0;
  transition: opacity var(--tc-transition-fast), background var(--tc-transition-fast);
}

.vue-flow__node:hover .vue-flow__handle,
.vue-flow__node.selected .vue-flow__handle,
.vue-flow__handle.connecting,
.vue-flow__handle.valid {
  opacity: 1;
}

.vue-flow__handle:hover,
.vue-flow__handle.connecting {
  background: var(--tc-accent);
}

/* The line you're currently dragging, before it lands anywhere. */
.vue-flow__connection-path {
  stroke: var(--tc-accent);
  stroke-width: 2;
  stroke-dasharray: 5 4;
}

/* Wide invisible stroke under each edge so a 2px line is still easy to click --
   this is what makes "select the link and press Delete" usable. */
.vue-flow__edge-interaction {
  stroke-width: 18;
}

.vue-flow__edge:hover .vue-flow__edge-path {
  stroke-width: 3;
}

.vue-flow__edge.selected .vue-flow__edge-path {
  stroke-width: 3.5;
  filter: drop-shadow(0 0 3px currentColor);
}

.vue-flow__edge {
  cursor: pointer;
}

/* Edge-updater dots (see `updatable: true` in allEdges) -- Vue Flow renders
   these as invisible hit-circles by default; drawn here as small filled dots
   so "grab this to disconnect or re-point the link" is discoverable, but
   only revealed on hover/selection to match the rest of the canvas (no
   permanent chrome on every idle link). */
.vue-flow__edgeupdater {
  fill: var(--tc-bg-card);
  stroke: var(--tc-accent);
  stroke-width: 2px;
  r: 6;
  opacity: 0;
  transition: opacity var(--tc-transition-fast), r var(--tc-transition-fast);
}

.vue-flow__edge:hover .vue-flow__edgeupdater,
.vue-flow__edge.selected .vue-flow__edgeupdater {
  opacity: 1;
}

.vue-flow__edgeupdater:hover {
  r: 8;
  fill: var(--tc-accent);
}
</style>
