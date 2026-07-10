<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { TerminalSession } from "@renderer/type/terminal";
import { useTerminalStore } from "@renderer/store/terminal";
import { useUIStore } from "@renderer/store/ui";
import { useWorkspaceStore } from "@renderer/store/workspace";
import { usePromptStore } from "@renderer/store/prompt";
import { Handle, Position } from "@vue-flow/core";
import { NodeResizer } from "@vue-flow/node-resizer";
import { AGENT_META } from "@renderer/util/agents";
import { useResizeHandle } from "@renderer/composable/useResizeHandle";
import { Bell } from "lucide-vue-next";
import TerminalHeader from "@renderer/component/terminal/TerminalHeader.vue";
import TerminalFooter from "@renderer/component/terminal/TerminalFooter.vue";
import XtermView from "@renderer/component/terminal/XtermView.vue";
import PromptRail from "@renderer/component/terminal/PromptRail.vue";

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

// When zoomed out far enough that the terminal's own text is illegible,
// hovering surfaces a name + last-prompt card. It counter-scales by the
// inverse of the canvas zoom so it stays a constant, readable on-screen
// size no matter how far out you are (the whole point -- a preview that
// shrank with the node would be just as unreadable as the node itself).
const showHoverPreview = computed(
  () => isHovered.value && !props.dragging && workspaceStore.viewport.zoom < 0.75
);
const inverseZoom = computed(() => 1 / (workspaceStore.viewport.zoom || 1));

const { startResize: startMemoryResize } = useResizeHandle(
  () => uiStore.memoryRailWidth,
  (w) => uiStore.setMemoryRailWidth(w),
  "left"
);

// Is this terminal currently focused?
const isFocused = computed(
  () => terminalStore.focusedTerminalId === props.id
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
    @mouseenter="isHovered = true"
    @mouseleave="isHovered = false"
  >
    <Handle type="target" :position="Position.Top" />
    <NodeResizer :min-width="300" :min-height="200" />

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
      <div v-if="lastPrompt" class="hover-preview-prompt">{{ lastPrompt }}</div>
      <div v-else class="hover-preview-prompt hover-preview-empty">No prompts yet</div>
    </div>
    <button
      v-if="needsAttention"
      class="attention-badge"
      :title="data.session.attentionReason === 'bell' ? 'Rang the bell — click to view' : 'Looks idle — click to view'"
      @click.stop="acknowledgeAttention"
    >
      <Bell :size="13" />
    </button>
    <div class="terminal-node-inner">
      <div
        v-if="agentColor"
        class="terminal-agent-accent"
        :style="{ background: agentColor }"
      />
      <!-- Header: drag handle + session info + controls -->
      <TerminalHeader
        :session="data.session"
        @focus="terminalStore.setFocused(id)"
        @kill="handleKill"
        @restart="handleRestart"
        @clear="handleClear"
      />

      <!-- Body: xterm terminal + optional prompt rail -->
      <div class="terminal-node-body nodrag">
        <div class="terminal-area" @click.stop="handleBodyClick">
          <XtermView
            :terminal-id="data.session.id"
            :cols="data.session.cols"
            :rows="data.session.rows"
            @focus="terminalStore.setFocused(id)"
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
        @toggle-memory="showPromptRail = !showPromptRail"
      />

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

.hover-preview-name {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 14px;
  font-weight: 600;
  color: var(--tc-text-primary);
  margin-bottom: 6px;
}

.hover-preview-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.hover-preview-prompt {
  font-size: 12px;
  line-height: 1.4;
  color: var(--tc-text-secondary);
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
  flex-direction: column;
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
  flex: 1;
  min-width: 0;
  background: var(--tc-terminal-bg);
  overflow: hidden;
  cursor: text;
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
