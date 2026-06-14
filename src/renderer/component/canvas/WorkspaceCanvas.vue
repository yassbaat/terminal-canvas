<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, markRaw, watch } from "vue";
import { VueFlow, Panel, SelectionMode } from "@vue-flow/core";
import type { VueFlowStore } from "@vue-flow/core";
import { Background, BackgroundVariant } from "@vue-flow/background";
import { Controls } from "@vue-flow/controls";
import { MiniMap } from "@vue-flow/minimap";
import type { Node, NodeChange, NodeDimensionChange, NodeSelectionChange, GraphNode } from "@vue-flow/core";
import { useTerminalStore } from "@renderer/store/terminal";
import { useWorkspaceStore } from "@renderer/store/workspace";
import TerminalNode from "./TerminalNode.vue";
import GroupNode from "./GroupNode.vue";
import StickyNoteNode from "./StickyNoteNode.vue";

const terminalStore = useTerminalStore();
const workspaceStore = useWorkspaceStore();

// --- Figma-like Pan / Select State --------------------------------

const isPanKeyPressed = ref(false);

const selectionKeyCode = computed<true | null>(() =>
  isPanKeyPressed.value ? null : true
);

// Disable Vue Flow built-in pan-on-drag so selection box works.
// We implement custom panning for middle-mouse and Shift/Space+left-drag.
const panOnDrag = computed<boolean | number[]>(() => false);

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

const realVueFlowStore = ref<VueFlowStore | null>(null);

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
  workspaceStore.groups.map((group: { id: string; x: number; y: number; width: number; height: number; collapsed: boolean; color?: string; terminalIds: string[]; parentId?: string | null }) => ({
    id: group.id,
    type: "group",
    position: { x: group.x, y: group.y },
    width: group.width,
    height: group.height,
    data: { group },
    selectable: true,
    draggable: true,
    parentNode: group.parentId || undefined,
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
          width: Math.round(dimChange.dimensions.width),
          height: Math.round(dimChange.dimensions.height),
        });
      }
      const note = workspaceStore.stickyNotes.find((n) => n.id === change.id);
      if (note && dimChange.dimensions) {
        workspaceStore.updateStickyNote(change.id, {
          width: Math.round(dimChange.dimensions.width),
          height: Math.round(dimChange.dimensions.height),
        });
      }
    } else if (change.type === "select") {
      const selectChange = change as NodeSelectionChange;
      if (terminalStore.sessions.has(selectChange.id)) {
        if (selectChange.selected !== terminalStore.selectedTerminalIds.has(selectChange.id)) {
          const newSet = new Set(terminalStore.selectedTerminalIds);
          if (selectChange.selected) newSet.add(selectChange.id);
          else newSet.delete(selectChange.id);
          terminalStore.selectedTerminalIds = newSet;
        }
      } else if (workspaceStore.stickyNotes.find((n) => n.id === selectChange.id)) {
        if (selectChange.selected !== workspaceStore.selectedNoteIds.has(selectChange.id)) {
          const newSet = new Set(workspaceStore.selectedNoteIds);
          if (selectChange.selected) newSet.add(selectChange.id);
          else newSet.delete(selectChange.id);
          workspaceStore.selectedNoteIds = newSet;
        }
      } else if (workspaceStore.groups.find((g) => g.id === selectChange.id)) {
        if (selectChange.selected !== workspaceStore.selectedGroupIds.has(selectChange.id)) {
          const newSet = new Set(workspaceStore.selectedGroupIds);
          if (selectChange.selected) newSet.add(selectChange.id);
          else newSet.delete(selectChange.id);
          workspaceStore.selectedGroupIds = newSet;
        }
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
    hasStore: realVueFlowStore.value !== null,
    terminals: Array.from(terminalStore.selectedTerminalIds).sort().join(","),
    notes: Array.from(workspaceStore.selectedNoteIds).sort().join(","),
    groups: Array.from(workspaceStore.selectedGroupIds).sort().join(","),
  }),
  ({ hasStore }) => {
    if (!hasStore) return;
    const store = realVueFlowStore.value!;
    const vfSelected = new Set(store.getSelectedNodes.map((n: GraphNode) => n.id));
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

    const currentlySelected = store.getSelectedNodes;
    const toSelect = [...storeSelected]
      .map((id) => store.getNode(id))
      .filter(Boolean) as GraphNode[];
    const toUnselect = currentlySelected.filter((n: GraphNode) => !storeSelected.has(n.id));

    if (toUnselect.length > 0) store.removeSelectedNodes(toUnselect);
    if (toSelect.length > 0) store.addSelectedNodes(toSelect);
  }
);

// --- Fit View from Sidebar ----------------------------------------

/**
 * When the sidebar requests a fit-view to a specific node, zoom the
 * canvas so that node is centered and clearly visible.
 */
watch(
  () => ({
    hasStore: realVueFlowStore.value !== null,
    targetId: workspaceStore.fitViewTargetId,
  }),
  ({ hasStore, targetId }) => {
    if (!hasStore || !targetId) return;
    const store = realVueFlowStore.value!;
    const node = store.getNode(targetId);
    if (node) {
      store.fitView({ nodes: [targetId], padding: 0.25, duration: 400 });
    }
    workspaceStore.fitViewTargetId = null;
  }
);

// --- Custom Panning (middle-mouse / Shift+left-drag) --------------

const isCustomPanning = ref(false);
const panLastPos = ref({ x: 0, y: 0 });

function handleContainerMouseDown(e: MouseEvent): void {
  const target = e.target as HTMLElement;
  const isOnNode = !!target.closest(".vue-flow__node");
  const isMiddleMouse = e.button === 1;
  const isPanKey = isPanKeyPressed.value || e.shiftKey;
  const isLeftMouse = e.button === 0;

  // Middle mouse always pans (Vue Flow ignores middle clicks).
  // Space/Shift + left mouse pans only on empty canvas to avoid
  // conflicting with node drag/selection.
  if (isMiddleMouse || (isLeftMouse && isPanKey && !isOnNode)) {
    isCustomPanning.value = true;
    panLastPos.value = { x: e.clientX, y: e.clientY };
    e.preventDefault();
    e.stopPropagation();
  }
}

function handleContainerMouseMove(e: MouseEvent): void {
  if (!isCustomPanning.value || !realVueFlowStore.value) return;
  const dx = e.clientX - panLastPos.value.x;
  const dy = e.clientY - panLastPos.value.y;
  const zoom = realVueFlowStore.value.viewport.zoom;
  realVueFlowStore.value.panBy({ x: dx / zoom, y: dy / zoom });
  panLastPos.value = { x: e.clientX, y: e.clientY };
}

function handleContainerMouseUp(): void {
  isCustomPanning.value = false;
}

/**
 * Handle node drag stop -- sync final position back to the store.
 * Also moves pinned sticky notes with their terminal.
 */
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

function handleNodeClickEvent({ node }: { node: GraphNode }): void {
  if (node.type === "terminal") {
    terminalStore.setFocused(node.id);
  }
}

function handlePaneClickEvent(): void {
  terminalStore.setFocused(null);
}

function handleSelectionDragStopEvent({ nodes }: { nodes: GraphNode[] }): void {
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
}

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

  // Delete / Backspace: remove selected terminals, edges, and sticky notes
  if (e.key === "Delete" || e.key === "Backspace") {
    const selected = Array.from(terminalStore.selectedTerminalIds);
    if (selected.length > 0) {
      for (const id of selected) {
        terminalStore.killSession(id);
        terminalStore.removeSession(id);
        workspaceStore.removeEdgesForTerminal(id);
        workspaceStore.unpinNotesForTerminal(id);
      }
      terminalStore.clearSelection();
    }
    e.preventDefault();
    return;
  }
}

onMounted(() => {
  window.addEventListener("keydown", handleKeyDown);
  window.addEventListener("keydown", onPanKeyDown);
  window.addEventListener("keyup", onPanKeyUp);
  window.addEventListener("mousemove", handleContainerMouseMove);
  window.addEventListener("mouseup", handleContainerMouseUp);
});

onUnmounted(() => {
  window.removeEventListener("keydown", handleKeyDown);
  window.removeEventListener("keydown", onPanKeyDown);
  window.removeEventListener("keyup", onPanKeyUp);
  window.removeEventListener("mousemove", handleContainerMouseMove);
  window.removeEventListener("mouseup", handleContainerMouseUp);
  const store = realVueFlowStore.value;
  if (store) {
    const el = store.vueFlowRef;
    if (el) {
      el.removeEventListener("mousedown", handleContainerMouseDown);
    }
  }
});

function handlePaneReady(vueFlowStore: VueFlowStore): void {
  realVueFlowStore.value = vueFlowStore;
  const el = vueFlowStore.vueFlowRef.value;
  if (el) {
    el.addEventListener("mousedown", handleContainerMouseDown);
  }
}
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
    :connectable="true"
    :delete-key-code="null"
    :selection-key-code="selectionKeyCode"
    :multi-selection-key-code="'Control'"
    :pan-on-drag="panOnDrag"
    :selection-mode="SelectionMode.Partial"
    :fit-view-on-init="true"
    @nodes-change="handleNodesChange"
    @node-drag-stop="handleNodeDragStop"
    @selection-drag-stop="handleSelectionDragStopEvent"
    @connect="handleConnect"
    @viewport-change="handleViewportChange"
    @node-click="handleNodeClickEvent"
    @pane-click="handlePaneClickEvent"
    @pane-ready="handlePaneReady"
  >
    <!-- Dotted background grid -->
    <Background
      :variant="BackgroundVariant.Dots"
      :gap="20"
      :size="1"
      color="#2a2a40"
    />

    <!-- Zoom controls -->
    <Controls />

    <!-- Mini map for navigation -->
    <MiniMap
      pannable
      zoomable
      :node-color="(node: Node) =>
        node.type === 'group'
          ? 'rgba(78, 204, 163, 0.3)'
          : '#1e1e2f'
      "
      :mask-color="'rgba(26, 26, 46, 0.7)'"
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

/* Override Vue Flow's grab cursor — default should be normal pointer */
.workspace-canvas :deep(.vue-flow__pane) {
  cursor: default !important;
}
.workspace-canvas :deep(.vue-flow__node) {
  cursor: default;
}
</style>
