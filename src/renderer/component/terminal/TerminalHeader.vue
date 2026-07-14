<script setup lang="ts">
import { computed, ref, nextTick } from "vue";
import type { TerminalSession } from "@renderer/type/terminal";
import { useTerminalStore } from "@renderer/store/terminal";
import { useUIStore } from "@renderer/store/ui";
import { useWorkspaceStore } from "@renderer/store/workspace";
import { shortenCwd } from "@renderer/util/path";
import { AGENT_META } from "@renderer/util/agents";
import { Bell, BellOff, Pencil, X, FolderOpen } from "lucide-vue-next";

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
const uiStore = useUIStore();
const workspaceStore = useWorkspaceStore();

const displayName = computed(
  () => props.session.manualName || props.session.autoName || props.session.name
);

const agentMeta = computed(() =>
  props.session.activeAgent ? AGENT_META[props.session.activeAgent] : null
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

// `shortCwd` already ends with the project name (it's the last path segment),
// so it alone is the correct breadcrumb. `repoRoot` is reserved for future
// repo-aware naming but isn't populated yet, so don't branch on it here.
const projectLabel = computed(() => shortCwd.value);

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

/**
 * Double-clicking the name renames it -- but only when zoomed in enough to be
 * interacting with the terminal for real. When zoomed out, a double-click is
 * claimed by the canvas to zoom/focus this terminal (see WorkspaceCanvas's
 * handleNodeDoubleClick), so don't also pop a rename box no one can see.
 */
function onNameDblClick() {
  if (workspaceStore.viewport.zoom < 0.75) return;
  startRename();
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

function toggleOffDuty() {
  terminalStore.setIdleDetectionEnabled(props.session.id, !props.session.idleDetectionEnabled);
}
</script>

<template>
  <div class="terminal-header" :class="`header-style-${uiStore.headerStyle}`">
    <div class="header-main">
      <div class="header-status-dot" :style="{ backgroundColor: statusColor }" />
      <div
        v-if="agentMeta"
        class="header-agent-glyph"
        :style="{ color: agentMeta.color, borderColor: agentMeta.color }"
        :title="`${agentMeta.label} is running in this terminal`"
      >
        <component :is="agentMeta.icon" :size="11" />
      </div>
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
          <span v-else class="header-name" @dblclick="onNameDblClick">
            {{ displayName }}
          </span>
          <span
            v-if="agentMeta && uiStore.headerStyle !== 'minimal'"
            class="header-agent-pill"
            :style="{ color: agentMeta.color, borderColor: agentMeta.color }"
          >
            {{ agentMeta.label }}
          </span>
          <span v-if="uiStore.headerStyle === 'comfortable'" class="header-shell-badge">{{ session.shellName }}</span>
        </div>
        <div v-if="uiStore.headerStyle !== 'minimal'" class="header-cwd" :title="session.cwd">
          {{ projectLabel }}
        </div>
      </div>
    </div>
    <div class="header-actions">
      <button
        v-if="uiStore.headerStyle !== 'minimal'"
        class="header-btn"
        title="Open folder in file manager"
        @click="openCwd"
      >
        <FolderOpen class="header-btn-icon" :size="12" />
      </button>
      <button
        class="header-btn"
        :class="{ 'header-btn-active': !session.idleDetectionEnabled }"
        :title="session.idleDetectionEnabled
          ? 'On duty — will flag when idle or it rings the bell'
          : 'Off duty — idle/bell attention is disabled for this terminal'"
        @click="toggleOffDuty"
      >
        <Bell v-if="session.idleDetectionEnabled" class="header-btn-icon" :size="12" />
        <BellOff v-else class="header-btn-icon" :size="12" />
      </button>
      <button class="header-btn" title="Rename" @click="startRename">
        <Pencil class="header-btn-icon" :size="12" />
      </button>
      <button
        class="header-btn header-btn-close"
        title="Close"
        @click="emit('kill')"
      >
        <X class="close-icon" :size="10" />
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

.header-agent-glyph {
  width: 18px;
  height: 18px;
  flex-shrink: 0;
  border: 1px solid;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
  line-height: 1;
  opacity: 0.9;
}

.header-agent-pill {
  font-size: var(--tc-font-size-xs);
  font-weight: 600;
  border: 1px solid;
  background: transparent;
  padding: 1px 6px;
  border-radius: 4px;
  white-space: nowrap;
  flex-shrink: 0;
  opacity: 0.9;
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
  font-family: var(--tc-font-mono);
  /* Plain label -- use the folder-icon button in header-actions to open it. */
  user-select: text;
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
}

.header-btn {
  width: 26px;
  height: 26px;
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

.header-btn-active {
  color: var(--tc-warning);
  opacity: 0.85;
}

.header-btn-close {
  width: 18px;
  height: 18px;
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

/* ─── Header style variants (Settings → General → Terminal Header Style) ─── */

.header-style-compact {
  padding: 5px 8px;
  min-height: 32px;
}

.header-style-compact .header-info {
  flex-direction: row;
  align-items: baseline;
  gap: 8px;
}

.header-style-compact .header-cwd {
  font-size: 10px;
}

.header-style-minimal {
  padding: 3px 8px;
  min-height: 24px;
}

.header-style-minimal .header-name {
  font-size: 11px;
}

.header-style-minimal .header-status-dot {
  width: 6px;
  height: 6px;
}

.header-style-minimal .header-agent-glyph {
  width: 14px;
  height: 14px;
}

.header-style-minimal .header-btn {
  width: 18px;
  height: 18px;
}
</style>
