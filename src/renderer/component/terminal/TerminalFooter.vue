<script setup lang="ts">
import { computed } from "vue";
import type { TerminalSession } from "@renderer/type/terminal";
import { usePromptStore } from "@renderer/store/prompt";
import { NotebookPen, FolderTree } from "lucide-vue-next";

const props = defineProps<{
  session: TerminalSession;
  memoryVisible?: boolean;
  filesVisible?: boolean;
}>();

const emit = defineEmits<{
  (e: "toggleMemory"): void;
  (e: "toggleFiles"): void;
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
        class="footer-prompt-count"
        :class="{ 'footer-prompt-count-active': filesVisible }"
        :title="filesVisible ? 'Hide file explorer' : 'Show file explorer'"
        @click="emit('toggleFiles')"
      >
        <FolderTree :size="11" />
      </span>
      <span
        class="footer-prompt-count"
        :class="{ 'footer-prompt-count-active': memoryVisible }"
        :title="memoryVisible ? 'Hide Agent Memory' : `Show Agent Memory (${promptCount} entries)`"
        @click="emit('toggleMemory')"
      >
        {{ promptCount }} <NotebookPen :size="11" />
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
  display: inline-flex;
  align-items: center;
  gap: 3px;
  color: var(--tc-accent);
  cursor: pointer;
}

.footer-prompt-count:hover {
  text-decoration: underline;
}

.footer-prompt-count-active {
  color: var(--tc-text-primary);
  font-weight: 600;
}

.footer-pid {
  font-family: var(--tc-font-mono);
  opacity: 0.6;
}
</style>
