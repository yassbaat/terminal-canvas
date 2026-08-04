<script setup lang="ts">
import { computed } from "vue";
import { useVueFlow } from "@vue-flow/core";
import { Bell, ChevronRight, FileCode2, X } from "lucide-vue-next";
import { useTerminalStore } from "@renderer/store/terminal";
import { useWorkspaceStore } from "@renderer/store/workspace";
import { useUIStore } from "@renderer/store/ui";
import { useFileStore } from "@renderer/store/file";
import { AGENT_META } from "@renderer/util/agents";
import { getBasename } from "@renderer/util/path";

/**
 * One terminal in the Layers tree, plus the editors detached from it.
 *
 * Lives in its own component only so the grouped and ungrouped lists in
 * Sidebar.vue render the identical row instead of two drifting copies of it.
 * It carries no styles of its own -- the whole tree is styled from Sidebar.vue
 * via :deep(), so there's still exactly one place the look is defined.
 */
const props = defineProps<{
  terminalId: string;
  /** Rendered as a child of a group frame (one extra indent step). */
  nested?: boolean;
}>();

const terminalStore = useTerminalStore();
const workspaceStore = useWorkspaceStore();
const uiStore = useUIStore();
const fileStore = useFileStore();
const { setCenter, getViewport } = useVueFlow("canvas");

const session = computed(() => terminalStore.sessions.get(props.terminalId));

/**
 * The editors bound to this terminal: files dragged out of it onto the canvas.
 * Canvas objects only, like every other row in this panel -- a tab that is
 * still inside the terminal has no position, no selection and no minimap
 * presence, so it has nothing to be a layer of.
 */
const files = computed(() =>
  workspaceStore.fileNodes.filter((f) => f.pinnedToTerminalId === props.terminalId)
);

const expanded = computed(() => uiStore.isLayerExpanded(props.terminalId));
const agent = computed(() => (session.value?.activeAgent ? AGENT_META[session.value.activeAgent] : null));

const isSelected = computed(() => terminalStore.selectedTerminalIds.has(props.terminalId));
const isCanvasHovered = computed(() => uiStore.hoveredTerminalId === props.terminalId);
const isExited = computed(
  () => session.value?.status === "exited" || session.value?.status === "crashed"
);

function toggle(): void {
  uiStore.toggleLayerExpanded(props.terminalId);
}

function selectTerminal(event: MouseEvent): void {
  const multi = event.ctrlKey || event.metaKey || event.shiftKey;
  if (multi) {
    terminalStore.toggleSelected(props.terminalId);
    return;
  }
  // Deliberately not setFocused: selecting from Layers is for highlighting and
  // grouping, and stealing keyboard focus into a terminal would silently kill
  // the canvas shortcuts.
  terminalStore.setSelected([props.terminalId]);
  workspaceStore.clearNoteSelection();
  workspaceStore.clearGroupSelection();
  workspaceStore.clearFileSelection();
}

function selectFile(id: string, event: MouseEvent): void {
  const multi = event.ctrlKey || event.metaKey || event.shiftKey;
  if (multi) {
    workspaceStore.toggleFileSelected(id);
    return;
  }
  workspaceStore.setFileSelected([id]);
  terminalStore.clearSelection();
  workspaceStore.clearNoteSelection();
  workspaceStore.clearGroupSelection();
}

/** Double-click pans/zooms the canvas to the thing the row stands for. */
function navigateToTerminal(): void {
  const s = session.value;
  if (!s) return;
  centerOn(s.node.x, s.node.y, s.node.width || 760, s.node.height || 480);
  terminalStore.setFocused(props.terminalId);
}

function navigateToFile(id: string): void {
  const file = workspaceStore.fileNodes.find((f) => f.id === id);
  if (!file) return;
  centerOn(file.x, file.y, file.width, file.height);
}

function centerOn(x: number, y: number, width: number, height: number): void {
  setCenter(x + width / 2, y + height / 2, {
    zoom: Math.max(getViewport().zoom, 0.75),
    duration: 400,
  });
}

async function kill(): Promise<void> {
  await terminalStore.closeSession(props.terminalId);
}
</script>

<template>
  <div v-if="session" class="layer-branch" :class="{ nested }">
    <div
      class="layer-item terminal-layer"
      :class="{
        selected: isSelected,
        'canvas-hovered': isCanvasHovered,
        exited: isExited,
      }"
      :data-layer-terminal="terminalId"
      @click="selectTerminal"
      @dblclick="navigateToTerminal"
      @mouseenter="uiStore.setHoveredLayer(terminalId)"
      @mouseleave="uiStore.hoveredLayerId === terminalId && uiStore.setHoveredLayer(null)"
    >
      <div class="layer-row">
        <button
          v-if="files.length"
          class="layer-twisty"
          :class="{ open: expanded }"
          :title="expanded ? 'Collapse' : 'Expand'"
          @click.stop="toggle"
        >
          <ChevronRight :size="12" />
        </button>
        <span v-else class="layer-twisty-spacer" />

        <span class="layer-status-dot" :class="`status-${session.status}`" />
        <component
          :is="agent.icon"
          v-if="agent"
          class="layer-agent-glyph"
          :size="11"
          :style="{ color: agent.color }"
          :title="agent.label"
        />
        <!-- The working directory is the row's tooltip rather than a second
             line: at rest the panel is names only (Figma's object list), and
             the path is one hover away. -->
        <span class="layer-name" :title="session.cwd">{{ session.name }}</span>
        <!-- Off by default; the Settings toggle still promises it here, so it
             stays -- as a trailing chip rather than the old second line. -->
        <span v-if="uiStore.showShellType" class="layer-shell">{{ session.shellName }}</span>
        <span v-if="files.length && !expanded" class="layer-badge">{{ files.length }}</span>
        <Bell v-if="session.needsAttention" class="layer-attention" :size="11" title="Needs attention" />
        <button class="layer-kill" title="Kill" @click.stop="kill">
          <X :size="12" />
        </button>
      </div>
    </div>

    <div v-if="expanded && files.length" class="layer-children">
      <div
        v-for="file in files"
        :key="file.id"
        class="layer-item file-layer"
        :class="{ selected: workspaceStore.selectedFileIds.has(file.id) }"
        @click.stop="selectFile(file.id, $event)"
        @dblclick.stop="navigateToFile(file.id)"
        @mouseenter="uiStore.setHoveredLayer(file.id)"
        @mouseleave="uiStore.hoveredLayerId === file.id && uiStore.setHoveredLayer(null)"
      >
        <div class="layer-row">
          <span class="layer-twisty-spacer" />
          <FileCode2 class="layer-icon layer-file-icon" :size="12" />
          <span class="layer-name" :title="file.path">{{ getBasename(file.path) }}</span>
          <span v-if="fileStore.isDirty(file.path)" class="layer-dirty" title="Unsaved changes" />
        </div>
      </div>
    </div>
  </div>
</template>
