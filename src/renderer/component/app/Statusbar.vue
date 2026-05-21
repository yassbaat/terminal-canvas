<script setup lang="ts">
import { computed } from "vue";
import { useTerminalStore } from "@renderer/store/terminal";
import { useWorkspaceStore } from "@renderer/store/workspace";

const terminalStore = useTerminalStore();
const workspaceStore = useWorkspaceStore();

const runningCount = computed(() => terminalStore.runningSessions.length);
const totalCount = computed(() => terminalStore.sessionCount);
const workspaceName = computed(() => workspaceStore.currentWorkspace?.name || "Untitled");
</script>

<template>
  <div class="statusbar">
    <div class="statusbar-left">
      <span class="status-item status-workspace">{{ workspaceName }}</span>
      <span class="status-divider" />
      <span class="status-item" :class="{ 'status-active': runningCount > 0 }">
        {{ runningCount }} / {{ totalCount }} terminals
      </span>
    </div>
    <div class="statusbar-right">
      <span class="status-item status-hint">
        Ctrl+N New &bull; Ctrl+S Save &bull; Ctrl+G Group &bull; Esc Unfocus
      </span>
    </div>
  </div>
</template>

<style scoped>
.statusbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 12px;
  height: 26px;
  background: var(--tc-bg-card);
  border-top: 1px solid var(--tc-border-color);
  font-size: var(--tc-font-size-xs);
  color: var(--tc-text-muted);
}

.statusbar-left {
  display: flex;
  align-items: center;
  gap: 8px;
}

.statusbar-right {
  display: flex;
  align-items: center;
}

.status-item {
  display: flex;
  align-items: center;
  gap: 4px;
}

.status-workspace {
  font-weight: 600;
  color: var(--tc-text-secondary);
}

.status-active {
  color: var(--tc-status-running);
}

.status-divider {
  width: 1px;
  height: 14px;
  background: var(--tc-border-color);
}

.status-hint {
  opacity: 0.5;
  font-family: var(--tc-font-mono);
}
</style>
