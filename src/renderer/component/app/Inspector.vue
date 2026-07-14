<script setup lang="ts">
import { computed, ref } from "vue";
import { useTerminalStore } from "@renderer/store/terminal";
import { usePromptStore } from "@renderer/store/prompt";
import { useUIStore } from "@renderer/store/ui";
import { formatDateTime } from "@renderer/util/format";
import type { PromptEntry } from "@renderer/type/prompt";
import PromptItem from "@renderer/component/terminal/PromptItem.vue";
import { useResizeHandle } from "@renderer/composable/useResizeHandle";
import { PanelRightClose } from "lucide-vue-next";

const terminalStore = useTerminalStore();
const promptStore = usePromptStore();
const uiStore = useUIStore();

const { startResize } = useResizeHandle(
  () => uiStore.inspectorWidth,
  (w) => uiStore.setInspectorWidth(w),
  "left"
);

const session = computed(() => terminalStore.focusedSession);
const activeTab = computed({
  get: () => uiStore.inspectorTab,
  set: (v) => { uiStore.inspectorTab = v; },
});

const memorySearch = ref("");
const memoryPrompts = computed(() => {
  const terminalId = session.value?.id;
  if (!terminalId) return [] as PromptEntry[];
  let list = promptStore.getPromptsForTerminal(terminalId);
  if (memorySearch.value) {
    const q = memorySearch.value.toLowerCase();
    list = list.filter((p) => p.text.toLowerCase().includes(q));
  }
  return list;
});

// Most-recently-submitted entry shown -- highlighted larger/bolder.
const latestMemoryId = computed(() => {
  const active = memoryPrompts.value.filter((p) => p.status !== "deleted");
  if (active.length === 0) return null;
  return [...active].sort((a, b) => b.submittedAt - a.submittedAt)[0].id;
});

function handleMemoryResend(promptId: string) {
  const terminalId = session.value?.id;
  if (terminalId) promptStore.resendPrompt(terminalId, promptId);
}

function handleMemoryDelete(promptId: string) {
  const terminalId = session.value?.id;
  if (terminalId) promptStore.deletePrompt(terminalId, promptId);
}

function handleMemoryPin(promptId: string) {
  const terminalId = session.value?.id;
  if (terminalId) promptStore.pinPrompt(terminalId, promptId);
}

function renameSession() {
  if (!session.value) return;
  const name = prompt("New name:", session.value.name);
  if (name) {
    terminalStore.updateSessionName(session.value.id, name);
  }
}

async function autoName() {
  if (!session.value) return;
  try {
    await window.api.groq.renameTerminal(session.value.id);
  } catch {
    // Fallback handled in main
  }
}

function copyCwd() {
  if (!session.value) return;
  navigator.clipboard.writeText(session.value.cwd);
}

function openCwd() {
  if (!session.value) return;
  window.api.terminal.openCwdInExplorer(session.value.id);
}

function copyPromptText(text: string) {
  navigator.clipboard.writeText(text);
}
</script>

<template>
  <div class="inspector">
    <div class="inspector-tabs">
      <button 
        class="inspector-tab" 
        :class="{ active: activeTab === 'terminal' }"
        @click="activeTab = 'terminal'"
      >
        Terminal
      </button>
      <button
        class="inspector-tab"
        :class="{ active: activeTab === 'prompt' }"
        @click="activeTab = 'prompt'"
      >
        Memory
      </button>
      <button
        class="inspector-collapse-btn"
        title="Collapse inspector"
        @click="uiStore.toggleInspector()"
      >
        <PanelRightClose :size="15" />
      </button>
    </div>
    
    <div class="inspector-content">
      <!-- Terminal tab -->
      <div v-if="activeTab === 'terminal'" class="inspector-panel">
        <div v-if="!session" class="inspector-empty">
          Select a terminal to inspect.
        </div>
        <div v-else class="inspector-details">
          <div class="detail-section">
            <h4 class="detail-heading">Identity</h4>
            <div class="detail-row">
              <span class="detail-label">Name</span>
              <span class="detail-value">{{ session.name }}</span>
              <button class="detail-action" @click="renameSession">Rename</button>
              <button class="detail-action" @click="autoName">Auto</button>
            </div>
            <div class="detail-row">
              <span class="detail-label">Shell</span>
              <span class="detail-value">{{ session.shellName }}</span>
            </div>
            <div class="detail-row">
              <span class="detail-label">Status</span>
              <span class="detail-value" :class="`status-${session.status}`">{{ session.status }}</span>
            </div>
            <div class="detail-row">
              <span class="detail-label">PID</span>
              <span class="detail-value">{{ session.pid || "-" }}</span>
            </div>
          </div>
          
          <div class="detail-section">
            <h4 class="detail-heading">Location</h4>
            <div class="detail-row">
              <span class="detail-label">CWD</span>
              <span class="detail-value detail-cwd" :title="session.cwd">{{ session.cwd }}</span>
            </div>
            <div class="detail-row">
              <span class="detail-label">Project</span>
              <span class="detail-value">{{ session.projectName || "-" }}</span>
            </div>
            <div class="detail-actions">
              <button class="tc-btn tc-btn-sm" @click="copyCwd">Copy Path</button>
              <button class="tc-btn tc-btn-sm" @click="openCwd">Open Folder</button>
            </div>
          </div>
          
          <div class="detail-section">
            <h4 class="detail-heading">Session</h4>
            <div class="detail-row">
              <span class="detail-label">Created</span>
              <span class="detail-value">{{ formatDateTime(session.createdAt) }}</span>
            </div>
            <div class="detail-row">
              <span class="detail-label">Size</span>
              <span class="detail-value">{{ session.cols }}&times;{{ session.rows }}</span>
            </div>
            <div class="detail-row">
              <span class="detail-label">Prompts</span>
              <span class="detail-value">{{ session.promptCount }}</span>
            </div>
          </div>
          
          <div class="detail-section">
            <h4 class="detail-heading">Naming</h4>
            <div class="detail-row">
              <span class="detail-label">Auto</span>
              <span class="detail-value">{{ session.autoName || "-" }}</span>
            </div>
            <div class="detail-row">
              <span class="detail-label">Manual</span>
              <span class="detail-value">{{ session.manualName || "-" }}</span>
            </div>
            <div class="detail-row" v-if="session.naming.lastNameReason">
              <span class="detail-label">Reason</span>
              <span class="detail-value detail-reason">{{ session.naming.lastNameReason }}</span>
            </div>
          </div>
        </div>
      </div>
      
      <!-- Prompt tab -->
      <div v-else-if="activeTab === 'prompt'" class="inspector-panel">
        <div v-if="!session" class="inspector-empty">
          Select a terminal to view its Agent Memory.
        </div>
        <template v-else>
          <div class="memory-header">
            <span class="memory-count">{{ memoryPrompts.length }} prompt(s)</span>
            <input
              v-model="memorySearch"
              class="memory-search"
              placeholder="Search memory..."
              type="text"
            />
          </div>
          <div class="memory-list">
            <div v-if="memoryPrompts.length === 0" class="inspector-empty">
              No prompts yet.
            </div>
            <PromptItem
              v-for="prompt in memoryPrompts"
              :key="prompt.id"
              :prompt="prompt"
              :is-latest="prompt.id === latestMemoryId"
              @resend="handleMemoryResend"
              @delete="handleMemoryDelete"
              @pin="handleMemoryPin"
              @copy="copyPromptText"
            />
          </div>
        </template>
      </div>
    </div>
    <div class="inspector-resize-handle" @mousedown="startResize" />
  </div>
</template>

<style scoped>
.inspector {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--tc-bg-card);
  border-left: 1px solid var(--tc-border-color);
  overflow: hidden;
  position: relative;
}

.inspector-resize-handle {
  position: absolute;
  top: 0;
  /* Stays at left: 0 (not negative) -- .inspector has overflow: hidden, so
     anything sitting outside its box gets clipped and becomes unclickable. */
  left: 0;
  width: 12px;
  height: 100%;
  cursor: col-resize;
  z-index: 5;
}

.inspector-resize-handle:hover,
.inspector-resize-handle:active {
  background: var(--tc-accent);
  opacity: 0.5;
}

.inspector-tabs {
  display: flex;
  border-bottom: 1px solid var(--tc-border-color);
  flex-shrink: 0;
}

.inspector-collapse-btn {
  flex-shrink: 0;
  width: 34px;
  border: none;
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
  background: transparent;
  color: var(--tc-text-muted);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all var(--tc-transition-fast);
}

.inspector-collapse-btn:hover {
  color: var(--tc-text-primary);
  background: var(--tc-bg-hover);
}

.inspector-tab {
  flex: 1;
  padding: 10px 8px;
  border: none;
  background: transparent;
  color: var(--tc-text-muted);
  font-size: var(--tc-font-size-xs);
  cursor: pointer;
  transition: all var(--tc-transition-fast);
  font-family: var(--tc-font-sans);
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.3px;
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
}

.inspector-tab:hover {
  color: var(--tc-text-secondary);
  background: var(--tc-bg-hover);
}

.inspector-tab.active {
  color: var(--tc-accent);
  border-bottom-color: var(--tc-accent);
  background: var(--tc-accent-soft);
}

.inspector-content {
  flex: 1;
  overflow-y: auto;
  padding: 12px;
}

.inspector-panel {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.inspector-empty {
  padding: 32px 12px;
  text-align: center;
  font-size: var(--tc-font-size-sm);
  color: var(--tc-text-muted);
}

.detail-section {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.detail-heading {
  font-size: var(--tc-font-size-xs);
  color: var(--tc-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  font-weight: 600;
  margin-bottom: 4px;
}

.detail-row {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: var(--tc-font-size-sm);
  padding: 2px 0;
}

.detail-label {
  color: var(--tc-text-muted);
  min-width: 55px;
  flex-shrink: 0;
}

.detail-value {
  color: var(--tc-text-primary);
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.detail-cwd {
  font-family: var(--tc-font-mono);
  font-size: var(--tc-font-size-xs);
}

.detail-reason {
  font-size: var(--tc-font-size-xs);
  color: var(--tc-text-secondary);
  white-space: normal;
  line-height: var(--tc-line-height-tight);
}

.status-running { color: var(--tc-status-running); }
.status-starting { color: var(--tc-status-starting); }
.status-exited { color: var(--tc-status-exited); }
.status-crashed { color: var(--tc-status-crashed); }
.status-killed { color: var(--tc-status-killed); }

.detail-action {
  padding: 2px 8px;
  border: 1px solid var(--tc-border-color);
  background: var(--tc-bg-secondary);
  color: var(--tc-text-secondary);
  font-size: var(--tc-font-size-xs);
  cursor: pointer;
  border-radius: var(--tc-border-radius-sm);
  font-family: var(--tc-font-sans);
}

.detail-action:hover {
  border-color: var(--tc-accent);
  color: var(--tc-accent);
}

.detail-actions {
  display: flex;
  gap: 6px;
  margin-top: 4px;
}

.prompt-detail-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.prompt-detail-kind {
  font-size: var(--tc-font-size-xs);
  font-weight: 600;
  color: var(--tc-accent);
  text-transform: uppercase;
}

.prompt-detail-time {
  font-size: var(--tc-font-size-xs);
  color: var(--tc-text-muted);
}

.prompt-detail-text {
  background: var(--tc-bg-secondary);
  border: 1px solid var(--tc-border-color);
  border-radius: var(--tc-border-radius-sm);
  padding: 10px;
  font-family: var(--tc-font-mono);
  font-size: var(--tc-font-size-sm);
  color: var(--tc-text-primary);
  white-space: pre-wrap;
  word-break: break-word;
  line-height: var(--tc-line-height-normal);
  max-height: 300px;
  overflow-y: auto;
}

.prompt-detail-meta {
  font-size: var(--tc-font-size-xs);
  color: var(--tc-text-muted);
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.prompt-detail-actions {
  display: flex;
  gap: 6px;
}

.memory-header {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 4px;
}

.memory-count {
  font-size: var(--tc-font-size-xs);
  color: var(--tc-text-muted);
}

.memory-search {
  width: 100%;
  padding: 4px 8px;
  border: 1px solid var(--tc-border-color);
  border-radius: var(--tc-border-radius-sm);
  background: var(--tc-bg-secondary);
  color: var(--tc-text-primary);
  font-size: var(--tc-font-size-xs);
  outline: none;
}

.memory-search:focus {
  border-color: var(--tc-accent);
}

.memory-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
</style>
