<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { Group } from "@renderer/type/workspace";
import { useWorkspaceStore } from "@renderer/store/workspace";
import { useTerminalStore } from "@renderer/store/terminal";
import { NodeResizer } from "@vue-flow/node-resizer";
import { ChevronDown, ChevronRight, Ungroup, X, StickyNote as StickyNoteIcon } from "lucide-vue-next";

const props = defineProps<{
  id: string;
  data: { group: Group };
  selected?: boolean;
  dragging?: boolean;
  position?: { x: number; y: number };
}>();

const workspaceStore = useWorkspaceStore();
const terminalStore = useTerminalStore();

const GROUP_COLORS = [
  "#e94560",
  "#4ecca3",
  "#64b5f6",
  "#f9a825",
  "#e040fb",
  "#4dd0e1",
  "#ab47bc",
  "#ff8a65",
];

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

// Combined member count shown on the header badge (terminals + notes)
const memberCount = computed(() => props.data.group.terminalIds.length + props.data.group.noteIds.length);

// Get the terminal sessions that belong to this group
const groupedSessions = computed(() =>
  props.data.group.terminalIds
    .map((tid) => terminalStore.sessions.get(tid))
    .filter(Boolean)
);

// Get the sticky notes that belong to this group
const groupedNotes = computed(() =>
  props.data.group.noteIds
    .map((nid) => workspaceStore.stickyNotes.find((n) => n.id === nid))
    .filter(Boolean)
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
 * Remove a sticky note from this group.
 */
function removeNote(noteId: string): void {
  workspaceStore.removeNoteFromGroup(noteId, props.id);
}

/**
 * Ungroup: dissolve this group without killing the terminals inside.
 */
function ungroup(): void {
  workspaceStore.removeGroup(props.id);
}

/**
 * Cycle to the next color in the palette.
 */
function cycleColor(): void {
  const current = GROUP_COLORS.indexOf(props.data.group.color || "");
  const next = GROUP_COLORS[(current + 1) % GROUP_COLORS.length];
  workspaceStore.updateGroup(props.id, { color: next });
}

/**
 * Watch for position changes during drag and update workspace store.
 * Also moves grouped terminals AND notes so they travel with the group --
 * notes were previously left behind entirely when a group was dragged.
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
        for (const nid of props.data.group.noteIds) {
          if (props.selected && workspaceStore.selectedNoteIds.has(nid)) continue;
          const n = workspaceStore.stickyNotes.find((note) => note.id === nid);
          if (n) {
            workspaceStore.updateStickyNote(nid, {
              x: n.x + dx,
              y: n.y + dy,
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
    <NodeResizer v-if="!isCollapsed" :min-width="220" :min-height="120" :line-style="{ borderColor: data.group.color }" :handle-style="{ backgroundColor: data.group.color }" />
    <!-- Group header: name, count, collapse toggle -->
    <div class="group-header" :style="{ borderColor: data.group.color }">
      <button
        class="group-color-indicator"
        title="Change group color"
        :style="{ background: data.group.color || 'transparent' }"
        @click.stop="cycleColor"
      />
      <span class="group-name" :title="data.group.name">{{ data.group.name }}</span>
      <span class="group-count" title="Terminals + notes in this group">{{ memberCount }}</span>
      <button
        class="group-collapse-btn"
        :title="isCollapsed ? 'Expand group' : 'Collapse group'"
        @click.stop="toggleCollapse"
      >
        <ChevronRight v-if="isCollapsed" :size="13" />
        <ChevronDown v-else :size="13" />
      </button>
      <button
        class="group-collapse-btn group-ungroup-btn"
        title="Ungroup (terminals are kept)"
        @click.stop="ungroup"
      >
        <Ungroup :size="13" />
      </button>
    </div>

    <!-- Group content: list of terminals in this group -->
    <div v-show="!isCollapsed" class="group-content">
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
          <X :size="11" />
        </button>
      </div>

      <div
        v-for="note in groupedNotes"
        :key="note!.id"
        class="group-terminal-item"
      >
        <StickyNoteIcon class="group-note-icon" :size="11" />
        <span class="group-terminal-name" :title="note!.text || 'Empty note'">
          {{ note!.text ? note!.text.split('\n')[0].slice(0, 30) : "Empty note" }}
        </span>
        <button
          class="group-terminal-remove"
          title="Remove from group"
          @click.stop="removeNote(note!.id)"
        >
          <X :size="11" />
        </button>
      </div>

      <!-- Empty state -->
      <div
        v-if="groupedSessions.length === 0 && groupedNotes.length === 0"
        class="group-empty"
      >
        Drop terminals or notes here
      </div>
    </div>
  </div>
</template>

<style scoped>
.group-node {
  border: 2px dashed var(--tc-border-color);
  border-radius: var(--tc-border-radius);
  background: var(--tc-group-bg);
  min-width: 200px;
  min-height: 44px;
  transition: all var(--tc-transition-normal);
  overflow: hidden;
}

.group-node.selected {
  border-color: var(--tc-accent);
  border-style: solid;
  background: var(--tc-group-selected-bg);
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
  width: 12px;
  height: 12px;
  border-radius: 50%;
  flex-shrink: 0;
  opacity: 0.8;
  border: none;
  padding: 0;
  cursor: pointer;
  transition: transform var(--tc-transition-fast);
}

.group-color-indicator:hover {
  opacity: 1;
  transform: scale(1.3);
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
  width: 26px;
  height: 26px;
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

.group-note-icon {
  flex-shrink: 0;
  color: var(--tc-text-muted);
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
  width: 20px;
  height: 20px;
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
</style>
