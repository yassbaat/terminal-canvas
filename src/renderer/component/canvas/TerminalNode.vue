<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { TerminalSession } from "@renderer/type/terminal";
import { useTerminalStore } from "@renderer/store/terminal";
import { Handle, Position } from "@vue-flow/core";
import { NodeResizer } from "@vue-flow/node-resizer";
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

// Local state
const showPromptRail = ref(true);

// Is this terminal currently focused?
const isFocused = computed(
  () => terminalStore.focusedTerminalId === props.id
);

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
    :class="{ selected, focused: isFocused, dragging }"
    @click="handleBodyClick"
    @wheel.stop
  >
    <Handle type="target" :position="Position.Top" />
    <NodeResizer :min-width="300" :min-height="200" />
    <div class="terminal-node-inner">
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
        <PromptRail
          v-show="showPromptRail"
          :terminal-id="data.session.id"
          class="terminal-memory"
        />
      </div>

      <!-- Footer: CWD + dimensions -->
      <TerminalFooter :session="data.session" />

      <!-- Resize handled by NodeResizer -->
    </div>
    <Handle type="source" :position="Position.Bottom" />
  </div>
</template>

<style scoped>
.terminal-node {
  width: 100%;
  height: 100%;
  border-radius: var(--tc-border-radius);
  overflow: hidden;
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
  width: 220px;
  flex-shrink: 0;
  border-left: 1px solid var(--tc-border-color);
  background: var(--tc-memory-bg);
  overflow-y: auto;
}


</style>
