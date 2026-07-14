<script setup lang="ts">
import { computed } from "vue";
import type { TerminalSession } from "@renderer/type/terminal";
import { useTerminalStore } from "@renderer/store/terminal";
import { useUIStore } from "@renderer/store/ui";
import { AGENT_META } from "@renderer/util/agents";
import TerminalHeader from "@renderer/component/terminal/TerminalHeader.vue";
import TerminalFooter from "@renderer/component/terminal/TerminalFooter.vue";
import XtermView from "@renderer/component/terminal/XtermView.vue";
import { Minimize2 } from "lucide-vue-next";

const props = defineProps<{
  session: TerminalSession;
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

function removeFromStage(): void {
  uiStore.removeFromFocus(props.session.id);
}
</script>

<template>
  <div
    class="focus-tile"
    :class="{
      focused: isFocused,
      'needs-attention': needsAttention,
      'attention-input': attentionReason === 'input',
    }"
  >
    <div
      v-if="agentColor"
      class="focus-tile-accent"
      :style="{ background: agentColor }"
    />
    <TerminalHeader
      :session="session"
      @kill="handleKill"
      @restart="handleRestart"
      @clear="handleClear"
    />
    <button class="focus-tile-remove" title="Remove from stage (keeps it on the canvas)" @click.stop="removeFromStage">
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
  transition: box-shadow var(--tc-transition-fast);
}

.focus-tile.focused {
  box-shadow: 0 0 0 2px var(--tc-accent), var(--tc-shadow-lg);
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
  top: 8px;
  right: 8px;
  z-index: 3;
  width: 24px;
  height: 24px;
  border: 1px solid var(--tc-border-color);
  background: var(--tc-bg-card);
  color: var(--tc-text-muted);
  border-radius: var(--tc-border-radius-sm);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0;
  transition: opacity var(--tc-transition-fast), color var(--tc-transition-fast);
}

.focus-tile:hover .focus-tile-remove {
  opacity: 1;
}

.focus-tile-remove:hover {
  color: var(--tc-accent);
}
</style>
