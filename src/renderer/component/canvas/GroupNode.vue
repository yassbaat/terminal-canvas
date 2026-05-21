<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useVueFlow } from "@vue-flow/core";
import type { Group } from "@renderer/type/workspace";
import { useWorkspaceStore } from "@renderer/store/workspace";
import { useTerminalStore } from "@renderer/store/terminal";

const props = defineProps<{
  id: string;
  data: { group: Group };
  selected?: boolean;
  dragging?: boolean;
  position?: { x: number; y: number };
}>();

const workspaceStore = useWorkspaceStore();
const terminalStore = useTerminalStore();
useVueFlow();

// Local collapsed state (synced with workspace data)
const isCollapsed = ref(props.data.group.collapsed);

// Sync collapsed state with workspace store
watch(isCollapsed, (val) => {
  workspaceStore.updateGroup(props.id, { collapsed: val });
});

// Computed style for the group container
const groupStyle = computed(() => ({
  width: `${props.data.group.width}px`,
  height: isCollapsed.value ? "auto" : `${props.data.group.height}px`,
  borderColor: props.data.group.color || "var(--tc-border-color)",
}));

// Count of terminals in this group
const terminalCount = computed(() => props.data.group.terminalIds.length);

// Get the note IDs in this group
const noteIds = computed(() => props.data.group.noteIds || []);

// Get the notes that belong to this group
const groupedNotes = computed(() =>
  (props.data.group.noteIds || [])
    .map((nid) => workspaceStore.stickyNotes.find((n) => n.id === nid))
    .filter(Boolean)
);

// Get the terminal sessions that belong to this group
const groupedSessions = computed(() =>
  props.data.group.terminalIds
    .map((tid) => terminalStore.sessions.get(tid))
    .filter(Boolean)
);

// Get child groups nested inside this group
const childGroups = computed(() =>
  workspaceStore.groups.filter((g) => g.parentId === props.id)
);

/**
 * Toggle the collapsed state of the group.
 */
function toggleCollapse(): void {
  isCollapsed.value = !isCollapsed.value;
}

/**
 * Remove a terminal from this group.
 */
function removeTerminal(terminalId: string): void {
  workspaceStore.removeTerminalFromGroup(terminalId, props.id);
}

/**
 * Watch for position changes during drag and update workspace store.
 * Also moves grouped terminals so they travel with the group.
 */
watch(
  () => props.position,
  (pos, oldPos) => {
    if (pos) {
      workspaceStore.updateGroup(props.id, { x: pos.x, y: pos.y });
      const dx = oldPos ? pos.x - oldPos.x : 0;
      const dy = oldPos ? pos.y - oldPos.y : 0;
      if (dx !== 0 || dy !== 0) {
        for (const tid of props.data.group.terminalIds) {
          // When the group is being dragged as part of a multi-selection,
          // Vue Flow already moves the selected terminals. Skip them to
          // avoid double-moving. When the group is dragged alone, move
          // ALL terminals regardless of selection state.
          if (props.selected && terminalStore.selectedTerminalIds.has(tid)) continue;
          const s = terminalStore.sessions.get(tid);
          if (s) {
            terminalStore.updateNode(tid, {
              x: s.node.x + dx,
              y: s.node.y + dy,
            });
          }
        }
        // Move grouped notes with the group
        for (const nid of noteIds.value) {
          const note = workspaceStore.stickyNotes.find((n) => n.id === nid);
          if (note) {
            workspaceStore.updateStickyNote(nid, {
              x: note.x + dx,
              y: note.y + dy,
            });
          }
        }
      }
    }
  },
  { deep: true }
);
</script>

<template>
  <div
    class="group-node"
    :class="{ selected, collapsed: isCollapsed, dragging }"
    :style="groupStyle"
  >
    <!-- Group header: name, count, collapse toggle -->
    <div class="group-header" :style="{ borderColor: data.group.color }">
      <span class="group-color-indicator" :style="{ background: data.group.color || 'transparent' }" />
      <span class="group-name" :title="data.group.name">{{ data.group.name }}</span>
      <span class="group-count">{{ terminalCount }}</span>
      <button
        class="group-collapse-btn"
        :title="isCollapsed ? 'Expand group' : 'Collapse group'"
        @click.stop="toggleCollapse"
      >
        {{ isCollapsed ? "+" : "&#8722;" }}
      </button>
    </div>

    <!-- Group content: list of terminals, notes, and child groups -->
    <div v-show="!isCollapsed" class="group-content">
      <!-- Child groups (nested) -->
      <div
        v-for="cg in childGroups"
        :key="cg.id"
        class="group-child-group"
      >
        <span class="child-group-icon">&#128193;</span>
        <span class="child-group-name">{{ cg.name }}</span>
      </div>

      <!-- Terminals -->
      <div
        v-for="session in groupedSessions"
        :key="session!.id"
        class="group-terminal-item"
      >
        <span
          class="group-terminal-status"
          :class="session!.status"
        >&#9679;</span>
        <span class="group-terminal-name" :title="session!.name">
          {{ session!.name }}
        </span>
        <button
          class="group-terminal-remove"
          title="Remove from group"
          @click.stop="removeTerminal(session!.id)"
        >
          &#215;
        </button>
      </div>

      <!-- Notes -->
      <div
        v-for="note in groupedNotes"
        :key="note!.id"
        class="group-note-item"
      >
        <span class="group-note-icon">&#128221;</span>
        <span class="group-note-text">{{ note!.text ? note!.text.split('\n')[0].slice(0, 30) : 'Empty note' }}</span>
      </div>

      <!-- Empty state -->
      <div
        v-if="groupedSessions.length === 0 && groupedNotes.length === 0 && childGroups.length === 0"
        class="group-empty"
      >
        Drop items here
      </div>
    </div>
  </div>
</template>

<style scoped>
.group-node {
  border: 2px dashed var(--tc-border-color);
  border-radius: var(--tc-border-radius);
  background: rgba(30, 30, 47, 0.3);
  min-width: 200px;
  min-height: 44px;
  transition: all var(--tc-transition-normal);
  overflow: hidden;
}

.group-node.selected {
  border-color: var(--tc-accent);
  border-style: solid;
  background: rgba(233, 69, 96, 0.05);
}

.group-node.collapsed {
  min-height: 44px;
  height: auto !important;
}

.group-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  background: var(--tc-bg-header);
  border-bottom: 1px solid var(--tc-border-color);
  cursor: grab;
  user-select: none;
  min-height: 32px;
}

.group-color-indicator {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
  opacity: 0.8;
}

.group-name {
  font-size: var(--tc-font-size-sm);
  font-weight: 600;
  color: var(--tc-text-primary);
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.group-count {
  font-size: var(--tc-font-size-xs);
  color: var(--tc-text-muted);
  background: var(--tc-bg-secondary);
  padding: 2px 6px;
  border-radius: 10px;
  flex-shrink: 0;
  font-variant-numeric: tabular-nums;
}

.group-collapse-btn {
  width: 22px;
  height: 22px;
  border: 1px solid var(--tc-border-color);
  background: var(--tc-bg-card);
  color: var(--tc-text-secondary);
  border-radius: var(--tc-border-radius-sm);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  line-height: 1;
  flex-shrink: 0;
  padding: 0;
  transition: all var(--tc-transition-fast);
}

.group-collapse-btn:hover {
  background: var(--tc-bg-hover);
  color: var(--tc-text-primary);
}

.group-content {
  padding: 8px;
  min-height: 40px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.group-terminal-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  border-radius: var(--tc-border-radius-sm);
  background: var(--tc-bg-card);
  font-size: var(--tc-font-size-xs);
  color: var(--tc-text-secondary);
  transition: background var(--tc-transition-fast);
}

.group-terminal-item:hover {
  background: var(--tc-bg-hover);
}

.group-terminal-status {
  font-size: 8px;
  line-height: 1;
  flex-shrink: 0;
}

.group-terminal-status.running {
  color: var(--tc-status-running);
}

.group-terminal-status.starting {
  color: var(--tc-status-starting);
}

.group-terminal-status.exited {
  color: var(--tc-status-exited);
}

.group-terminal-status.crashed,
.group-terminal-status.killed {
  color: var(--tc-status-crashed);
}

.group-terminal-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--tc-font-mono);
}

.group-terminal-remove {
  width: 16px;
  height: 16px;
  border: none;
  background: transparent;
  color: var(--tc-text-muted);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  line-height: 1;
  padding: 0;
  border-radius: var(--tc-border-radius-sm);
  flex-shrink: 0;
  opacity: 0;
  transition: opacity var(--tc-transition-fast), background var(--tc-transition-fast);
}

.group-terminal-item:hover .group-terminal-remove {
  opacity: 1;
}

.group-terminal-remove:hover {
  background: var(--tc-accent-soft);
  color: var(--tc-accent);
}

.group-empty {
  text-align: center;
  padding: 12px 8px;
  font-size: var(--tc-font-size-xs);
  color: var(--tc-text-muted);
  font-style: italic;
  border: 1px dashed var(--tc-border-color);
  border-radius: var(--tc-border-radius-sm);
  margin-top: 4px;
}

.group-child-group {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  border-radius: var(--tc-border-radius-sm);
  background: var(--tc-bg-secondary);
  font-size: var(--tc-font-size-xs);
  color: var(--tc-text-secondary);
}

.child-group-icon {
  font-size: 10px;
  line-height: 1;
}

.child-group-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 500;
}

.group-note-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  border-radius: var(--tc-border-radius-sm);
  background: var(--tc-bg-card);
  font-size: var(--tc-font-size-xs);
  color: var(--tc-text-secondary);
  font-style: italic;
}

.group-note-icon {
  font-size: 10px;
  line-height: 1;
}

.group-note-text {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
