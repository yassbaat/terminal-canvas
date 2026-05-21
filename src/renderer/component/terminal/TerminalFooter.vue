<script setup lang="ts">
import { computed } from "vue";
import type { TerminalSession } from "@renderer/type/terminal";
import { usePromptStore } from "@renderer/store/prompt";

const props = defineProps<{
  session: TerminalSession;
}>();

const promptStore = usePromptStore();

const promptCount = computed(() => promptStore.getPromptCount(props.session.id));
const statusClass = computed(() => `status-${props.session.status}`);
</script>

<template>
  <div class="terminal-footer">
    <div class="footer-left">
      <span class="footer-status" :class="statusClass">
        {{ session.status }}
      </span>
      <span class="footer-dim">&#8226;</span>
      <span class="footer-dim">{{ session.cols }}&#215;{{ session.rows }}</span>
    </div>
    <div class="footer-right">
      <span
        v-if="promptCount > 0"
        class="footer-prompt-count"
        title="Agent Memory entries"
      >
        {{ promptCount }} &#9998;
      </span>
      <span v-if="session.pid" class="footer-pid">PID: {{ session.pid }}</span>
    </div>
  </div>
</template>

<style scoped>
.terminal-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 3px 10px;
  background: var(--tc-bg-header);
  border-top: 1px solid var(--tc-border-color);
  flex-shrink: 0;
  font-size: var(--tc-font-size-xs);
  color: var(--tc-text-muted);
  height: 24px;
}

.footer-left {
  display: flex;
  align-items: center;
  gap: 6px;
}

.footer-right {
  display: flex;
  align-items: center;
  gap: 8px;
}

.footer-status {
  text-transform: lowercase;
}

.status-running {
  color: var(--tc-status-running);
}
.status-starting {
  color: var(--tc-status-starting);
}
.status-exited {
  color: var(--tc-status-exited);
}
.status-crashed {
  color: var(--tc-status-crashed);
}
.status-killed {
  color: var(--tc-status-killed);
}

.footer-dim {
  color: var(--tc-text-muted);
  opacity: 0.5;
}

.footer-prompt-count {
  color: var(--tc-accent);
  cursor: pointer;
}

.footer-prompt-count:hover {
  text-decoration: underline;
}

.footer-pid {
  font-family: var(--tc-font-mono);
  opacity: 0.6;
}
</style>
