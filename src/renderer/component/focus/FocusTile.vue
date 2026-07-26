<script setup lang="ts">
import { computed } from "vue";
import type { TerminalSession } from "@renderer/type/terminal";
import { useTerminalStore } from "@renderer/store/terminal";
import { useUIStore } from "@renderer/store/ui";
import { AGENT_META } from "@renderer/util/agents";
import TerminalHeader from "@renderer/component/terminal/TerminalHeader.vue";
import TerminalFooter from "@renderer/component/terminal/TerminalFooter.vue";
import XtermView from "@renderer/component/terminal/XtermView.vue";
import { Minimize2, ArrowLeftRight } from "lucide-vue-next";

const props = defineProps<{
  session: TerminalSession;
  /** Id of the tile currently being dragged (for the swap gesture), if any. */
  draggingId?: string | null;
  /** Id of the tile the drag is currently hovering as a drop/swap target. */
  dropTargetId?: string | null;
}>();

const emit = defineEmits<{
  /** Header pressed -- the parent decides whether it becomes a swap-drag. */
  (e: "drag-start", id: string, event: PointerEvent): void;
}>();

const terminalStore = useTerminalStore();
const uiStore = useUIStore();

const isFocused = computed(() => terminalStore.focusedTerminalId === props.session.id);
const needsAttention = computed(() => props.session.needsAttention);
const attentionReason = computed(() => props.session.attentionReason);
const agentColor = computed(() =>
  props.session.activeAgent ? AGENT_META[props.session.activeAgent].color : null
);
const memoryOpen = computed(() => uiStore.focusMemoryTerminalId === props.session.id);

const isDragging = computed(() => props.draggingId === props.session.id);
const isDropTarget = computed(
  () => props.dropTargetId === props.session.id && props.draggingId !== props.session.id
);

function focusBody(): void {
  terminalStore.setFocused(props.session.id);
}

function handleKill(): void {
  terminalStore.killSession(props.session.id);
  terminalStore.removeSession(props.session.id);
  uiStore.removeFromFocus(props.session.id);
}

async function handleRestart(): Promise<void> {
  await terminalStore.restartSession(props.session.id);
}

async function handleClear(): Promise<void> {
  await terminalStore.clearTerminal(props.session.id);
}

/** Take this terminal off the Focus stage; it stays live on the canvas. */
function removeFromFocusView(): void {
  uiStore.removeFromFocus(props.session.id);
}

/**
 * Pressing the header starts a potential swap-drag. Buttons/inputs inside the
 * header keep working (rename, close, focus…) -- only presses on the bare bar
 * begin a drag, and even then only once the pointer has actually moved (the
 * parent applies that threshold).
 */
function onHeaderPointerDown(e: PointerEvent): void {
  if (e.button !== 0) return;
  const el = e.target as HTMLElement;
  if (el.closest("button, input")) return;
  // Suppress text selection of the header while a drag may be starting.
  e.preventDefault();
  emit("drag-start", props.session.id, e);
}
</script>

<template>
  <div
    class="focus-tile"
    :data-focus-tile="session.id"
    :class="{
      focused: isFocused,
      'needs-attention': needsAttention,
      'attention-input': attentionReason === 'input',
      dragging: isDragging,
      'drop-target': isDropTarget,
    }"
  >
    <div
      v-if="agentColor"
      class="focus-tile-accent"
      :style="{ background: agentColor }"
    />

    <!-- Header doubles as the drag handle for swapping tiles. -->
    <div class="focus-tile-drag" title="Drag to swap this terminal's position" @pointerdown="onHeaderPointerDown">
      <TerminalHeader
        :session="session"
        @kill="handleKill"
        @restart="handleRestart"
        @clear="handleClear"
      />
    </div>

    <button
      class="focus-tile-remove"
      title="Remove from focus view (keeps it in canvas)"
      @click.stop="removeFromFocusView"
    >
      <Minimize2 :size="13" />
    </button>

    <div class="focus-tile-body" @mousedown="focusBody">
      <XtermView
        :terminal-id="session.id"
        :cols="session.cols"
        :rows="session.rows"
        @focus="focusBody"
      />
    </div>

    <TerminalFooter
      :session="session"
      :memory-visible="memoryOpen"
      @toggle-memory="uiStore.toggleFocusMemory(session.id)"
    />

    <!-- Drop-target cue while another tile is being dragged over this one. -->
    <div v-if="isDropTarget" class="focus-tile-drop-cue">
      <ArrowLeftRight :size="22" />
      <span>Swap</span>
    </div>
  </div>
</template>

<style scoped>
.focus-tile {
  position: relative;
  display: flex;
  flex-direction: column;
  min-height: 0;
  min-width: 0;
  background: var(--tc-bg-card);
  border: 1px solid var(--tc-border-color);
  border-radius: var(--tc-border-radius);
  overflow: hidden;
  box-shadow: var(--tc-shadow-md);
  transition: box-shadow var(--tc-transition-fast), opacity var(--tc-transition-fast),
    transform var(--tc-transition-fast);
}

.focus-tile.focused {
  box-shadow: 0 0 0 2px var(--tc-accent), var(--tc-shadow-lg);
}

/* Compact the shared header on the Focus stage -- full-screen tiles don't need
   the roomier canvas header, and shrinking it hands more space to the terminal
   itself (per the "header takes a lot of space" note). */
.focus-tile :deep(.terminal-header) {
  min-height: 30px;
  padding: 3px 9px;
  cursor: grab;
}

.focus-tile.dragging :deep(.terminal-header) {
  cursor: grabbing;
}

.focus-tile-drag {
  flex-shrink: 0;
}

/* The tile being dragged: lifted, dimmed, ringed so it clearly reads as "in
   flight" while you pick where to drop it. */
.focus-tile.dragging {
  opacity: 0.55;
  transform: scale(0.98);
  box-shadow: 0 0 0 2px var(--tc-accent), var(--tc-shadow-lg);
}

/* The tile you'd swap with: accent ring + tint. */
.focus-tile.drop-target {
  box-shadow: 0 0 0 3px var(--tc-accent), var(--tc-shadow-lg);
}

.focus-tile-drop-cue {
  position: absolute;
  inset: 0;
  z-index: 6;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  pointer-events: none;
  color: var(--tc-accent);
  font-size: var(--tc-font-size-sm);
  font-weight: 600;
  background: color-mix(in srgb, var(--tc-accent) 14%, transparent);
  backdrop-filter: blur(1px);
}

/* Striking animated gradient ring when the agent wants attention. */
.focus-tile.needs-attention {
  border-color: transparent;
}

.focus-tile.needs-attention::after {
  content: "";
  position: absolute;
  inset: 0;
  border-radius: var(--tc-border-radius);
  padding: 2px;
  background: linear-gradient(120deg, var(--tc-warning), var(--tc-accent), var(--tc-warning));
  background-size: 300% 300%;
  -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
  -webkit-mask-composite: xor;
  mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
  mask-composite: exclude;
  animation: focus-attention-sweep 2.4s linear infinite;
  pointer-events: none;
}

.focus-tile.attention-input::after {
  background: linear-gradient(120deg, var(--tc-accent), #64b5f6, var(--tc-accent));
  background-size: 300% 300%;
}

@keyframes focus-attention-sweep {
  0% { background-position: 0% 50%; }
  100% { background-position: 300% 50%; }
}

@media (prefers-reduced-motion: reduce) {
  .focus-tile.needs-attention::after {
    animation: none;
  }
}

.focus-tile-accent {
  height: 3px;
  flex-shrink: 0;
}

.focus-tile-body {
  flex: 1;
  min-height: 0;
  background: var(--tc-terminal-bg);
  overflow: hidden;
  cursor: text;
}

.focus-tile-remove {
  position: absolute;
  top: 6px;
  right: 8px;
  z-index: 3;
  width: 22px;
  height: 22px;
  border: 1px solid var(--tc-border-color);
  background: var(--tc-bg-card);
  color: var(--tc-text-muted);
  border-radius: var(--tc-border-radius-sm);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0;
  /* Only the background reacts to hover -- the icon itself stays put (no colour
     or size change), per the "don't change the button icon on hover" note. */
  transition: opacity var(--tc-transition-fast), background var(--tc-transition-fast);
}

.focus-tile:hover .focus-tile-remove {
  opacity: 1;
}

.focus-tile-remove:hover {
  background: var(--tc-bg-hover);
}
</style>
