<script setup lang="ts">
import { computed, ref, watch, onUnmounted } from "vue";
import type { TerminalSession } from "@renderer/type/terminal";
import { useTerminalStore } from "@renderer/store/terminal";
import { useUIStore } from "@renderer/store/ui";
import { useWorkspaceStore } from "@renderer/store/workspace";
import { usePromptStore } from "@renderer/store/prompt";
import { useSummaryStore } from "@renderer/store/summary";
import { useFileStore } from "@renderer/store/file";
import { Handle, Position } from "@vue-flow/core";
import { NodeResizer } from "@vue-flow/node-resizer";
import { AGENT_META } from "@renderer/util/agents";
import { useResizeHandle } from "@renderer/composable/useResizeHandle";
import { Bell } from "lucide-vue-next";
import TerminalHeader from "@renderer/component/terminal/TerminalHeader.vue";
import TerminalFooter from "@renderer/component/terminal/TerminalFooter.vue";
import XtermView from "@renderer/component/terminal/XtermView.vue";
import PromptRail from "@renderer/component/terminal/PromptRail.vue";
import FileDrawer from "@renderer/component/file/FileDrawer.vue";
import FileTabStrip from "@renderer/component/file/FileTabStrip.vue";
import CodeView from "@renderer/component/file/CodeView.vue";

// Props from Vue Flow node definition
const props = defineProps<{
  id: string;
  data: { session: TerminalSession };
  selected?: boolean;
  dragging?: boolean;
  dimensions?: { width: number; height: number };
}>();

const emit = defineEmits<{
  (e: "resize", size: { width: number; height: number }): void;
}>();

const terminalStore = useTerminalStore();
const uiStore = useUIStore();
const workspaceStore = useWorkspaceStore();
const promptStore = usePromptStore();
const summaryStore = useSummaryStore();

// Local state
// Hidden by default -- most terminals don't need it open all the time, and
// it competes for space with the actual terminal. Toggled per-terminal via
// the footer's prompt-count button.
const showPromptRail = ref(false);
const isHovered = ref(false);

// Display name, same precedence as the header.
const displayName = computed(
  () => props.data.session.manualName || props.data.session.autoName || props.data.session.name
);

// Most recently submitted prompt for this terminal (for the zoomed-out
// hover preview) -- getPromptsForTerminal sorts pinned-first, so re-pick
// strictly by time here.
const lastPrompt = computed(() => {
  const prompts = promptStore
    .getPromptsForTerminal(props.id)
    .filter((p) => p.status !== "deleted");
  if (prompts.length === 0) return null;
  return [...prompts].sort((a, b) => b.submittedAt - a.submittedAt)[0].text;
});

// What to actually render for the last command: an AI-condensed one-liner when
// the command is long (and a summary has arrived), otherwise the text itself.
const lastPromptDisplay = computed(() =>
  lastPrompt.value ? summaryStore.display(lastPrompt.value) : ""
);

function handleMouseEnter(): void {
  isHovered.value = true;
  uiStore.setHoveredTerminal(props.id);
  // Warm the AI summary so it's ready by the time the card is read.
  if (lastPrompt.value) summaryStore.request(lastPrompt.value);
}

function handleMouseLeave(): void {
  isHovered.value = false;
  // Only clear if we're still the hovered one (guards against enter/leave
  // races between adjacent nodes).
  if (uiStore.hoveredTerminalId === props.id) uiStore.setHoveredTerminal(null);
}

// Attention badge tooltip, including the new "input" (waiting-on-you) reason.
const attentionTitle = computed(() => {
  switch (props.data.session.attentionReason) {
    case "bell":
      return "Rang the bell — click to view";
    case "input":
      return "Waiting for your input — click to respond";
    default:
      return "Looks idle — click to view";
  }
});

// When zoomed out far enough that the terminal's own text is illegible,
// hovering surfaces a name + last-prompt card. It counter-scales by the
// inverse of the canvas zoom so it stays a constant, readable on-screen
// size no matter how far out you are (the whole point -- a preview that
// shrank with the node would be just as unreadable as the node itself).
const showHoverPreview = computed(
  () => isHovered.value && !props.dragging && workspaceStore.viewport.zoom < 0.75
);
const inverseZoom = computed(() => 1 / (workspaceStore.viewport.zoom || 1));

// Both rails live inside the zoomable canvas, so the drag delta has to be
// divided by the current zoom or the rail resizes at a different rate than the
// cursor moves.
const canvasScale = () => workspaceStore.viewport.zoom || 1;

const { startResize: startMemoryResize } = useResizeHandle(
  () => uiStore.memoryRailWidth,
  (w) => uiStore.setMemoryRailWidth(w),
  "left",
  canvasScale
);

// ─── File explorer drawer + file tabs ──────────────────────────────

const fileStore = useFileStore();

const drawerOpen = computed(() => props.data.session.fileDrawerOpen);
const minNodeWidth = computed(() => 300 + (drawerOpen.value ? uiStore.fileDrawerWidth : 0));
const fileRoot = computed(() => props.data.session.fileRoot || props.data.session.cwd);
const activeTab = computed(() => fileStore.getActiveTab(props.id));
const hasTabs = computed(() => fileStore.getTabs(props.id).length > 0);

/**
 * The drawer grows the node leftward rather than eating into the terminal: the
 * terminal stays exactly where it was on the canvas and the explorer claims new
 * space beside it. Keeping node.x/width authoritative (instead of offsetting at
 * render time) means drag, resize, the minimap and workspace saves all keep
 * agreeing about where this node actually is -- which is also why the open flag
 * is persisted on the session alongside the geometry it changed.
 */
function toggleDrawer(): void {
  const width = uiStore.fileDrawerWidth;
  const node = props.data.session.node;
  const opening = !drawerOpen.value;

  terminalStore.updateNode(props.id, {
    x: node.x + (opening ? -width : width),
    width: Math.max(300, node.width + (opening ? width : -width)),
  });
  terminalStore.updateSession(props.id, { fileDrawerOpen: opening });

  // Groups are fixed frames, not auto-fitted boxes, so a node growing left can
  // poke out of its own group. Membership isn't affected (that's only
  // recomputed on drag), but the frame should still contain what it owns.
  if (opening && props.data.session.groupId) {
    const group = workspaceStore.groups.find((g) => g.id === props.data.session.groupId);
    const newLeft = node.x - width;
    if (group && newLeft < group.x) {
      workspaceStore.updateGroup(group.id, {
        x: newLeft - 12,
        width: group.width + (group.x - newLeft) + 12,
      });
    }
  }
}

const { startResize: startDrawerResize } = useResizeHandle(
  () => uiStore.fileDrawerWidth,
  (w) => {
    // Growing the drawer must grow the node too, or it would eat the terminal.
    const delta = uiStore.setFileDrawerWidth(w);
    if (delta === 0) return;
    const node = props.data.session.node;
    terminalStore.updateNode(props.id, { x: node.x - delta, width: node.width + delta });
  },
  "right",
  canvasScale
);

function openFile(path: string): void {
  void fileStore.openInTerminal(props.id, path);
  terminalStore.setFocused(props.id);
}

function changeFileRoot(dir: string): void {
  terminalStore.updateSession(props.id, { fileRoot: dir, fileRootPinned: true });
  void window.api.terminal.setFileRoot(props.id, dir);
}

// Is this terminal currently focused?
const isFocused = computed(
  () => terminalStore.focusedTerminalId === props.id
);

// When this terminal is on the Focus stage, its xterm lives in the focus tile
// instead -- don't also mount one here, or two xterm instances would fight over
// the one PTY (double resize). The focus tile replays the buffer so nothing is
// lost across the move.
const isStaged = computed(
  () => uiStore.focusModeActive && uiStore.isInFocusSet(props.id)
);

// Does it need attention (idle after being busy, or rang the bell)?
const needsAttention = computed(() => props.data.session.needsAttention);

// Colored top accent so an active coding agent is recognizable at a glance
// even when zoomed out on the canvas, not just from the header text.
const agentColor = computed(() => {
  const agent = props.data.session.activeAgent;
  return agent ? AGENT_META[agent].color : null;
});

function acknowledgeAttention(): void {
  terminalStore.setFocused(props.id);
}

// Handle click on the terminal body — focus it
function handleBodyClick(): void {
  terminalStore.setFocused(props.id);
}

/** Open this single terminal full-screen on the Focus stage (header button). */
function focusSolo(): void {
  uiStore.enterFocus([props.id]);
}

// Handle kill action from header
function handleKill(): void {
  terminalStore.killSession(props.id);
  terminalStore.removeSession(props.id);
}

// Handle restart action from header
async function handleRestart(): Promise<void> {
  await terminalStore.restartSession(props.id);
}

// Handle clear action from header
async function handleClear(): Promise<void> {
  await terminalStore.clearTerminal(props.id);
}

onUnmounted(() => {
  if (uiStore.hoveredTerminalId === props.id) uiStore.setHoveredTerminal(null);
});

// Watch for dimension changes and resize terminal accordingly
watch(
  () => props.dimensions,
  (newDims) => {
    if (newDims?.width && newDims?.height) {
      // Store the new node dimensions
      terminalStore.updateNode(props.id, {
        width: newDims.width,
        height: newDims.height,
      });
    }
  },
  { deep: true }
);
</script>

<template>
  <div
    class="terminal-node"
    :class="{ selected, focused: isFocused, dragging, 'needs-attention': needsAttention }"
    @mouseenter="handleMouseEnter"
    @mouseleave="handleMouseLeave"
  >
    <Handle type="target" :position="Position.Top" />
    <!-- The drawer's width is part of the node box while it's open, so the
         minimum has to grow with it or resizing crushes the file tree. -->
    <NodeResizer :min-width="minNodeWidth" :min-height="200" />

    <!-- Zoomed-out hover preview: name + last prompt, counter-scaled so it
         stays readable however far out the canvas is zoomed. -->
    <div
      v-if="showHoverPreview"
      class="terminal-hover-preview nodrag"
      :style="{ transform: `scale(${inverseZoom})` }"
    >
      <div class="hover-preview-name">
        <span
          v-if="agentColor"
          class="hover-preview-dot"
          :style="{ background: agentColor }"
        />
        {{ displayName }}
      </div>
      <div v-if="lastPrompt" class="hover-preview-prompt">{{ lastPromptDisplay }}</div>
      <div v-else class="hover-preview-prompt hover-preview-empty">No prompts yet</div>
    </div>
    <button
      v-if="needsAttention"
      class="attention-badge"
      :class="{ 'attention-badge-input': data.session.attentionReason === 'input' }"
      :title="attentionTitle"
      @click.stop="acknowledgeAttention"
    >
      <Bell :size="13" />
    </button>
    <div class="terminal-node-inner">
      <!-- File explorer, occupying the space the node grew into on its left. -->
      <template v-if="drawerOpen">
        <FileDrawer
          class="terminal-file-drawer"
          :style="{ '--file-drawer-width': uiStore.fileDrawerWidth + 'px' }"
          :terminal-id="id"
          :root="fileRoot"
          :active-path="activeTab"
          @open="openFile"
          @close="toggleDrawer"
          @root-change="changeFileRoot"
        />
        <div class="drawer-resize-handle" @mousedown.stop="startDrawerResize" />
      </template>

      <div class="terminal-main">
        <div
          v-if="agentColor"
          class="terminal-agent-accent"
          :style="{ background: agentColor }"
        />
        <!-- Header: drag handle + session info + controls -->
        <TerminalHeader
          :session="data.session"
          :can-focus="true"
          @focus="terminalStore.setFocused(id)"
          @focus-solo="focusSolo"
          @kill="handleKill"
          @restart="handleRestart"
          @clear="handleClear"
        />

        <!-- Tabs appear only once there's something to switch between; a lone
             "Terminal" tab on every node would be pure chrome. -->
        <FileTabStrip
          v-if="hasTabs || drawerOpen"
          :terminal-id="id"
          :drawer-open="drawerOpen"
          @toggle-drawer="toggleDrawer"
        />

        <!-- Body: xterm terminal + optional prompt rail -->
        <div class="terminal-node-body nodrag">
          <div class="terminal-area" @click.stop="handleBodyClick">
            <!-- The xterm stays mounted behind an open file: unmounting it
                 resets the PTY screen, and display:none breaks FitAddon's
                 measurements. The editor simply covers it. -->
            <XtermView
              v-if="!isStaged"
              :terminal-id="data.session.id"
              :cols="data.session.cols"
              :rows="data.session.rows"
              @focus="terminalStore.setFocused(id)"
            />
            <div v-else-if="!activeTab" class="terminal-staged-note">On the focus stage</div>

            <CodeView
              v-if="activeTab"
              class="terminal-code-overlay"
              :path="activeTab"
              :zoom="workspaceStore.viewport.zoom"
              :active="isFocused"
            />
          </div>
          <div
            v-show="showPromptRail"
            class="memory-resize-handle"
            @mousedown.stop="startMemoryResize"
          />
          <PromptRail
            v-show="showPromptRail"
            :terminal-id="data.session.id"
            class="terminal-memory"
            :style="{ '--memory-rail-width': uiStore.memoryRailWidth + 'px' }"
          />
        </div>

        <!-- Footer: CWD + dimensions -->
        <TerminalFooter
          :session="data.session"
          :memory-visible="showPromptRail"
          :files-visible="drawerOpen"
          @toggle-memory="showPromptRail = !showPromptRail"
          @toggle-files="toggleDrawer"
        />
      </div>

      <!-- Resize handled by NodeResizer -->
    </div>
    <Handle type="source" :position="Position.Bottom" />
  </div>
</template>

<style scoped>
.terminal-node {
  position: relative;
  width: 100%;
  height: 100%;
  border-radius: var(--tc-border-radius);
  /* No overflow:hidden here (unlike terminal-node-inner) so the attention
     badge can sit just outside the card's corner without being clipped. */
}

.terminal-hover-preview {
  position: absolute;
  bottom: 100%;
  left: 0;
  margin-bottom: 8px;
  /* Counter-scaled inline (see inverseZoom); anchor the growth from the
     bottom-left corner so it expands up-and-right off the node's top edge. */
  transform-origin: left bottom;
  width: 300px;
  max-width: 300px;
  padding: 10px 12px;
  background: var(--tc-bg-card);
  border: 1px solid var(--tc-border-color);
  border-radius: var(--tc-border-radius);
  box-shadow: var(--tc-shadow-lg);
  z-index: var(--tc-z-node-selected);
  pointer-events: none;
}

/* Name is the secondary line -- small, muted -- so the last prompt below it
   is what the eye lands on first. */
.hover-preview-name {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  font-weight: 600;
  color: var(--tc-text-muted);
  margin-bottom: 6px;
}

.hover-preview-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

/* The last prompt leads: bigger, bolder, primary-coloured. */
.hover-preview-prompt {
  font-size: 14px;
  font-weight: 600;
  line-height: 1.4;
  color: var(--tc-text-primary);
  font-family: var(--tc-font-mono);
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.hover-preview-empty {
  font-style: italic;
  opacity: 0.6;
  font-family: var(--tc-font-sans);
}

.terminal-node-inner {
  width: 100%;
  height: 100%;
  display: flex;
  /* Row, not column: the file drawer sits beside the terminal, which keeps its
     own header/tabs/footer stack inside .terminal-main. */
  flex-direction: row;
  background: var(--tc-bg-card);
  border: 1px solid var(--tc-border-color);
  border-radius: var(--tc-border-radius);
  overflow: hidden;
  box-shadow: var(--tc-shadow-md);
  transition: box-shadow var(--tc-transition-fast);
}

.terminal-node.selected .terminal-node-inner {
  box-shadow: 0 0 0 2px var(--tc-accent), var(--tc-shadow-lg);
}

/* Figma-style selection: the whole header bar turns accent-colored so a
   selected terminal is unmistakable at a glance -- not just a thin ring around
   the card. Targets the child TerminalHeader's scoped elements via :deep. */
.terminal-node.selected :deep(.terminal-header) {
  background: var(--tc-accent);
  border-bottom-color: color-mix(in srgb, var(--tc-accent) 65%, black);
}

.terminal-node.selected :deep(.header-name),
.terminal-node.selected :deep(.header-cwd),
.terminal-node.selected :deep(.header-btn) {
  color: #fff;
}

.terminal-node.selected :deep(.header-shell-badge) {
  color: #fff;
  background: rgba(255, 255, 255, 0.18);
}

.terminal-node.selected :deep(.header-btn:hover) {
  background: rgba(255, 255, 255, 0.22);
  color: #fff;
}

.terminal-node.selected :deep(.header-name:hover) {
  text-decoration-color: #fff;
}

.terminal-main {
  position: relative;
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  min-height: 0;
}

.terminal-file-drawer {
  width: var(--file-drawer-width, 240px);
  flex-shrink: 0;
}

.drawer-resize-handle {
  width: 4px;
  margin-left: -2px;
  margin-right: -2px;
  cursor: col-resize;
  flex-shrink: 0;
  z-index: 1;
}

.drawer-resize-handle:hover {
  background: var(--tc-accent-soft);
}

/* Covers the xterm rather than replacing it -- see the template comment. */
.terminal-code-overlay {
  position: absolute;
  inset: 0;
  z-index: 2;
}

.terminal-node.focused .terminal-node-inner {
  box-shadow: 0 0 0 1px var(--tc-accent-soft), var(--tc-shadow-md);
}

.terminal-node.selected.focused .terminal-node-inner {
  box-shadow: 0 0 0 2px var(--tc-accent), var(--tc-shadow-lg);
}

.terminal-node.needs-attention .terminal-node-inner {
  box-shadow: 0 0 0 2px var(--tc-warning), var(--tc-shadow-lg);
  animation: attention-pulse 1.6s ease-in-out infinite;
}

@media (prefers-reduced-motion: reduce) {
  .terminal-node.needs-attention .terminal-node-inner {
    animation: none;
  }
}

@keyframes attention-pulse {
  0%, 100% { box-shadow: 0 0 0 2px var(--tc-warning), var(--tc-shadow-lg); }
  50% { box-shadow: 0 0 0 4px var(--tc-warning), var(--tc-shadow-lg); }
}

.attention-badge {
  position: absolute;
  top: -10px;
  right: -10px;
  width: 26px;
  height: 26px;
  border-radius: 50%;
  border: 2px solid var(--tc-bg-primary);
  background: var(--tc-warning);
  color: #1a1a2e;
  font-size: 13px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  z-index: 20;
  box-shadow: var(--tc-shadow-sm);
  padding: 0;
}

.attention-badge:hover {
  filter: brightness(1.1);
}

/* "Waiting for your input" reads differently from a plain idle/bell finish:
   accent-colored rather than the amber warning, since it's an active block. */
.attention-badge-input {
  background: var(--tc-accent);
  color: #fff;
}

.terminal-agent-accent {
  height: 3px;
  flex-shrink: 0;
}

.terminal-node-body {
  flex: 1;
  display: flex;
  min-height: 0;
  overflow: hidden;
}

.terminal-area {
  /* Positioned so an open file can be laid over the still-mounted xterm. */
  position: relative;
  flex: 1;
  min-width: 0;
  background: var(--tc-terminal-bg);
  overflow: hidden;
  cursor: text;
}

.terminal-staged-note {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--tc-text-muted);
  font-size: var(--tc-font-size-sm);
  font-style: italic;
  user-select: none;
}

.terminal-memory {
  flex-shrink: 0;
  border-left: 1px solid var(--tc-border-color);
  background: var(--tc-memory-bg);
  overflow-y: auto;
}

.memory-resize-handle {
  /* This one takes real layout space (flex row, not an absolute overlay),
     so it's widened more modestly than the sidebar/inspector handles. */
  width: 8px;
  flex-shrink: 0;
  cursor: col-resize;
  z-index: 5;
}

.memory-resize-handle:hover,
.memory-resize-handle:active {
  background: var(--tc-accent);
  opacity: 0.5;
}


</style>
