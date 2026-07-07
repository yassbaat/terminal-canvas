<script setup lang="ts">
import { computed } from "vue";
import { useVueFlow } from "@vue-flow/core";
import { useTerminalStore } from "@renderer/store/terminal";
import { useWorkspaceStore } from "@renderer/store/workspace";
import { useUIStore } from "@renderer/store/ui";

const terminalStore = useTerminalStore();
const workspaceStore = useWorkspaceStore();
const uiStore = useUIStore();
// Same id as <VueFlow id="canvas"> in WorkspaceCanvas.vue -- useVueFlow looks
// up a shared store by id, so this connects to the real canvas instance
// even though Toolbar isn't a descendant of it.
const { setCenter, getViewport } = useVueFlow("canvas");

const attentionCount = computed(() => terminalStore.attentionSessions.length);

/**
 * Jump to the terminal that most recently needed attention. Focusing it
 * clears its flag (see terminalStore.setFocused), so the NEXT click
 * naturally advances to whichever is now most recent among the rest --
 * no separate cursor/index to manage.
 */
function jumpToNextAttention(): void {
  const next = terminalStore.attentionSessions[0];
  if (!next) {
    uiStore.showToast("No terminals need attention");
    return;
  }
  const width = next.node.width || 640;
  const height = next.node.height || 400;
  const centerX = next.node.x + width / 2;
  const centerY = next.node.y + height / 2;
  setCenter(centerX, centerY, { zoom: Math.max(getViewport().zoom, 0.75), duration: 400 });
  terminalStore.setFocused(next.id);
}

const themeIcon = computed(() => {
  if (uiStore.themePreference === "system") return "\u{1F5A5}"; // desktop
  return uiStore.themePreference === "dark" ? "\u{1F319}" : "☀️"; // moon / sun
});
const themeLabel = computed(() => {
  const pref = uiStore.themePreference;
  return pref.charAt(0).toUpperCase() + pref.slice(1);
});
const themeTitle = computed(
  () => `Theme: ${themeLabel.value} (click to cycle Dark → Light → System)`
);

async function quickNewTerminal() {
  const shellId =
    terminalStore.sessionDefaultShellId ||
    workspaceStore.settings.defaultShellId;
  const shell = terminalStore.shells.find((s) => s.id === shellId);

  if (shell) {
    await terminalStore.createSession({
      shellId: shell.id,
      cols: 80,
      rows: 24,
    });
  } else {
    uiStore.openNewTerminalDialog();
  }
}

async function openFolder() {
  if (typeof window.api === "undefined") return;
  const result = await window.api.dialog.showOpenDialog({
    title: "Open Folder in Terminal Canvas",
    properties: ["openDirectory"],
  });
  if (result.canceled || result.filePaths.length === 0) return;

  const dir = result.filePaths[0];
  const shellId =
    terminalStore.sessionDefaultShellId ||
    workspaceStore.settings.defaultShellId;
  const shell = terminalStore.shells.find((s) => s.id === shellId);

  if (!shell) {
    uiStore.showToast("No shell available");
    return;
  }
  await terminalStore.createSession({
    shellId: shell.id,
    cols: 80,
    rows: 24,
    cwd: dir,
    viewport: workspaceStore.viewport,
    groups: workspaceStore.groups,
  });
  uiStore.showToast(`Opened folder: ${dir}`);
}

async function saveWorkspace() {
  await workspaceStore.saveCurrentWorkspace();
  uiStore.showToast("Workspace saved");
}

async function groupSelected() {
  const group = await workspaceStore.groupSelectedTerminals();
  if (group) {
    uiStore.showToast(`Grouped ${group.terminalIds.length} terminal(s)`);
  } else {
    uiStore.showToast("No terminals selected");
  }
}

function addStickyNote() {
  workspaceStore.createStickyNote();
  uiStore.showToast("Sticky note added");
}

function openSettings() {
  uiStore.openSettings();
}

function openPalette() {
  uiStore.commandPaletteOpen = true;
}

function toggleSidebar() {
  uiStore.sidebarVisible = !uiStore.sidebarVisible;
}

function toggleInspector() {
  uiStore.inspectorVisible = !uiStore.inspectorVisible;
}
</script>

<template>
  <div class="toolbar">
    <div class="toolbar-left">
      <div class="toolbar-brand">
        <span class="brand-icon">&#x25C6;</span>
        <span class="brand-name">Terminal Canvas</span>
      </div>
      
      <div class="toolbar-divider" />
      
      <button class="toolbar-btn" title="New Terminal (Ctrl+N)" @click="quickNewTerminal">
        <span class="toolbar-icon">+</span>
        <span>New</span>
      </button>

      <button class="toolbar-btn" title="Open Folder" @click="openFolder">
        <span class="toolbar-icon">&#x1F4C1;</span>
        <span>Open</span>
      </button>

      <button class="toolbar-btn" title="Save Workspace (Ctrl+S)" @click="saveWorkspace">
        <span class="toolbar-icon">S</span>
        <span>Save</span>
      </button>
      
      <button class="toolbar-btn" title="Group Selected (Ctrl+G)" @click="groupSelected">
        <span class="toolbar-icon">G</span>
        <span>Group</span>
      </button>

      <button class="toolbar-btn" title="Add Sticky Note" @click="addStickyNote">
        <span class="toolbar-icon">&#128220;</span>
        <span>Note</span>
      </button>
      
      <div class="toolbar-divider" />
      
      <button class="toolbar-btn" title="Toggle Sidebar" @click="toggleSidebar">
        <span class="toolbar-icon">&#x2630;</span>
      </button>
      
      <button class="toolbar-btn" title="Toggle Inspector" @click="toggleInspector">
        <span class="toolbar-icon">I</span>
      </button>
    </div>
    
    <div class="toolbar-right">
      <span v-if="workspaceStore.isSaving" class="toolbar-status">Saving...</span>
      <button
        v-if="attentionCount > 0"
        class="toolbar-btn attention-btn"
        :title="`${attentionCount} terminal(s) need attention — click to jump to the most recent`"
        @click="jumpToNextAttention"
      >
        <span class="toolbar-icon">&#128276;</span>
        <span>{{ attentionCount }}</span>
      </button>
      <button class="toolbar-btn" title="Command Palette (Ctrl+Shift+P)" @click="openPalette">
        <span class="toolbar-icon">&#x2318;</span>
        <span>Palette</span>
      </button>
      <button class="toolbar-btn" :title="themeTitle" @click="uiStore.cycleTheme()">
        <span class="toolbar-icon">{{ themeIcon }}</span>
        <span>{{ themeLabel }}</span>
      </button>
      <button class="toolbar-btn" title="Settings" @click="openSettings">
        <span class="toolbar-icon">&#x2699;</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 12px;
  height: 42px;
  background: var(--tc-bg-card);
  border-bottom: 1px solid var(--tc-border-color);
}

.toolbar-left {
  display: flex;
  align-items: center;
  gap: 2px;
}

.toolbar-right {
  display: flex;
  align-items: center;
  gap: 2px;
}

.toolbar-brand {
  display: flex;
  align-items: center;
  gap: 8px;
  padding-right: 12px;
}

.brand-icon {
  color: var(--tc-accent);
  font-size: 14px;
}

.brand-name {
  font-size: var(--tc-font-size-sm);
  font-weight: 700;
  color: var(--tc-text-primary);
  letter-spacing: -0.3px;
}

.toolbar-divider {
  width: 1px;
  height: 20px;
  background: var(--tc-border-color);
  margin: 0 6px;
}

.toolbar-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 5px 10px;
  border: none;
  background: transparent;
  color: var(--tc-text-secondary);
  font-size: var(--tc-font-size-sm);
  cursor: pointer;
  border-radius: var(--tc-border-radius-sm);
  transition: all var(--tc-transition-fast);
  font-family: var(--tc-font-sans);
  height: 30px;
}

.toolbar-btn:hover {
  background: var(--tc-bg-hover);
  color: var(--tc-text-primary);
}

.toolbar-icon {
  font-size: 12px;
  opacity: 0.7;
}

.toolbar-status {
  font-size: var(--tc-font-size-xs);
  color: var(--tc-text-muted);
  margin-right: 8px;
  animation: pulse 1s ease infinite;
}

.attention-btn {
  color: var(--tc-warning);
}

.attention-btn:hover {
  background: var(--tc-warning-soft);
  color: var(--tc-warning);
}

@keyframes pulse {
  0%, 100% { opacity: 0.6; }
  50% { opacity: 1; }
}
</style>
