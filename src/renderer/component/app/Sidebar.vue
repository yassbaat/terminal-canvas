<script setup lang="ts">
import { computed, watch, ref, nextTick } from "vue";
import { useTerminalStore } from "@renderer/store/terminal";
import { useWorkspaceStore } from "@renderer/store/workspace";
import { useUIStore } from "@renderer/store/ui";
import { useFileStore } from "@renderer/store/file";
import { getBasename } from "@renderer/util/path";
import LayerTerminalRow from "@renderer/component/app/LayerTerminalRow.vue";
import { Folder, StickyNote, FileCode2, ChevronDown } from "lucide-vue-next";

const terminalStore = useTerminalStore();
const workspaceStore = useWorkspaceStore();
const uiStore = useUIStore();
const fileStore = useFileStore();

// The list was previously never fetched at all, so this tab always rendered
// as permanently empty regardless of how many workspaces were actually
// saved to disk -- refresh it whenever the tab becomes active.
watch(
  () => uiStore.sidebarTab,
  (tab) => {
    if (tab === "workspaces") {
      workspaceStore.loadWorkspaceList();
    }
  },
  { immediate: true }
);

function openWorkspace(id: string): void {
  workspaceStore.switchToWorkspace(id);
}

const sessions = computed(() => terminalStore.allSessions);

/**
 * Editors that aren't bound to a terminal any more (their session was closed,
 * or they were explicitly unpinned) sit at the top level of the tree -- they
 * are still canvas objects and still need a row.
 */
const unpinnedFiles = computed(() =>
  workspaceStore.fileNodes.filter((f) => !f.pinnedToTerminalId)
);

const activeTab = computed({
  get: () => uiStore.sidebarTab,
  set: (v) => { uiStore.sidebarTab = v; },
});

/**
 * Total count of all layer items (groups + terminals + editors + notes).
 */
const layerCount = computed(() => {
  return (
    workspaceStore.groups.length +
    sessions.value.length +
    workspaceStore.fileNodes.length +
    workspaceStore.stickyNotes.length
  );
});

/**
 * Terminals that are not inside any group.
 */
const ungroupedSessions = computed(() =>
  sessions.value.filter((s) => s.groupId === null)
);

/** Hovering a layer row highlights the matching node on the minimap so the
 * user can see where it lives on the canvas. */
function onLayerEnter(id: string): void {
  uiStore.setHoveredLayer(id);
}
function onLayerLeave(id: string): void {
  if (uiStore.hoveredLayerId === id) uiStore.setHoveredLayer(null);
}

// Keep the focused/navigated terminal visible in the Layers list -- stepping
// through terminals with the toolbar arrows (which focus + select) scrolls its
// row into view so the highlight is always on screen.
const sidebarRootRef = ref<HTMLElement | null>(null);
watch(
  () => terminalStore.focusedTerminalId,
  (id) => {
    if (!id || uiStore.sidebarTab !== "layers") return;
    nextTick(() => {
      const el = sidebarRootRef.value?.querySelector(`[data-layer-terminal="${id}"]`);
      el?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    });
  }
);

function isNoteSelected(id: string): boolean {
  return workspaceStore.selectedNoteIds.has(id);
}

function isGroupSelected(id: string): boolean {
  return workspaceStore.selectedGroupIds.has(id);
}

/**
 * Handle click on a layer item in the sidebar.
 * Plain click = select only this item.
 * Ctrl/Cmd+click = toggle selection (multi-select).
 */
function handleLayerClick(
  type: "note" | "group" | "file",
  id: string,
  event: MouseEvent
): void {
  const isMulti = event.ctrlKey || event.metaKey || event.shiftKey;

  if (type === "note") {
    if (isMulti) {
      workspaceStore.toggleNoteSelected(id);
    } else {
      workspaceStore.setNoteSelected([id]);
      terminalStore.clearSelection();
      workspaceStore.clearGroupSelection();
      workspaceStore.clearFileSelection();
    }
  } else if (type === "group") {
    if (isMulti) {
      workspaceStore.toggleGroupSelected(id);
    } else {
      workspaceStore.setGroupSelected([id]);
      terminalStore.clearSelection();
      workspaceStore.clearNoteSelection();
      workspaceStore.clearFileSelection();
    }
  } else if (type === "file") {
    if (isMulti) {
      workspaceStore.toggleFileSelected(id);
    } else {
      workspaceStore.setFileSelected([id]);
      terminalStore.clearSelection();
      workspaceStore.clearNoteSelection();
      workspaceStore.clearGroupSelection();
    }
  }
}
</script>

<template>
  <div ref="sidebarRootRef" class="sidebar">
    <div class="sidebar-tabs">
      <button
        class="sidebar-tab"
        :class="{ active: activeTab === 'layers' }"
        @click="activeTab = 'layers'"
      >
        Layers
        <span class="tab-count">{{ layerCount }}</span>
      </button>
      <button
        class="sidebar-tab"
        :class="{ active: activeTab === 'workspaces' }"
        @click="activeTab = 'workspaces'"
      >
        Workspaces
      </button>
      <button
        class="sidebar-collapse-btn"
        title="Collapse Outline"
        @click="uiStore.toggleOutline()"
      >
        <ChevronDown :size="15" />
      </button>
    </div>

    <div class="sidebar-content">
      <!-- Layers tab -->
      <div v-if="activeTab === 'layers'" class="tab-panel">
        <div v-if="layerCount === 0" class="empty-state">
          No items on canvas.
          <br />
          <span class="empty-hint">Press Ctrl+N to create a terminal.</span>
        </div>

        <!-- Groups -->
        <div v-for="group in workspaceStore.groups" :key="group.id" class="layer-branch">
          <div
            class="layer-item group-layer"
            :class="{ selected: isGroupSelected(group.id) }"
            @click="handleLayerClick('group', group.id, $event)"
            @mouseenter="onLayerEnter(group.id)"
            @mouseleave="onLayerLeave(group.id)"
          >
            <div class="layer-row">
              <span class="layer-twisty-spacer" />
              <Folder class="layer-icon" :size="12" />
              <span class="layer-name" :title="group.name">{{ group.name }}</span>
              <span class="layer-badge">{{ group.terminalIds.length }}</span>
            </div>
          </div>
          <!-- Terminals inside group (each with its own editors under it) -->
          <div class="layer-children">
            <LayerTerminalRow v-for="tid in group.terminalIds" :key="tid" :terminal-id="tid" nested />
          </div>
        </div>

        <!-- Ungrouped terminals, each expanding to the editors dragged out of it -->
        <LayerTerminalRow
          v-for="session in ungroupedSessions"
          :key="session.id"
          :terminal-id="session.id"
        />

        <!-- Editors no longer bound to a terminal -->
        <div
          v-for="file in unpinnedFiles"
          :key="file.id"
          class="layer-item file-layer"
          :class="{ selected: workspaceStore.selectedFileIds.has(file.id) }"
          @click="handleLayerClick('file', file.id, $event)"
          @mouseenter="onLayerEnter(file.id)"
          @mouseleave="onLayerLeave(file.id)"
        >
          <div class="layer-row">
            <span class="layer-twisty-spacer" />
            <FileCode2 class="layer-icon layer-file-icon" :size="12" />
            <span class="layer-name" :title="file.path">{{ getBasename(file.path) }}</span>
            <span v-if="fileStore.isDirty(file.path)" class="layer-dirty" title="Unsaved changes" />
          </div>
        </div>

        <!-- Notes -->
        <div
          v-for="note in workspaceStore.stickyNotes"
          :key="note.id"
          class="layer-item note-layer"
          :class="{ selected: isNoteSelected(note.id) }"
          @click="handleLayerClick('note', note.id, $event)"
          @mouseenter="onLayerEnter(note.id)"
          @mouseleave="onLayerLeave(note.id)"
        >
          <div class="layer-row">
            <span class="layer-twisty-spacer" />
            <StickyNote class="layer-icon" :size="12" />
            <span class="layer-name">{{ note.text ? note.text.split('\n')[0].slice(0, 30) : 'Empty note' }}</span>
          </div>
        </div>
      </div>

      <!-- Workspaces tab -->
      <div v-else class="tab-panel">
        <div v-if="workspaceStore.workspaceList.length === 0" class="empty-state">
          No saved workspaces.
        </div>
        <div
          v-for="ws in workspaceStore.workspaceList"
          :key="ws.id"
          class="workspace-item"
          @click="openWorkspace(ws.id)"
        >
          <span class="workspace-name">{{ ws.name }}</span>
          <span class="workspace-date">{{ ws.terminalCount }} term &bull; {{ new Date(ws.updatedAt).toLocaleDateString() }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* Rendered as the Outline region inside the right panel (see Inspector.vue),
   so it fills its container rather than owning a width or a border of its own. */
.sidebar {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--tc-bg-card);
  overflow: hidden;
  position: relative;
}

.sidebar-tabs {
  display: flex;
  border-bottom: 1px solid var(--tc-border-color);
  flex-shrink: 0;
}

.sidebar-collapse-btn {
  flex-shrink: 0;
  width: 34px;
  border: none;
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
  background: transparent;
  color: var(--tc-text-muted);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all var(--tc-transition-fast);
}

.sidebar-collapse-btn:hover {
  color: var(--tc-text-primary);
  background: var(--tc-bg-hover);
}

.sidebar-tab {
  flex: 1;
  padding: 10px 8px;
  border: none;
  background: transparent;
  color: var(--tc-text-muted);
  font-size: var(--tc-font-size-xs);
  cursor: pointer;
  transition: all var(--tc-transition-fast);
  font-family: var(--tc-font-sans);
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.3px;
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
}

.sidebar-tab:hover {
  color: var(--tc-text-secondary);
  background: var(--tc-bg-hover);
}

.sidebar-tab.active {
  color: var(--tc-accent);
  border-bottom-color: var(--tc-accent);
  background: var(--tc-accent-soft);
}

.tab-count {
  background: var(--tc-bg-secondary);
  padding: 1px 5px;
  border-radius: 8px;
  font-size: 10px;
}

.sidebar-content {
  flex: 1;
  overflow-y: auto;
  padding: 6px;
}

.tab-panel {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.empty-state {
  padding: 24px 12px;
  text-align: center;
  font-size: var(--tc-font-size-sm);
  color: var(--tc-text-muted);
  line-height: 1.6;
}

.empty-hint {
  font-size: var(--tc-font-size-xs);
  opacity: 0.6;
}

/* ─── Layers tree ──────────────────────────────────────────────────
   An object list in the Figma mould: single-line rows, no per-row border or
   card, one twisty column so every row's name starts at the same x whether or
   not it has children, and an indent guide down each nesting level. Everything
   secondary (path, actions) is hover-only, so at rest the panel is a clean
   column of names. Styled from here with :deep() rather than inside
   LayerTerminalRow.vue so a row looks identical wherever it's rendered. */
.tab-panel :deep(.layer-branch) {
  display: flex;
  flex-direction: column;
}

.tab-panel :deep(.layer-item) {
  padding: 0 6px;
  border-radius: var(--tc-border-radius-sm);
  cursor: pointer;
  transition: background var(--tc-transition-fast), box-shadow var(--tc-transition-fast);
  user-select: none;
}

.tab-panel :deep(.layer-item:hover) {
  background: var(--tc-bg-hover);
}

/* Selection is a filled row, not an outlined one -- an outline on a 24px row
   reads as a box around the text rather than "this is selected". */
.tab-panel :deep(.layer-item.selected) {
  background: var(--tc-accent-soft);
  box-shadow: inset 2px 0 0 var(--tc-accent);
}

.tab-panel :deep(.layer-item.selected .layer-name) {
  color: var(--tc-accent);
}

/* Subtle highlight for a terminal currently hovered on the canvas -- a neutral
   tint + grey edge bar, deliberately NOT the accent colour used for selection,
   so the two states stay distinguishable at a glance. */
.tab-panel :deep(.layer-item.canvas-hovered:not(.selected)) {
  background: var(--tc-bg-hover);
  box-shadow: inset 2px 0 0 var(--tc-text-muted);
}

.tab-panel :deep(.layer-row) {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 24px;
}

/* Children hang off an indent guide, so a deep tree still reads as a tree at a
   glance rather than as rows that happen to be pushed right. */
.tab-panel :deep(.layer-children) {
  margin-left: 12px;
  padding-left: 6px;
  border-left: 1px solid var(--tc-border-color);
}

/* Twisty. The spacer keeps names aligned on rows that have no children. */
.tab-panel :deep(.layer-twisty),
.tab-panel :deep(.layer-twisty-spacer) {
  width: 14px;
  flex-shrink: 0;
}

.tab-panel :deep(.layer-twisty) {
  height: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: none;
  background: transparent;
  color: var(--tc-text-muted);
  cursor: pointer;
  border-radius: 3px;
  transition: transform var(--tc-transition-fast), color var(--tc-transition-fast);
}

.tab-panel :deep(.layer-twisty:hover) {
  color: var(--tc-text-primary);
}

.tab-panel :deep(.layer-twisty.open) {
  transform: rotate(90deg);
}

.tab-panel :deep(.layer-icon) {
  line-height: 1;
  flex-shrink: 0;
  color: var(--tc-text-muted);
}

/* Editors carry the same cyan as their canvas node's outline and their
   connection line, so a glance at either surface says "this is a file". */
.tab-panel :deep(.layer-file-icon) {
  color: var(--tc-info);
}

.tab-panel :deep(.layer-agent-glyph) {
  line-height: 1;
  flex-shrink: 0;
}

.tab-panel :deep(.layer-name) {
  font-size: var(--tc-font-size-sm);
  color: var(--tc-text-primary);
  flex: 1;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  font-weight: 500;
}

/* Child rows read one step quieter than their parent. */
.tab-panel :deep(.file-layer .layer-name) {
  font-weight: 400;
  color: var(--tc-text-secondary);
}

/* Shell name, when the "Show shell type" setting is on. */
.tab-panel :deep(.layer-shell) {
  font-size: var(--tc-font-size-xs);
  color: var(--tc-text-muted);
  flex-shrink: 0;
}

.tab-panel :deep(.layer-badge) {
  font-size: 10px;
  color: var(--tc-text-muted);
  background: var(--tc-bg-secondary);
  padding: 1px 5px;
  border-radius: 8px;
  flex-shrink: 0;
}

/* Unsaved-changes dot on an editor row. */
.tab-panel :deep(.layer-dirty) {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--tc-warning);
  flex-shrink: 0;
}

/* Terminal status dot */
.tab-panel :deep(.layer-status-dot) {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex-shrink: 0;
}

.tab-panel :deep(.layer-status-dot.status-running) { background: var(--tc-status-running); }
.tab-panel :deep(.layer-status-dot.status-starting) { background: var(--tc-status-starting); }
.tab-panel :deep(.layer-status-dot.status-exited) { background: var(--tc-status-exited); }
.tab-panel :deep(.layer-status-dot.status-crashed) { background: var(--tc-status-crashed); }
.tab-panel :deep(.layer-status-dot.status-killed) { background: var(--tc-status-killed); }

/* Attention badge (idle/bell notification) */
.tab-panel :deep(.layer-attention) {
  flex-shrink: 0;
  color: var(--tc-attention);
}

.tab-panel :deep(.layer-item.terminal-layer:has(.layer-attention)) {
  background: var(--tc-attention-soft);
  box-shadow: inset 2px 0 0 var(--tc-attention);
}

/* Kill button */
.tab-panel :deep(.layer-kill) {
  width: 18px;
  height: 18px;
  border: none;
  background: transparent;
  color: var(--tc-text-muted);
  cursor: pointer;
  border-radius: 3px;
  display: flex;
  align-items: center;
  justify-content: center;
  line-height: 1;
  flex-shrink: 0;
  opacity: 0;
  transition: opacity var(--tc-transition-fast);
}

.tab-panel :deep(.layer-item:hover .layer-kill) {
  opacity: 1;
}

.tab-panel :deep(.layer-kill:hover) {
  background: var(--tc-accent-soft);
  color: var(--tc-error);
}

/* Exited state */
.tab-panel :deep(.terminal-layer.exited) {
  opacity: 0.5;
}

/* Note layer */
.tab-panel :deep(.note-layer .layer-name) {
  font-style: italic;
  opacity: 0.9;
}

/* Workspace list (unchanged) */
.workspace-item {
  padding: 8px 10px;
  border-radius: var(--tc-border-radius-sm);
  cursor: pointer;
  transition: all var(--tc-transition-fast);
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.workspace-item:hover {
  background: var(--tc-bg-hover);
}

.workspace-name {
  font-size: var(--tc-font-size-sm);
  color: var(--tc-text-primary);
}

.workspace-date {
  font-size: var(--tc-font-size-xs);
  color: var(--tc-text-muted);
}
</style>
