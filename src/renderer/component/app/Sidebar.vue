<script setup lang="ts">
import { computed, watch } from "vue";
import { useTerminalStore } from "@renderer/store/terminal";
import { useWorkspaceStore } from "@renderer/store/workspace";
import { useUIStore } from "@renderer/store/ui";
import { shortenCwd } from "@renderer/util/path";
import { AGENT_META } from "@renderer/util/agents";
import { useResizeHandle } from "@renderer/composable/useResizeHandle";
import { useVueFlow } from "@vue-flow/core";
import { Folder, StickyNote, Bell, X } from "lucide-vue-next";

const terminalStore = useTerminalStore();
const workspaceStore = useWorkspaceStore();
const uiStore = useUIStore();
// Same shared canvas store instance as WorkspaceCanvas.vue/Toolbar.vue (see
// their comments on why an explicit id is required here).
const { setCenter, getViewport } = useVueFlow("canvas");

const { startResize } = useResizeHandle(
  () => uiStore.sidebarWidth,
  (w) => uiStore.setSidebarWidth(w),
  "right"
);

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

/**
 * Double-clicking a terminal in the Layers panel pans/zooms the canvas to
 * center it and focuses it, so browsing the list is also a way to navigate.
 */
function navigateToTerminal(id: string): void {
  const session = terminalStore.sessions.get(id);
  if (!session) return;
  const width = session.node.width || 760;
  const height = session.node.height || 480;
  const centerX = session.node.x + width / 2;
  const centerY = session.node.y + height / 2;
  setCenter(centerX, centerY, { zoom: Math.max(getViewport().zoom, 0.75), duration: 400 });
  terminalStore.setFocused(id);
}

const sessions = computed(() => terminalStore.allSessions);

const activeTab = computed({
  get: () => uiStore.sidebarTab,
  set: (v) => { uiStore.sidebarTab = v; },
});

/**
 * Total count of all layer items (groups + terminals + notes).
 */
const layerCount = computed(() => {
  return workspaceStore.groups.length + sessions.value.length + workspaceStore.stickyNotes.length;
});

/**
 * Terminals that are not inside any group.
 */
const ungroupedSessions = computed(() =>
  sessions.value.filter((s) => s.groupId === null)
);

async function killTerminal(id: string) {
  await terminalStore.killSession(id);
  terminalStore.removeSession(id);
}

function isTerminalSelected(id: string): boolean {
  return terminalStore.selectedTerminalIds.has(id);
}

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
  type: "terminal" | "note" | "group",
  id: string,
  event: MouseEvent
): void {
  const isMulti = event.ctrlKey || event.metaKey;

  if (type === "terminal") {
    if (isMulti) {
      terminalStore.toggleSelected(id);
    } else {
      terminalStore.setSelected([id]);
      workspaceStore.clearNoteSelection();
      workspaceStore.clearGroupSelection();
    }
    // Note: deliberately NOT calling terminalStore.setFocused(id) here.
    // Selecting a terminal from the Layers list is for highlighting/grouping
    // (e.g. select several, then Ctrl+G) -- it must not steal keyboard focus
    // into that terminal, which would silently disable canvas shortcuts.
  } else if (type === "note") {
    if (isMulti) {
      workspaceStore.toggleNoteSelected(id);
    } else {
      workspaceStore.setNoteSelected([id]);
      terminalStore.clearSelection();
      workspaceStore.clearGroupSelection();
    }
  } else if (type === "group") {
    if (isMulti) {
      workspaceStore.toggleGroupSelected(id);
    } else {
      workspaceStore.setGroupSelected([id]);
      terminalStore.clearSelection();
      workspaceStore.clearNoteSelection();
    }
  }
}
</script>

<template>
  <div class="sidebar">
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
        <div
          v-for="group in workspaceStore.groups"
          :key="group.id"
          class="layer-item group-layer"
          :class="{ selected: isGroupSelected(group.id) }"
          @click="handleLayerClick('group', group.id, $event)"
        >
          <div class="layer-row">
            <Folder class="layer-icon" :size="12" />
            <span class="layer-name" :title="group.name">{{ group.name }}</span>
            <span class="layer-count">{{ group.terminalIds.length }}</span>
          </div>
          <!-- Terminals inside group -->
          <div
            v-for="tid in group.terminalIds"
            :key="tid"
            class="layer-item terminal-layer nested"
            :class="{ selected: isTerminalSelected(tid) }"
            @click.stop="handleLayerClick('terminal', tid, $event)"
            @dblclick.stop="navigateToTerminal(tid)"
          >
            <div class="layer-row">
              <span class="layer-status-dot" :class="terminalStore.sessions.get(tid)?.status" />
              <component
                :is="AGENT_META[terminalStore.sessions.get(tid)!.activeAgent!].icon"
                v-if="terminalStore.sessions.get(tid)?.activeAgent"
                class="layer-agent-glyph"
                :size="11"
                :style="{ color: AGENT_META[terminalStore.sessions.get(tid)!.activeAgent!].color }"
                :title="AGENT_META[terminalStore.sessions.get(tid)!.activeAgent!].label"
              />
              <span class="layer-name">{{ terminalStore.sessions.get(tid)?.name ?? tid }}</span>
              <Bell v-if="terminalStore.sessions.get(tid)?.needsAttention" class="layer-attention" :size="11" title="Needs attention" />
            </div>
          </div>
        </div>

        <!-- Ungrouped terminals -->
        <div
          v-for="session in ungroupedSessions"
          :key="session.id"
          class="layer-item terminal-layer"
          :class="{
            selected: isTerminalSelected(session.id),
            exited: session.status === 'exited' || session.status === 'crashed'
          }"
          @click="handleLayerClick('terminal', session.id, $event)"
          @dblclick="navigateToTerminal(session.id)"
        >
          <div class="layer-row">
            <span class="layer-status-dot" :class="`status-${session.status}`" />
            <component
              :is="AGENT_META[session.activeAgent].icon"
              v-if="session.activeAgent"
              class="layer-agent-glyph"
              :size="11"
              :style="{ color: AGENT_META[session.activeAgent].color }"
              :title="AGENT_META[session.activeAgent].label"
            />
            <span class="layer-name">{{ session.name }}</span>
            <Bell v-if="session.needsAttention" class="layer-attention" :size="11" title="Needs attention" />
            <button class="layer-kill" @click.stop="killTerminal(session.id)" title="Kill">
              <X :size="12" />
            </button>
          </div>
          <div class="layer-meta">
            <span class="layer-shell">{{ session.shellName }}</span>
            <span class="layer-cwd" :title="session.cwd">{{ shortenCwd(session.cwd, 20) }}</span>
          </div>
        </div>

        <!-- Notes -->
        <div
          v-for="note in workspaceStore.stickyNotes"
          :key="note.id"
          class="layer-item note-layer"
          :class="{ selected: isNoteSelected(note.id) }"
          @click="handleLayerClick('note', note.id, $event)"
        >
          <div class="layer-row">
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
    <div class="sidebar-resize-handle" @mousedown="startResize" />
  </div>
</template>

<style scoped>
.sidebar {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--tc-bg-card);
  border-right: 1px solid var(--tc-border-color);
  overflow: hidden;
  position: relative;
}

.sidebar-resize-handle {
  position: absolute;
  top: 0;
  right: 0;
  width: 6px;
  height: 100%;
  cursor: col-resize;
  z-index: 5;
}

.sidebar-resize-handle:hover,
.sidebar-resize-handle:active {
  background: var(--tc-accent);
  opacity: 0.5;
}

.sidebar-tabs {
  display: flex;
  border-bottom: 1px solid var(--tc-border-color);
  flex-shrink: 0;
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

/* Layer items */
.layer-item {
  padding: 6px 8px;
  border-radius: var(--tc-border-radius-sm);
  cursor: pointer;
  transition: all var(--tc-transition-fast);
  border: 1px solid transparent;
  user-select: none;
}

.layer-item:hover {
  background: var(--tc-bg-hover);
  border-color: var(--tc-border-color);
}

.layer-item.selected {
  background: var(--tc-accent-soft);
  border-color: var(--tc-accent);
}

.layer-row {
  display: flex;
  align-items: center;
  gap: 6px;
  min-height: 20px;
}

.layer-icon {
  font-size: 12px;
  line-height: 1;
  flex-shrink: 0;
}

.layer-agent-glyph {
  font-size: 11px;
  line-height: 1;
  flex-shrink: 0;
}

.layer-name {
  font-size: var(--tc-font-size-sm);
  color: var(--tc-text-primary);
  flex: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  font-weight: 500;
}

.layer-count {
  font-size: 10px;
  color: var(--tc-text-muted);
  background: var(--tc-bg-secondary);
  padding: 1px 5px;
  border-radius: 8px;
  flex-shrink: 0;
}

/* Nested terminals inside groups */
.terminal-layer.nested {
  margin-left: 12px;
  padding: 4px 6px;
  margin-top: 2px;
}

.terminal-layer.nested .layer-name {
  font-size: var(--tc-font-size-xs);
  font-weight: 400;
}

/* Terminal status dot */
.layer-status-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex-shrink: 0;
}

.layer-status-dot.status-running { background: var(--tc-status-running); }
.layer-status-dot.status-starting { background: var(--tc-status-starting); }
.layer-status-dot.status-exited { background: var(--tc-status-exited); }
.layer-status-dot.status-crashed { background: var(--tc-status-crashed); }
.layer-status-dot.status-killed { background: var(--tc-status-killed); }

.layer-status-dot.running { background: var(--tc-status-running); }
.layer-status-dot.starting { background: var(--tc-status-starting); }
.layer-status-dot.exited { background: var(--tc-status-exited); }
.layer-status-dot.crashed { background: var(--tc-status-crashed); }
.layer-status-dot.killed { background: var(--tc-status-killed); }

/* Terminal meta (cwd, shell) */
.layer-meta {
  display: flex;
  flex-direction: column;
  gap: 1px;
  padding-left: 13px;
  margin-top: 2px;
}

.layer-shell {
  font-size: var(--tc-font-size-xs);
  color: var(--tc-text-muted);
}

.layer-cwd {
  font-size: var(--tc-font-size-xs);
  color: var(--tc-text-muted);
  font-family: var(--tc-font-mono);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* Attention badge (idle/bell notification) */
.layer-attention {
  flex-shrink: 0;
  color: var(--tc-warning);
}

.layer-item.terminal-layer:has(.layer-attention) {
  background: var(--tc-warning-soft);
  border-color: var(--tc-warning);
}

/* Kill button */
.layer-kill {
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
  font-size: 14px;
  line-height: 1;
  opacity: 0;
  transition: opacity var(--tc-transition-fast);
}

.layer-item:hover .layer-kill {
  opacity: 1;
}

.layer-kill:hover {
  background: var(--tc-accent-soft);
  color: var(--tc-error);
}

/* Exited state */
.terminal-layer.exited {
  opacity: 0.5;
}

/* Note layer */
.note-layer .layer-name {
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
