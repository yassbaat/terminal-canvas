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
import type { TerminalSession } from "@renderer/type/terminal";
import { ChevronLeft, ChevronRight, LayoutGrid, ArrowRight } from "lucide-vue-next";
import TerminalNode from "./TerminalNode.vue";
import GroupNode from "./GroupNode.vue";
import StickyNoteNode from "./StickyNoteNode.vue";

const terminalStore = useTerminalStore();
const workspaceStore = useWorkspaceStore();
const uiStore = useUIStore();

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
const minimapNodeColor = computed(() => (node: Node) => {
  if (node.type === "group") return "rgba(78, 204, 163, 0.35)";
  if (node.type === "note") return uiStore.resolvedTheme === "light" ? "#f0d878" : "#7a6a2a";
  // Terminal nodes get a bright, high-contrast fill so they read clearly
  // against the minimap's own background at a glance.
  return uiStore.resolvedTheme === "light" ? "#8a7fc2" : "#e94560";
});
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

function onPanKeyDown(e: KeyboardEvent): void {
  if (e.key === "Shift" || e.key === " ") {
    uiStore.isPanKeyPressed = true;
  }
}

function onPanKeyUp(e: KeyboardEvent): void {
  if (e.key === "Shift" || e.key === " ") {
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
    syncGroupMembershipAfterDrag(node.id, node);

    // Move pinned notes with the terminal
    if (dx !== 0 || dy !== 0) {
      for (const note of workspaceStore.stickyNotes) {
        if (note.pinnedToTerminalId === node.id) {
          workspaceStore.updateStickyNote(note.id, {
            x: note.x + dx,
            y: note.y + dy,
          });
        }
      }
    }
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
}

// Stable ordering for prev/next: top-to-bottom, then left-to-right, so
// stepping follows the visual layout rather than creation order.
const orderedTerminals = computed(() =>
  [...terminalStore.allSessions].sort((a, b) => {
    if (Math.abs(a.node.y - b.node.y) > 40) return a.node.y - b.node.y;
    return a.node.x - b.node.x;
  })
);

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

/**
 * Auto-arrange terminals into columns grouped by working directory, so
 * terminals working in the same folder end up adjacent. Explicitly
 * user-triggered (a button), never automatic -- it repositions everything,
 * which would be hostile to do behind the user's back on a canvas they've
 * laid out by hand.
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

  // Bucket by cwd, preserving first-seen order for stable column placement.
  const buckets = new Map<string, TerminalSession[]>();
  for (const s of sessions) {
    const key = s.cwd || "~";
    const bucket = buckets.get(key);
    if (bucket) bucket.push(s);
    else buckets.set(key, [s]);
  }

  let colX = START_X;
  for (const [, group] of buckets) {
    let rowY = START_Y;
    let colWidth = 0;
    for (const s of group) {
      const w = s.node.width || 900;
      const h = s.node.height || 640;
      terminalStore.updateNode(s.id, { x: colX, y: rowY });
      rowY += h + GAP;
      colWidth = Math.max(colWidth, w);
    }
    colX += colWidth + COL_GAP;
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
    if (uiStore.newItemPlacement === "focus") {
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
    :multi-selection-key-code="['Control', 'Meta']"
    :pan-on-drag="panOnDrag"
    :selection-mode="SelectionMode.Partial"
    :fit-view-on-init="true"
    @nodes-change="handleNodesChange"
    @node-drag-stop="handleNodeDragStop"
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
