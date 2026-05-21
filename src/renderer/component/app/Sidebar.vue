<script setup lang="ts">
import { computed, onMounted } from "vue";
import { useTerminalStore } from "@renderer/store/terminal";
import { useWorkspaceStore } from "@renderer/store/workspace";
import { useUIStore } from "@renderer/store/ui";
import { shortenCwd } from "@renderer/util/path";

const terminalStore = useTerminalStore();
const workspaceStore = useWorkspaceStore();
const uiStore = useUIStore();

const sessions = computed(() => terminalStore.allSessions);

onMounted(() => {
  workspaceStore.loadWorkspaceList();
});

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
    terminalStore.setFocused(id);
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

/**
 * Double-click a layer item to zoom the canvas to that node.
 */
function handleLayerDblClick(id: string): void {
  workspaceStore.fitViewTargetId = id;
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
          @dblclick="handleLayerDblClick(group.id)"
        >
          <div class="layer-row">
            <span class="layer-icon">&#128193;</span>
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
            @dblclick.stop="handleLayerDblClick(tid)"
          >
            <div class="layer-row">
              <span class="layer-status-dot" :class="terminalStore.sessions.get(tid)?.status" />
              <span class="layer-name">{{ terminalStore.sessions.get(tid)?.name ?? tid }}</span>
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
          @dblclick="handleLayerDblClick(session.id)"
        >
          <div class="layer-row">
            <span class="layer-status-dot" :class="`status-${session.status}`" />
            <span class="layer-name">{{ session.name }}</span>
            <button class="layer-kill" @click.stop="killTerminal(session.id)" title="Kill">
              &times;
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
          @dblclick="handleLayerDblClick(note.id)"
        >
          <div class="layer-row">
            <span class="layer-icon">&#128221;</span>
            <span class="layer-name">{{ note.text ? note.text.split('\n')[0].slice(0, 30) : 'Empty note' }}</span>
          </div>
        </div>
      </div>

      <!-- Workspaces tab -->
      <div v-else class="tab-panel">
        <div v-if="workspaceStore.workspaceList.length === 0" class="empty-state">
          No saved workspaces.
          <br />
          <span class="empty-hint">Press Ctrl+S to save the current workspace.</span>
        </div>
        <div
          v-for="ws in workspaceStore.workspaceList"
          :key="ws.id"
          class="workspace-item"
          :class="{ active: workspaceStore.currentWorkspace?.id === ws.id }"
          @click="workspaceStore.loadWorkspace(ws.id)"
        >
          <div class="workspace-info">
            <span class="workspace-name">{{ ws.name }}</span>
            <span class="workspace-meta">
              {{ ws.terminalCount }} terminal{{ ws.terminalCount === 1 ? '' : 's' }}
              &middot;
              {{ new Date(ws.updatedAt).toLocaleDateString() }}
            </span>
          </div>
          <button
            class="workspace-delete"
            @click.stop="workspaceStore.deleteWorkspace(ws.id)"
            title="Delete workspace"
          >
            &times;
          </button>
        </div>
      </div>
    </div>
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
  box-shadow: inset 3px 0 0 0 var(--tc-accent);
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
  background: rgba(233, 69, 96, 0.15);
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

/* Workspace list */
.workspace-item {
  padding: 8px 10px;
  border-radius: var(--tc-border-radius-sm);
  cursor: pointer;
  transition: all var(--tc-transition-fast);
  display: flex;
  justify-content: space-between;
  align-items: center;
  border: 1px solid transparent;
}

.workspace-item:hover {
  background: var(--tc-bg-hover);
  border-color: var(--tc-border-color);
}

.workspace-item.active {
  background: var(--tc-accent-soft);
  border-color: var(--tc-accent);
  box-shadow: inset 3px 0 0 0 var(--tc-accent);
}

.workspace-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.workspace-name {
  font-size: var(--tc-font-size-sm);
  color: var(--tc-text-primary);
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.workspace-meta {
  font-size: var(--tc-font-size-xs);
  color: var(--tc-text-muted);
}

.workspace-delete {
  width: 20px;
  height: 20px;
  border: none;
  background: transparent;
  color: var(--tc-text-muted);
  cursor: pointer;
  border-radius: 3px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  opacity: 0;
  transition: opacity var(--tc-transition-fast);
  flex-shrink: 0;
}

.workspace-item:hover .workspace-delete {
  opacity: 1;
}

.workspace-delete:hover {
  background: rgba(233, 69, 96, 0.15);
  color: var(--tc-error);
}
</style>
