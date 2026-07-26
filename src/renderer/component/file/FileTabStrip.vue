<script setup lang="ts">
import { ref, computed } from "vue";
import { X, TerminalSquare, PanelLeftOpen } from "lucide-vue-next";
import { useFileStore } from "@renderer/store/file";
import { getBasename } from "@renderer/util/path";

/**
 * Tab bar inside a terminal node: the terminal itself is always tab 0 and can't
 * be closed, followed by one tab per open file. Dragging a file tab out onto
 * empty canvas detaches it into its own node -- the drop is handled by
 * WorkspaceCanvas, this just seeds the drag payload.
 */
const props = defineProps<{
  terminalId: string;
  /** Whether the file drawer is currently showing, for the toggle button. */
  drawerOpen: boolean;
}>();

const emit = defineEmits<{
  (e: "toggle-drawer"): void;
}>();

const fileStore = useFileStore();

const tabs = computed(() => fileStore.getTabs(props.terminalId));
const activeTab = computed(() => fileStore.getActiveTab(props.terminalId));

const dragIndex = ref<number | null>(null);

function select(path: string | null): void {
  fileStore.setActiveTab(props.terminalId, path);
}

async function close(path: string): Promise<void> {
  if (fileStore.isDirty(path)) {
    const name = getBasename(path);
    // A dirty tab closing silently would throw away work the user can't get
    // back -- there's no undo across a close.
    const discard = window.confirm(`${name} has unsaved changes. Close without saving?`);
    if (!discard) return;
  }
  fileStore.closeInTerminal(props.terminalId, path);
}

function handleDragStart(event: DragEvent, path: string, index: number): void {
  dragIndex.value = index;
  event.dataTransfer?.setData("application/x-cate-file", path);
  event.dataTransfer?.setData("text/plain", path);
  if (event.dataTransfer) event.dataTransfer.effectAllowed = "copyMove";
}

function handleDragOver(event: DragEvent, index: number): void {
  if (dragIndex.value === null || dragIndex.value === index) return;
  event.preventDefault();
  fileStore.moveTab(props.terminalId, dragIndex.value, index);
  dragIndex.value = index;
}

function handleDragEnd(): void {
  dragIndex.value = null;
}
</script>

<template>
  <div class="tab-strip nodrag">
    <button
      class="tab-drawer-toggle"
      :class="{ on: drawerOpen }"
      :title="drawerOpen ? 'Hide file explorer' : 'Show file explorer'"
      @click.stop="emit('toggle-drawer')"
    >
      <PanelLeftOpen :size="13" />
    </button>

    <button
      class="tab"
      :class="{ active: activeTab === null }"
      title="Terminal"
      @click.stop="select(null)"
    >
      <TerminalSquare :size="12" />
      <span class="tab-label">Terminal</span>
    </button>

    <button
      v-for="(path, index) in tabs"
      :key="path"
      class="tab tab-file"
      :class="{ active: activeTab === path }"
      :title="path"
      draggable="true"
      @click.stop="select(path)"
      @dragstart="handleDragStart($event, path, index)"
      @dragover="handleDragOver($event, index)"
      @dragend="handleDragEnd"
    >
      <span class="tab-label">{{ getBasename(path) }}</span>
      <span v-if="fileStore.isDirty(path)" class="tab-dirty" title="Unsaved changes" />
      <span class="tab-close" title="Close" @click.stop="close(path)">
        <X :size="11" />
      </span>
    </button>
  </div>
</template>

<style scoped>
.tab-strip {
  display: flex;
  align-items: stretch;
  gap: 1px;
  padding: 0 4px;
  background: var(--tc-bg-header);
  border-bottom: 1px solid var(--tc-border-color);
  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-width: none;
  flex-shrink: 0;
}

.tab-strip::-webkit-scrollbar {
  display: none;
}

.tab-drawer-toggle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  flex-shrink: 0;
  background: none;
  border: none;
  color: var(--tc-text-muted);
  cursor: pointer;
}

.tab-drawer-toggle:hover,
.tab-drawer-toggle.on {
  color: var(--tc-accent);
}

.tab {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  max-width: 160px;
  padding: 5px 8px;
  background: none;
  border: none;
  /* The active tab is marked with an accent underline rather than a raised
     surface -- the node is small, and a full tab-shape reads as noise here. */
  border-bottom: 2px solid transparent;
  color: var(--tc-text-muted);
  font-size: 11.5px;
  white-space: nowrap;
  cursor: pointer;
  flex-shrink: 0;
}

.tab:hover {
  color: var(--tc-text-primary);
}

.tab.active {
  color: var(--tc-text-primary);
  border-bottom-color: var(--tc-accent);
}

.tab-label {
  overflow: hidden;
  text-overflow: ellipsis;
}

.tab-dirty {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--tc-warning);
  flex-shrink: 0;
}

.tab-close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 14px;
  height: 14px;
  border-radius: var(--tc-border-radius-sm);
  color: var(--tc-text-muted);
  opacity: 0;
  flex-shrink: 0;
}

.tab-file:hover .tab-close,
.tab-file.active .tab-close {
  opacity: 1;
}

.tab-close:hover {
  background: var(--tc-bg-active);
  color: var(--tc-accent);
}
</style>
