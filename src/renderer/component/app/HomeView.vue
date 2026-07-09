<script setup lang="ts">
import { computed, nextTick, ref } from "vue";
import { useWorkspaceStore } from "@renderer/store/workspace";
import { useUIStore } from "@renderer/store/ui";
import { Folder, FolderPlus, Pencil, Trash2, TerminalSquare } from "lucide-vue-next";

const workspaceStore = useWorkspaceStore();
const uiStore = useUIStore();

const sortedWorkspaces = computed(() =>
  [...workspaceStore.workspaceList].sort((a, b) => b.updatedAt - a.updatedAt)
);

const renamingId = ref<string | null>(null);
const renameValue = ref("");
const renameInputRefs = ref<Record<string, HTMLInputElement | null>>({});

function relativeTime(ts: number): string {
  const diffMs = Date.now() - ts;
  const minutes = Math.round(diffMs / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(ts).toLocaleDateString();
}

async function openWorkspace(id: string): Promise<void> {
  await workspaceStore.switchToWorkspace(id);
  uiStore.hideHome();
}

async function createWorkspace(): Promise<void> {
  workspaceStore.createNewWorkspace();
  uiStore.hideHome();
}

async function deleteWorkspace(id: string, name: string): Promise<void> {
  // The "Workspaces" toolbar button saves-and-parks the active workspace
  // here without clearing it -- its terminals are still actually running.
  // Deleting that one's file out from under it would orphan them.
  if (workspaceStore.currentWorkspace?.id === id) {
    alert(`"${name}" is your currently open workspace -- close or switch away from it before deleting.`);
    return;
  }
  if (!confirm(`Delete workspace "${name}"? This can't be undone.`)) return;
  await workspaceStore.deleteWorkspace(id);
}

function startRename(id: string, currentName: string): void {
  renamingId.value = id;
  renameValue.value = currentName;
  nextTick(() => {
    renameInputRefs.value[id]?.focus();
    renameInputRefs.value[id]?.select();
  });
}

async function commitRename(id: string): Promise<void> {
  if (renamingId.value !== id) return;
  renamingId.value = null;
  const trimmed = renameValue.value.trim();
  if (trimmed) {
    await workspaceStore.renameWorkspace(id, trimmed);
  }
}

function cancelRename(): void {
  renamingId.value = null;
}
</script>

<template>
  <div class="home-view">
    <div class="home-content">
      <div class="home-header">
        <div class="home-title-group">
          <h1 class="home-title">Terminal Canvas</h1>
          <p class="home-subtitle">Pick up a saved workspace, or start a new one.</p>
        </div>
        <button class="tc-btn tc-btn-primary home-new-btn" @click="createWorkspace">
          <FolderPlus :size="15" />
          New Workspace
        </button>
      </div>

      <div v-if="sortedWorkspaces.length === 0" class="home-empty">
        <Folder :size="32" />
        <p>No saved workspaces yet.</p>
        <button class="tc-btn tc-btn-primary" @click="createWorkspace">Create your first workspace</button>
      </div>

      <div v-else class="workspace-grid">
        <div
          v-for="ws in sortedWorkspaces"
          :key="ws.id"
          class="workspace-card"
          @click="openWorkspace(ws.id)"
        >
          <div class="workspace-card-icon">
            <Folder :size="28" />
          </div>
          <div class="workspace-card-body">
            <input
              v-if="renamingId === ws.id"
              :ref="(el) => (renameInputRefs[ws.id] = el as HTMLInputElement)"
              v-model="renameValue"
              class="workspace-rename-input"
              @click.stop
              @blur="commitRename(ws.id)"
              @keydown.enter="commitRename(ws.id)"
              @keydown.esc="cancelRename"
            />
            <span v-else class="workspace-card-name">{{ ws.name }}</span>
            <span class="workspace-card-meta">
              <TerminalSquare :size="11" />
              {{ ws.terminalCount }} terminal{{ ws.terminalCount === 1 ? "" : "s" }}
              &bull; {{ relativeTime(ws.updatedAt) }}
            </span>
          </div>
          <div class="workspace-card-actions">
            <button class="workspace-card-btn" title="Rename" @click.stop="startRename(ws.id, ws.name)">
              <Pencil :size="13" />
            </button>
            <button class="workspace-card-btn workspace-card-btn-danger" title="Delete" @click.stop="deleteWorkspace(ws.id, ws.name)">
              <Trash2 :size="13" />
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.home-view {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  overflow-y: auto;
  background: var(--tc-bg-primary);
  padding: 64px 24px;
}

.home-content {
  width: 100%;
  max-width: 880px;
}

.home-header {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 32px;
}

.home-title {
  font-size: 28px;
  font-weight: 700;
  color: var(--tc-text-primary);
  margin: 0 0 4px;
}

.home-subtitle {
  font-size: var(--tc-font-size-sm);
  color: var(--tc-text-muted);
  margin: 0;
}

.home-new-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  white-space: nowrap;
}

.home-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 80px 20px;
  color: var(--tc-text-muted);
  border: 1px dashed var(--tc-border-color);
  border-radius: var(--tc-border-radius);
}

.workspace-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 14px;
}

.workspace-card {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 16px;
  background: var(--tc-bg-card);
  border: 1px solid var(--tc-border-color);
  border-radius: var(--tc-border-radius);
  cursor: pointer;
  transition: border-color var(--tc-transition-fast), box-shadow var(--tc-transition-fast), transform var(--tc-transition-fast);
}

.workspace-card:hover {
  border-color: var(--tc-accent);
  box-shadow: var(--tc-shadow-md);
  transform: translateY(-1px);
}

.workspace-card-icon {
  color: var(--tc-accent);
}

.workspace-card-body {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.workspace-card-name {
  font-size: var(--tc-font-size-md);
  font-weight: 600;
  color: var(--tc-text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.workspace-rename-input {
  font-size: var(--tc-font-size-md);
  font-weight: 600;
  background: var(--tc-bg-secondary);
  border: 1px solid var(--tc-accent);
  border-radius: var(--tc-border-radius-sm);
  color: var(--tc-text-primary);
  padding: 2px 6px;
  outline: none;
  width: 100%;
}

.workspace-card-meta {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: var(--tc-font-size-xs);
  color: var(--tc-text-muted);
}

.workspace-card-actions {
  position: absolute;
  top: 10px;
  right: 10px;
  display: flex;
  gap: 2px;
  opacity: 0;
  transition: opacity var(--tc-transition-fast);
}

.workspace-card:hover .workspace-card-actions {
  opacity: 1;
}

.workspace-card-btn {
  width: 24px;
  height: 24px;
  border: none;
  background: var(--tc-bg-secondary);
  color: var(--tc-text-muted);
  cursor: pointer;
  border-radius: var(--tc-border-radius-sm);
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all var(--tc-transition-fast);
}

.workspace-card-btn:hover {
  background: var(--tc-bg-hover);
  color: var(--tc-text-primary);
}

.workspace-card-btn-danger:hover {
  color: var(--tc-error);
}
</style>
