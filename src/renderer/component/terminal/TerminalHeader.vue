<script setup lang="ts">
import { computed, ref, nextTick } from "vue";
import type { TerminalSession } from "@renderer/type/terminal";
import { useTerminalStore } from "@renderer/store/terminal";
import { shortenCwd } from "@renderer/util/path";

const props = defineProps<{
  session: TerminalSession;
}>();

const emit = defineEmits<{
  (e: "rename", name: string): void;
  (e: "kill"): void;
  (e: "restart"): void;
  (e: "clear"): void;
}>();

const terminalStore = useTerminalStore();

const displayName = computed(
  () => props.session.manualName || props.session.autoName || props.session.name
);

const statusColor = computed(() => {
  switch (props.session.status) {
    case "running":
      return "var(--tc-status-running)";
    case "starting":
      return "var(--tc-status-starting)";
    case "exited":
      return "var(--tc-status-exited)";
    case "crashed":
      return "var(--tc-status-crashed)";
    case "killed":
      return "var(--tc-status-killed)";
    default:
      return "var(--tc-text-muted)";
  }
});

const shortCwd = computed(() => shortenCwd(props.session.cwd, 50));

const projectLabel = computed(() => {
  if (props.session.projectName) {
    return props.session.cwd.startsWith(props.session.repoRoot || "")
      ? `${props.session.projectName} ${shortCwd.value.slice(props.session.projectName.length)}`
      : props.session.projectName;
  }
  return shortCwd.value;
});

const isRenaming = ref(false);
const renameValue = ref("");
const renameInputRef = ref<HTMLInputElement | null>(null);

function startRename() {
  isRenaming.value = true;
  renameValue.value = displayName.value;
  nextTick(() => {
    renameInputRef.value?.focus();
    renameInputRef.value?.select();
  });
}

function commitRename() {
  if (renameValue.value.trim()) {
    terminalStore.updateSessionName(props.session.id, renameValue.value.trim());
    emit("rename", renameValue.value.trim());
  }
  isRenaming.value = false;
}

function cancelRename() {
  isRenaming.value = false;
}

function openCwd() {
  window.api.terminal.openCwdInExplorer(props.session.id);
}
</script>

<template>
  <div class="terminal-header">
    <div class="header-main">
      <div class="header-status-dot" :style="{ backgroundColor: statusColor }" />
      <div class="header-info">
        <div class="header-name-row">
          <input
            v-if="isRenaming"
            ref="renameInputRef"
            v-model="renameValue"
            class="header-name-input"
            @blur="commitRename"
            @keydown.enter="commitRename"
            @keydown.esc="cancelRename"
          />
          <span v-else class="header-name" @dblclick="startRename">
            {{ displayName }}
          </span>
          <span class="header-shell-badge">{{ session.shellName }}</span>
        </div>
        <div class="header-cwd" :title="session.cwd" @click="openCwd">
          {{ projectLabel }}
        </div>
      </div>
    </div>
    <div class="header-actions">
      <button class="header-btn" title="Rename" @click="startRename">
        <span class="header-btn-icon">R</span>
      </button>
      <button
        class="header-btn header-btn-close"
        title="Close"
        @click="emit('kill')"
      >
        <span class="close-icon">&#10005;</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.terminal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 10px;
  background: var(--tc-bg-header);
  border-bottom: 1px solid var(--tc-border-color);
  flex-shrink: 0;
  min-height: 44px;
  cursor: grab;
}

.header-main {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  min-width: 0;
}

.header-status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
  box-shadow: 0 0 4px currentColor;
}

.header-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  flex: 1;
}

.header-name-row {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.header-name {
  font-size: var(--tc-font-size-sm);
  font-weight: 600;
  color: var(--tc-text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  cursor: text;
}

.header-name:hover {
  text-decoration: underline;
  text-decoration-color: var(--tc-accent);
}

.header-name-input {
  font-size: var(--tc-font-size-sm);
  font-weight: 600;
  background: var(--tc-bg-secondary);
  border: 1px solid var(--tc-accent);
  border-radius: var(--tc-border-radius-sm);
  color: var(--tc-text-primary);
  padding: 2px 6px;
  outline: none;
  width: 150px;
}

.header-shell-badge {
  font-size: var(--tc-font-size-xs);
  color: var(--tc-text-muted);
  background: var(--tc-bg-secondary);
  padding: 1px 6px;
  border-radius: 4px;
  white-space: nowrap;
  flex-shrink: 0;
}

.header-cwd {
  font-size: var(--tc-font-size-xs);
  color: var(--tc-text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  cursor: pointer;
  font-family: var(--tc-font-mono);
}

.header-cwd:hover {
  color: var(--tc-text-secondary);
  text-decoration: underline;
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
}

.header-btn {
  width: 22px;
  height: 22px;
  border: none;
  background: transparent;
  color: var(--tc-text-muted);
  cursor: pointer;
  border-radius: var(--tc-border-radius-sm);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
  transition: all var(--tc-transition-fast);
}

.header-btn:hover {
  background: var(--tc-bg-hover);
  color: var(--tc-text-primary);
}

.header-btn-close {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: #ff5f56;
  color: rgba(77, 0, 0, 0.7);
  font-size: 9px;
  font-weight: 700;
  line-height: 1;
  padding: 0;
  opacity: 0.85;
  transition: opacity 0.15s ease;
}

.header-btn-close:hover {
  opacity: 1;
  background: #ff5f56;
  color: rgba(77, 0, 0, 0.9);
}

.close-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
}
</style>
