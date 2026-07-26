<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref } from "vue";
import { Handle, Position } from "@vue-flow/core";
import { NodeResizer } from "@vue-flow/node-resizer";
import { X, Save, Pin, PinOff, ExternalLink } from "lucide-vue-next";
import type { FileNode } from "@renderer/type/workspace";
import { useFileStore } from "@renderer/store/file";
import { useWorkspaceStore } from "@renderer/store/workspace";
import { useTerminalStore } from "@renderer/store/terminal";
import { getBasename, getRelativePath } from "@renderer/util/path";
import CodeView from "@renderer/component/file/CodeView.vue";

/**
 * A file living on the canvas as its own node, dragged out of a terminal's tab
 * strip. It shares the same buffer as any tab showing the same file (the file
 * store refcounts by path), so an edit in one place is the edit in the other.
 */
const props = defineProps<{
  id: string;
  data: { file: FileNode };
  selected?: boolean;
  dragging?: boolean;
}>();

const fileStore = useFileStore();
const workspaceStore = useWorkspaceStore();
const terminalStore = useTerminalStore();

const codeView = ref<InstanceType<typeof CodeView> | null>(null);

const path = computed(() => props.data.file.path);
const name = computed(() => getBasename(path.value));
const dirty = computed(() => fileStore.isDirty(path.value));

/** Show the path relative to the pinning terminal's project, when there is one. */
const subtitle = computed(() => {
  const terminalId = props.data.file.pinnedToTerminalId;
  const session = terminalId ? terminalStore.getSession(terminalId) : undefined;
  const root = session?.fileRoot;
  return root ? getRelativePath(root, path.value) : path.value;
});

const pinnedName = computed(() => {
  const terminalId = props.data.file.pinnedToTerminalId;
  if (!terminalId) return null;
  const session = terminalStore.getSession(terminalId);
  return session ? session.manualName || session.autoName || session.name : null;
});

function togglePin(): void {
  workspaceStore.updateFileNode(props.id, {
    // Unpinning is one-way from here: re-pinning would need a target terminal,
    // and dragging the file out of one again is the natural way to do that.
    pinnedToTerminalId: null,
  });
}

function reveal(): void {
  void window.api.file.reveal(path.value);
}

function closeNode(): void {
  if (dirty.value) {
    const discard = window.confirm(`${name.value} has unsaved changes. Close without saving?`);
    if (!discard) return;
  }
  fileStore.close(path.value);
  workspaceStore.removeFileNode(props.id);
}

onMounted(() => {
  void fileStore.open(path.value);
});

onBeforeUnmount(() => {
  fileStore.close(path.value);
});
</script>

<template>
  <div class="file-node" :class="{ selected, dragging }">
    <Handle type="target" :position="Position.Top" />
    <NodeResizer :min-width="280" :min-height="180" />

    <div class="file-node-inner">
      <div class="file-node-header">
        <div class="file-node-title">
          <span class="file-node-name">{{ name }}</span>
          <span v-if="dirty" class="file-node-dirty" title="Unsaved changes" />
          <span class="file-node-sub" :title="path">{{ subtitle }}</span>
        </div>
        <div class="file-node-actions nodrag">
          <button
            v-if="dirty"
            class="file-node-btn"
            title="Save (⌘S)"
            @click.stop="codeView?.save()"
          >
            <Save :size="12" />
          </button>
          <button
            class="file-node-btn"
            :title="pinnedName ? `Pinned to ${pinnedName} — click to unpin` : 'Not pinned'"
            @click.stop="togglePin"
          >
            <component :is="pinnedName ? Pin : PinOff" :size="12" />
          </button>
          <button
            class="file-node-btn"
            title="Reveal in file manager"
            @click.stop="reveal"
          >
            <ExternalLink :size="12" />
          </button>
          <button class="file-node-btn file-node-btn-close" title="Close" @click.stop="closeNode">
            <X :size="12" />
          </button>
        </div>
      </div>

      <div class="file-node-body">
        <CodeView
          ref="codeView"
          :path="path"
          :zoom="workspaceStore.viewport.zoom"
          :active="selected"
        />
      </div>
    </div>

    <Handle type="source" :position="Position.Bottom" />
  </div>
</template>

<style scoped>
.file-node {
  position: relative;
  width: 100%;
  height: 100%;
}

.file-node-inner {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  background: var(--tc-bg-card);
  border: 1px solid var(--tc-border-color);
  border-radius: var(--tc-border-radius);
  overflow: hidden;
  box-shadow: var(--tc-shadow-md);
}

.file-node.selected .file-node-inner {
  box-shadow: 0 0 0 2px var(--tc-accent), var(--tc-shadow-lg);
}

.file-node-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 6px 5px 10px;
  background: var(--tc-bg-header);
  border-bottom: 1px solid var(--tc-border-color);
  flex-shrink: 0;
  cursor: grab;
}

.file-node-title {
  display: flex;
  align-items: baseline;
  gap: 6px;
  flex: 1;
  min-width: 0;
}

.file-node-name {
  font-size: 12px;
  font-weight: 600;
  color: var(--tc-text-primary);
  white-space: nowrap;
}

.file-node-dirty {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--tc-warning);
  flex-shrink: 0;
  align-self: center;
}

.file-node-sub {
  font-size: 10.5px;
  color: var(--tc-text-muted);
  font-family: var(--tc-font-mono);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.file-node-actions {
  display: flex;
  gap: 1px;
  flex-shrink: 0;
}

.file-node-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  background: none;
  border: none;
  border-radius: var(--tc-border-radius-sm);
  color: var(--tc-text-muted);
  cursor: pointer;
}

.file-node-btn:hover {
  background: var(--tc-bg-hover);
  color: var(--tc-text-primary);
}

.file-node-btn-close:hover {
  color: var(--tc-accent);
}

.file-node-body {
  flex: 1;
  min-height: 0;
  overflow: hidden;
}
</style>
