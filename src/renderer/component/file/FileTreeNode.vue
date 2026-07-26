<script setup lang="ts">
import { ref, computed } from "vue";
import { ChevronRight, ChevronDown, File as FileIcon, Folder, FolderOpen } from "lucide-vue-next";
import type { DirEntry } from "@renderer/type/file";

/**
 * One row of the file tree, recursive.
 *
 * Children are fetched the first time a directory is expanded and cached on the
 * component, so opening a repo root doesn't walk the whole tree -- which matters
 * because these roots are real projects with node_modules-sized subtrees.
 */
const props = defineProps<{
  entry: DirEntry;
  depth: number;
  activePath: string | null;
  showHidden: boolean;
}>();

const emit = defineEmits<{
  (e: "open", path: string): void;
  (e: "context", payload: { entry: DirEntry; x: number; y: number }): void;
  (e: "drag-file", payload: { path: string; event: DragEvent }): void;
}>();

const expanded = ref(false);
const children = ref<DirEntry[]>([]);
const loading = ref(false);
const error = ref<string | null>(null);

const isActive = computed(() => props.activePath === props.entry.path);

async function loadChildren(): Promise<void> {
  loading.value = true;
  error.value = null;
  try {
    children.value = await window.api.file.listDir(props.entry.path, props.showHidden);
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  }
  loading.value = false;
}

async function toggle(): Promise<void> {
  if (!props.entry.isDirectory) {
    emit("open", props.entry.path);
    return;
  }
  expanded.value = !expanded.value;
  if (expanded.value && children.value.length === 0) await loadChildren();
}

/** Re-read this directory's children (after a create/rename/delete). */
async function refresh(): Promise<void> {
  if (expanded.value) await loadChildren();
}

function handleDragStart(event: DragEvent): void {
  if (props.entry.isDirectory) return;
  emit("drag-file", { path: props.entry.path, event });
}

defineExpose({ refresh });
</script>

<template>
  <div class="tree-node">
    <div
      class="tree-row"
      :class="{ active: isActive, directory: entry.isDirectory }"
      :style="{ paddingLeft: `${depth * 12 + 6}px` }"
      :title="entry.path"
      :draggable="!entry.isDirectory"
      @click="toggle"
      @dragstart="handleDragStart"
      @contextmenu.prevent.stop="emit('context', { entry, x: $event.clientX, y: $event.clientY })"
    >
      <span class="tree-caret">
        <component
          :is="expanded ? ChevronDown : ChevronRight"
          v-if="entry.isDirectory"
          :size="12"
        />
      </span>
      <component
        :is="entry.isDirectory ? (expanded ? FolderOpen : Folder) : FileIcon"
        :size="13"
        class="tree-icon"
      />
      <span class="tree-name">{{ entry.name }}</span>
    </div>

    <div v-if="expanded" class="tree-children">
      <div v-if="loading" class="tree-hint" :style="{ paddingLeft: `${(depth + 1) * 12 + 6}px` }">
        Loading…
      </div>
      <div
        v-else-if="error"
        class="tree-hint tree-hint-error"
        :style="{ paddingLeft: `${(depth + 1) * 12 + 6}px` }"
      >
        {{ error }}
      </div>
      <div
        v-else-if="children.length === 0"
        class="tree-hint"
        :style="{ paddingLeft: `${(depth + 1) * 12 + 6}px` }"
      >
        Empty
      </div>
      <FileTreeNode
        v-for="child in children"
        :key="child.path"
        :entry="child"
        :depth="depth + 1"
        :active-path="activePath"
        :show-hidden="showHidden"
        @open="emit('open', $event)"
        @context="emit('context', $event)"
        @drag-file="emit('drag-file', $event)"
      />
    </div>
  </div>
</template>

<style scoped>
.tree-row {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 2px 6px 2px 0;
  font-size: 11.5px;
  color: var(--tc-text-secondary);
  cursor: pointer;
  user-select: none;
  white-space: nowrap;
}

.tree-row:hover {
  background: var(--tc-bg-hover);
  color: var(--tc-text-primary);
}

.tree-row.active {
  background: var(--tc-accent-soft);
  color: var(--tc-text-primary);
}

.tree-caret {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 12px;
  flex-shrink: 0;
  color: var(--tc-text-muted);
}

.tree-icon {
  flex-shrink: 0;
  color: var(--tc-text-muted);
}

.tree-row.directory .tree-icon {
  color: var(--tc-info);
}

.tree-name {
  overflow: hidden;
  text-overflow: ellipsis;
}

.tree-hint {
  padding: 2px 6px;
  font-size: 11px;
  font-style: italic;
  color: var(--tc-text-muted);
}

.tree-hint-error {
  color: var(--tc-error);
  font-style: normal;
}
</style>
