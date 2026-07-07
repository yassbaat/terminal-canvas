<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, markRaw, watch } from "vue";
import { VueFlow, useVueFlow, Panel, SelectionMode } from "@vue-flow/core";
import { Background, BackgroundVariant } from "@vue-flow/background";
import { Controls } from "@vue-flow/controls";
import { MiniMap } from "@vue-flow/minimap";
import type { Node, NodeChange, NodeDimensionChange, NodeSelectionChange, GraphNode } from "@vue-flow/core";
import { useTerminalStore } from "@renderer/store/terminal";
import { useWorkspaceStore } from "@renderer/store/workspace";
import { useUIStore } from "@renderer/store/ui";
import TerminalNode from "./TerminalNode.vue";
import GroupNode from "./GroupNode.vue";
import StickyNoteNode from "./StickyNoteNode.vue";

const terminalStore = useTerminalStore();
const workspaceStore = useWorkspaceStore();
const uiStore = useUIStore();

// Vue Flow's Background/MiniMap take plain color props (not CSS custom
// properties resolved through style), so they need theme-reactive JS values
// rather than var(--tc-...) references.
const dotColor = computed(() => (uiStore.resolvedTheme === "light" ? "#d6d3e6" : "#2a2a40"));
const minimapMaskColor = computed(() =>
  uiStore.resolvedTheme === "light" ? "rgba(244, 243, 250, 0.7)" : "rgba(26, 26, 46, 0.7)"
);
const minimapNodeColor = computed(() => (node: Node) => {
  if (node.type === "group") return "rgba(78, 204, 163, 0.3)";
  return uiStore.resolvedTheme === "light" ? "#e0dff0" : "#1e1e2f";
});

// --- Figma-like Pan / Select State --------------------------------

const isPanKeyPressed = ref(false);

const selectionKeyCode = computed<true | null>(() =>
  isPanKeyPressed.value ? null : true
);

const panOnDrag = computed<boolean | number[]>(() =>
  isPanKeyPressed.value ? true : [1]
);

function onPanKeyDown(e: KeyboardEvent): void {
  if (e.key === "Shift" || e.key === " ") {
    isPanKeyPressed.value = true;
  }
}

function onPanKeyUp(e: KeyboardEvent): void {
  if (e.key === "Shift" || e.key === " ") {
    isPanKeyPressed.value = false;
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

onMounted(() => {
  window.addEventListener("keydown", handleKeyDown);
  window.addEventListener("keydown", onPanKeyDown);
  window.addEventListener("keyup", onPanKeyUp);
});

onUnmounted(() => {
  window.removeEventListener("keydown", handleKeyDown);
  window.removeEventListener("keydown", onPanKeyDown);
  window.removeEventListener("keyup", onPanKeyUp);
});
</script>

<template>
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
      :gap="20"
      :size="1"
      :color="dotColor"
    />

    <!-- Zoom controls -->
    <Controls />

    <!-- Mini map for navigation -->
    <MiniMap
      pannable
      zoomable
      :node-color="minimapNodeColor"
      :mask-color="minimapMaskColor"
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
  </VueFlow>
</template>

<style scoped>
.workspace-canvas {
  width: 100%;
  height: 100%;
  background: var(--tc-bg-primary);
}

.canvas-status-panel {
  background: var(--tc-bg-card);
  border: 1px solid var(--tc-border-color);
  border-radius: var(--tc-border-radius-sm);
  padding: 4px 10px;
  pointer-events: none;
  user-select: none;
}

.canvas-status-text {
  font-size: var(--tc-font-size-xs);
  color: var(--tc-text-muted);
}

.canvas-status-running {
  color: var(--tc-status-running);
}
</style>
