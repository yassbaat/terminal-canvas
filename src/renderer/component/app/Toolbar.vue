<script setup lang="ts">
import { computed, ref } from "vue";
import { useVueFlow } from "@vue-flow/core";
import { useTerminalStore } from "@renderer/store/terminal";
import { useWorkspaceStore } from "@renderer/store/workspace";
import { useUIStore } from "@renderer/store/ui";
import { findNonOverlappingPosition } from "@renderer/util/placement";
import { playAttentionChime } from "@renderer/util/sound";
import {
  SquareTerminal,
  Plus,
  Save,
  Group as GroupIcon,
  StickyNote,
  Maximize2,
  Bell,
  Command,
  Sun,
  Moon,
  Monitor,
  Settings as SettingsIcon,
  LayoutGrid,
} from "lucide-vue-next";

const terminalStore = useTerminalStore();
const workspaceStore = useWorkspaceStore();
const uiStore = useUIStore();
// Same id as <VueFlow id="canvas"> in WorkspaceCanvas.vue -- useVueFlow looks
// up a shared store by id, so this connects to the real canvas instance
// even though Toolbar isn't a descendant of it.
const { setCenter, getViewport } = useVueFlow("canvas");

const attentionCount = computed(() => terminalStore.attentionSessions.length);

// Which terminal the bell button last jumped to, so repeated clicks advance
// through the whole list instead of re-jumping to the same one -- tracked
// here rather than derived, since once a terminal is focused it drops out
// of attentionSessions (see terminalStore.setFocused), so "the next one"
// can't be inferred purely from that list once we're cycling through
// terminals that were never flagged at all.
const lastJumpedId = ref<string | null>(null);

/**
 * Jump to a terminal, prioritizing the ones that most recently needed
 * attention (most-recent first), then falling through to every other
 * terminal so there's always somewhere to go -- even a workspace with
 * nothing idle yet is still fully browsable. Wraps around forever, so
 * clicking past the end just starts over from the top.
 *
 * If nothing is currently flagged, this still jumps (per the "even if
 * there was no finished job" ask) but also chimes and toasts, since that's
 * useful signal on its own: everything's still busy.
 */
function jumpToNextAttention(): void {
  const flagged = terminalStore.attentionSessions;
  const rest = terminalStore.allSessions.filter((s) => !flagged.includes(s));
  const ordered = [...flagged, ...rest];

  if (ordered.length === 0) {
    uiStore.showToast("No terminals to jump to");
    return;
  }

  if (flagged.length === 0 && !uiStore.soundMuted) {
    playAttentionChime();
  }
  if (flagged.length === 0) {
    uiStore.showToast("All terminals are busy -- nothing has finished yet");
  }

  const lastIndex = ordered.findIndex((s) => s.id === lastJumpedId.value);
  const next = ordered[(lastIndex + 1) % ordered.length];

  lastJumpedId.value = next.id;
  const width = next.node.width || 760;
  const height = next.node.height || 480;
  const centerX = next.node.x + width / 2;
  const centerY = next.node.y + height / 2;
  setCenter(centerX, centerY, { zoom: Math.max(getViewport().zoom, 0.75), duration: 400 });
  terminalStore.setFocused(next.id);
}

const themeIcon = computed(() => {
  if (uiStore.themePreference === "system") return Monitor;
  return uiStore.themePreference === "dark" ? Moon : Sun;
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

async function saveWorkspace() {
  const ok = await workspaceStore.saveCurrentWorkspace();
  if (ok) uiStore.showToast("Workspace saved");
}

/** Save the current session, then hand off to the workspace launcher. */
async function goHome() {
  await workspaceStore.saveCurrentWorkspace();
  await workspaceStore.loadWorkspaceList();
  uiStore.showHome();
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
  const size = { width: 200, height: 160 };
  const pos = findNonOverlappingPosition(
    terminalStore.allSessions,
    workspaceStore.groups,
    getViewport(),
    null,
    size,
    workspaceStore.stickyNotes
  );
  workspaceStore.createStickyNote({ x: pos.x, y: pos.y, width: size.width, height: size.height });
  uiStore.showToast("Sticky note added");
}

function openSettings() {
  uiStore.openSettings();
}

function openPalette() {
  uiStore.commandPaletteOpen = true;
}

/** Enter Focus Mode with the selected terminals, or all of them if none are
 * selected. */
function enterFocusMode() {
  const selected = Array.from(terminalStore.selectedTerminalIds);
  const ids = selected.length > 0 ? selected : terminalStore.allSessions.map((s) => s.id);
  if (ids.length === 0) {
    uiStore.showToast("No terminals to focus");
    return;
  }
  uiStore.enterFocus(ids);
}
</script>

<template>
  <div class="toolbar">
    <div class="toolbar-left">
      <div class="toolbar-brand">
        <SquareTerminal class="brand-icon" :size="18" />
        <span class="brand-name">Terminal Canvas</span>
      </div>

      <button class="toolbar-btn" title="Workspaces" @click="goHome">
        <LayoutGrid class="toolbar-icon" :size="15" />
        <span>Workspaces</span>
      </button>

      <div class="toolbar-divider" />

      <button class="toolbar-btn" title="New Terminal (Ctrl+N)" @click="quickNewTerminal">
        <Plus class="toolbar-icon" :size="15" />
        <span>New Terminal</span>
      </button>

      <button class="toolbar-btn" title="Save Workspace (Ctrl+S)" @click="saveWorkspace">
        <Save class="toolbar-icon" :size="15" />
        <span>Save</span>
      </button>

      <button class="toolbar-btn" title="Group Selected (Ctrl+G)" @click="groupSelected">
        <GroupIcon class="toolbar-icon" :size="15" />
        <span>Group</span>
      </button>

      <button class="toolbar-btn" title="Add Sticky Note" @click="addStickyNote">
        <StickyNote class="toolbar-icon" :size="15" />
        <span>Note</span>
      </button>

      <button class="toolbar-btn" title="Focus Mode (Ctrl/Cmd+Shift+F) — selected terminals, or all" @click="enterFocusMode">
        <Maximize2 class="toolbar-icon" :size="15" />
        <span>Focus</span>
      </button>
      <!-- Sidebar/Inspector toggles used to live here; they now sit on the
           panels themselves (collapse buttons in each panel header + edge
           re-open tabs), which is where they belong. -->
    </div>

    <div class="toolbar-right">
      <span v-if="workspaceStore.isSaving" class="toolbar-status">Saving...</span>
      <button
        class="toolbar-btn attention-btn"
        :class="{ 'attention-btn-active': attentionCount > 0 }"
        :title="attentionCount > 0
          ? `${attentionCount} terminal(s) finished — click to jump to the most recent, click again for the next`
          : 'Browse terminals — click to jump through them, most-recently-finished first'"
        @click="jumpToNextAttention"
      >
        <Bell class="toolbar-icon" :size="15" />
        <span v-if="attentionCount > 0">{{ attentionCount }}</span>
      </button>
      <button class="toolbar-btn" title="Command Palette (Ctrl+Shift+P)" @click="openPalette">
        <Command class="toolbar-icon" :size="15" />
        <span>Palette</span>
      </button>
      <button class="toolbar-btn" :title="themeTitle" @click="uiStore.cycleTheme()">
        <component :is="themeIcon" class="toolbar-icon" :size="15" />
        <span>{{ themeLabel }}</span>
      </button>
      <button class="toolbar-btn" title="Settings" @click="openSettings">
        <SettingsIcon class="toolbar-icon" :size="15" />
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
  flex-shrink: 0;
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
  opacity: 0.8;
  flex-shrink: 0;
}

.toolbar-status {
  font-size: var(--tc-font-size-xs);
  color: var(--tc-text-muted);
  margin-right: 8px;
  animation: pulse 1s ease infinite;
}

.attention-btn {
  color: var(--tc-text-muted);
}

.attention-btn:hover {
  background: var(--tc-bg-hover);
  color: var(--tc-text-primary);
}

.attention-btn-active {
  color: var(--tc-warning);
}

.attention-btn-active:hover {
  background: var(--tc-warning-soft);
  color: var(--tc-warning);
}

@keyframes pulse {
  0%, 100% { opacity: 0.6; }
  50% { opacity: 1; }
}
</style>
