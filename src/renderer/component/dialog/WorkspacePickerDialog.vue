<script setup lang="ts">
import { ref, onMounted } from "vue";
import { useWorkspaceStore } from "@renderer/store/workspace";
import { useUIStore } from "@renderer/store/ui";

const workspaceStore = useWorkspaceStore();
const uiStore = useUIStore();

const loading = ref(false);
const deletingId = ref<string | null>(null);

onMounted(() => {
  workspaceStore.loadWorkspaceList();
});

async function load(id: string) {
  loading.value = true;
  try {
    await workspaceStore.loadWorkspace(id);
    uiStore.closeWorkspacePicker();
    uiStore.showToast("Workspace loaded");
  } catch (err) {
    uiStore.showToast("Failed to load workspace");
    console.error("[WorkspacePicker] load failed", err);
  } finally {
    loading.value = false;
  }
}

async function remove(id: string) {
  deletingId.value = id;
  try {
    await workspaceStore.deleteWorkspace(id);
  } catch (err) {
    uiStore.showToast("Failed to delete workspace");
    console.error("[WorkspacePicker] delete failed", err);
  } finally {
    deletingId.value = null;
  }
}

function createNew() {
  workspaceStore.createNewWorkspace();
  uiStore.closeWorkspacePicker();
  uiStore.showToast("New workspace created");
}

function formatDate(ts: number): string {
  return new Date(ts).toLocaleString();
}
</script>

<template>
  <div v-if="uiStore.workspacePickerOpen" class="dialog-overlay" @click="uiStore.closeWorkspacePicker">
    <div class="dialog" @click.stop>
      <div class="dialog-header">
        <h3>Open Workspace</h3>
        <button class="dialog-close" @click="uiStore.closeWorkspacePicker">&times;</button>
      </div>

      <div class="dialog-body">
        <div v-if="workspaceStore.workspaceList.length === 0" class="empty-state">
          <p>No saved workspaces yet.</p>
          <button class="tc-btn tc-btn-primary" @click="createNew">Create New Workspace</button>
        </div>

        <div v-else class="workspace-list">
          <div
            v-for="ws in workspaceStore.workspaceList"
            :key="ws.id"
            class="workspace-card"
          >
            <div class="workspace-info">
              <div class="workspace-name">{{ ws.name }}</div>
              <div class="workspace-meta">
                <span>{{ ws.terminalCount }} terminal{{ ws.terminalCount === 1 ? '' : 's' }}</span>
                <span>&middot;</span>
                <span>{{ ws.groupCount }} group{{ ws.groupCount === 1 ? '' : 's' }}</span>
                <span>&middot;</span>
                <span>{{ formatDate(ws.updatedAt) }}</span>
              </div>
            </div>
            <div class="workspace-actions">
              <button
                class="tc-btn tc-btn-primary"
                :disabled="loading"
                @click="load(ws.id)"
              >
                {{ loading ? "Loading..." : "Load" }}
              </button>
              <button
                class="tc-btn delete-btn"
                :disabled="deletingId === ws.id"
                @click="remove(ws.id)"
              >
                {{ deletingId === ws.id ? "..." : "Delete" }}
              </button>
            </div>
          </div>

          <div class="new-workspace-row">
            <button class="tc-btn tc-btn-primary" @click="createNew">+ New Workspace</button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.dialog-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: var(--tc-z-modal);
}

.dialog {
  background: var(--tc-bg-card);
  border: 1px solid var(--tc-border-color);
  border-radius: var(--tc-border-radius);
  min-width: 520px;
  max-width: 90vw;
  max-height: 85vh;
  display: flex;
  flex-direction: column;
  box-shadow: var(--tc-shadow-lg);
}

.dialog-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 18px;
  border-bottom: 1px solid var(--tc-border-color);
  flex-shrink: 0;
}

.dialog-header h3 {
  font-size: var(--tc-font-size-md);
  font-weight: 600;
  color: var(--tc-text-primary);
}

.dialog-close {
  width: 28px;
  height: 28px;
  border: none;
  background: transparent;
  color: var(--tc-text-muted);
  cursor: pointer;
  border-radius: var(--tc-border-radius-sm);
  font-size: 18px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.dialog-close:hover {
  background: var(--tc-bg-hover);
  color: var(--tc-text-primary);
}

.dialog-body {
  padding: 18px;
  overflow-y: auto;
  flex: 1;
}

.empty-state {
  text-align: center;
  padding: 32px;
  color: var(--tc-text-secondary);
}

.empty-state p {
  margin-bottom: 16px;
}

.workspace-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.workspace-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 14px;
  border: 1px solid var(--tc-border-color);
  border-radius: var(--tc-border-radius-sm);
  background: var(--tc-bg-secondary);
  transition: border-color var(--tc-transition-fast);
}

.workspace-card:hover {
  border-color: var(--tc-border-focus);
}

.workspace-name {
  font-weight: 600;
  color: var(--tc-text-primary);
  font-size: var(--tc-font-size-sm);
}

.workspace-meta {
  margin-top: 4px;
  font-size: var(--tc-font-size-xs);
  color: var(--tc-text-muted);
  display: flex;
  gap: 6px;
}

.workspace-actions {
  display: flex;
  gap: 6px;
}

.new-workspace-row {
  margin-top: 8px;
  padding-top: 12px;
  border-top: 1px solid var(--tc-border-color);
}

.tc-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 6px 12px;
  border: 1px solid var(--tc-border-color);
  border-radius: var(--tc-border-radius-sm);
  background: var(--tc-bg-card);
  color: var(--tc-text-secondary);
  font-size: var(--tc-font-size-sm);
  cursor: pointer;
  transition: all var(--tc-transition-fast);
  font-family: var(--tc-font-sans);
}

.tc-btn:hover {
  background: var(--tc-bg-hover);
  color: var(--tc-text-primary);
  border-color: var(--tc-border-focus);
}

.tc-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.tc-btn-primary {
  background: var(--tc-accent);
  color: white;
  border-color: var(--tc-accent);
}

.tc-btn-primary:hover {
  background: var(--tc-accent-hover);
  border-color: var(--tc-accent-hover);
}

.delete-btn {
  border-color: transparent;
  background: transparent;
  color: var(--tc-text-muted);
}

.delete-btn:hover {
  color: var(--tc-error);
  background: rgba(233, 69, 96, 0.08);
}
</style>
