<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from "vue";
import { useTerminalStore } from "@renderer/store/terminal";
import { usePromptStore } from "@renderer/store/prompt";
import { useFileStore } from "@renderer/store/file";
import { useWorkspaceStore } from "@renderer/store/workspace";
import { useUIStore } from "@renderer/store/ui";
import Toolbar from "@renderer/component/app/Toolbar.vue";
import Statusbar from "@renderer/component/app/Statusbar.vue";
import Sidebar from "@renderer/component/app/Sidebar.vue";
import Inspector from "@renderer/component/app/Inspector.vue";
import HomeView from "@renderer/component/app/HomeView.vue";
import WorkspaceCanvas from "@renderer/component/canvas/WorkspaceCanvas.vue";
import NewTerminalDialog from "@renderer/component/dialog/NewTerminalDialog.vue";
import SettingsDialog from "@renderer/component/dialog/SettingsDialog.vue";
import OnboardingDialog from "@renderer/component/dialog/OnboardingDialog.vue";
import CommandPalette from "@renderer/component/dialog/CommandPalette.vue";
import FocusMode from "@renderer/component/focus/FocusMode.vue";
import { PanelLeftOpen, PanelRightOpen } from "lucide-vue-next";

const terminalStore = useTerminalStore();
const promptStore = usePromptStore();
const fileStore = useFileStore();
const workspaceStore = useWorkspaceStore();
const uiStore = useUIStore();

// Keep <html data-theme="..."> in sync with the resolved theme. The initial
// value is already applied synchronously by the inline script in
// index.html (avoids a flash) -- this watcher only handles later changes:
// the user toggling it, or the OS preference flipping while running.
watch(
  () => uiStore.resolvedTheme,
  (theme) => {
    document.documentElement.setAttribute("data-theme", theme);
  },
  { immediate: true }
);

// Take the window to true OS full-screen while Focus Mode is active (and back
// out on exit). Requested from a click/keydown-driven state change, so user
// activation is still present; failures are non-fatal (the overlay fills the
// window regardless).
watch(
  () => uiStore.focusModeActive,
  (active) => {
    try {
      if (active && !document.fullscreenElement) {
        void document.documentElement.requestFullscreen?.();
      } else if (!active && document.fullscreenElement) {
        void document.exitFullscreen?.();
      }
    } catch {
      // ignore -- non-fatal
    }
  }
);

/**
 * Global keyboard shortcuts handler.
 * Canvas-level shortcuts are only active when no terminal is focused.
 */
function handleKeyDown(e: KeyboardEvent): void {
  // Never intercept when an input, textarea, or contenteditable is focused
  const active = document.activeElement;
  if (
    active &&
    (active.tagName === "INPUT" ||
      active.tagName === "TEXTAREA" ||
      (active as HTMLElement).isContentEditable)
  ) {
    return;
  }

  // Focus Mode handles its own keys (Esc, paging); skip the app/canvas
  // shortcuts while it's active.
  if (uiStore.focusModeActive) return;

  // If a terminal is focused, only handle Esc to unfocus it
  if (terminalStore.focusedTerminalId) {
    if (e.key === "Escape") {
      terminalStore.setFocused(null);
      e.preventDefault();
    }
    return;
  }

  // Accept both Ctrl (Windows/Linux) and Cmd (macOS) as the modifier key
  const mod = e.ctrlKey || e.metaKey;

  // Ctrl+N: New terminal (use default if set, otherwise open dialog)
  if (e.key === "n" && mod && !e.shiftKey) {
    const shellId =
      terminalStore.sessionDefaultShellId ||
      workspaceStore.settings.defaultShellId;
    const shell = terminalStore.shells.find((s) => s.id === shellId);
    if (shell) {
      terminalStore.createSession({ shellId: shell.id, cols: 80, rows: 24 });
    } else {
      uiStore.openNewTerminalDialog();
    }
    e.preventDefault();
    return;
  }

  // Ctrl+S: Save workspace
  if (e.key === "s" && mod && !e.shiftKey) {
    workspaceStore.saveCurrentWorkspace().then((ok) => {
      if (ok) uiStore.showToast("Workspace saved");
    });
    e.preventDefault();
    return;
  }

  // Ctrl+Shift+P: Command palette
  if ((e.key === "P" || e.key === "p") && mod && e.shiftKey) {
    uiStore.toggleCommandPalette();
    e.preventDefault();
    return;
  }

  // Ctrl/Cmd+Shift+F: enter Focus Mode with the selected terminals (or all).
  if ((e.key === "F" || e.key === "f") && mod && e.shiftKey) {
    const selected = Array.from(terminalStore.selectedTerminalIds);
    const ids = selected.length > 0 ? selected : terminalStore.allSessions.map((s) => s.id);
    if (ids.length === 0) {
      uiStore.showToast("No terminals to focus");
    } else {
      uiStore.enterFocus(ids);
    }
    e.preventDefault();
    return;
  }

  // Ctrl+G: Group selected terminals
  if (e.key === "g" && mod && !e.shiftKey) {
    workspaceStore.groupSelectedTerminals().then((group: { terminalIds: string[] } | null) => {
      if (group) {
        uiStore.showToast(`Grouped ${group.terminalIds.length} terminal(s)`);
      } else {
        uiStore.showToast("No terminals selected");
      }
    });
    e.preventDefault();
    return;
  }

  // Ctrl/Cmd + Plus/Minus/0 (zoom) and Delete/Backspace (remove selection)
  // are handled by WorkspaceCanvas so there's a single source of truth for
  // canvas-scoped shortcuts and selected terminals/notes/groups aren't
  // processed twice by two separate window-level listeners.
}

// Register "Open in Terminal Canvas" listener immediately so we don't miss early events
const unsubOpenDir = ref<(() => void) | null>(null);

if (typeof window.api !== "undefined") {
  unsubOpenDir.value = window.api.shell.onOpenDir(async (dir) => {
    // Skip non-directory paths (e.g. files passed via argv fallback)
    if (dir.endsWith(".exe") || dir.endsWith(".dll")) {
      console.warn("[App] Ignored non-directory open-dir:", dir);
      return;
    }
    const shellId =
      terminalStore.sessionDefaultShellId ||
      workspaceStore.settings.defaultShellId ||
      terminalStore.shells[0]?.id ||
      "cmd";
    try {
      await terminalStore.createSession({
        shellId,
        cols: 80,
        rows: 24,
        cwd: dir,
        viewport: workspaceStore.viewport,
        groups: workspaceStore.groups,
      });
      uiStore.showToast(`Opened folder in terminal: ${dir}`);
    } catch (err) {
      uiStore.showToast(`Failed to open terminal: ${dir}`);
      console.error("[App] shell:openDir createSession failed", err);
    }
  });
}

/**
 * Handle paste events — route clipboard content to the focused terminal.
 * Skips interception when the user is typing in an input, textarea, or dialog.
 */
async function handlePaste(e: ClipboardEvent): Promise<void> {
  // Don't intercept if an input/textarea/contenteditable is focused
  const active = document.activeElement;
  if (
    active &&
    (active.tagName === "INPUT" ||
      active.tagName === "TEXTAREA" ||
      (active as HTMLElement).isContentEditable)
  ) {
    return;
  }

  // Don't intercept if any dialog is open
  if (
    uiStore.newTerminalDialogOpen ||
    uiStore.settingsOpen ||
    uiStore.groqSettingsOpen ||
    uiStore.commandPaletteOpen ||
    uiStore.onboardingOpen
  ) {
    return;
  }

  if (!terminalStore.focusedTerminalId) return;
  const text = e.clipboardData?.getData("text");
  if (!text) return;
  e.preventDefault();
  await terminalStore.writeToTerminal(terminalStore.focusedTerminalId, text);
}

onMounted(() => {
  // If running outside Electron (e.g. browser), window.api won't exist.
  // Guard so the UI still renders and we can warn the user.
  if (typeof window.api === "undefined") {
    console.warn(
      "[App] window.api is not available. Terminal features require Electron."
    );
  } else {
    // Initialize terminal IPC listeners
    terminalStore.setupListeners();
    promptStore.setupListeners();
    fileStore.setupListeners();
    // Load available shells from the system
    terminalStore.loadShells();
    // Main process's idle-threshold defaults fresh each launch; push the
    // persisted preference (if the user has changed it before) to match.
    window.api.terminal.setIdleThreshold(uiStore.idleThresholdSeconds * 1000).catch(() => {});
  }

  // Show a home/launcher screen listing saved workspaces to pick from --
  // previously the app *always* silently created a fresh workspace on
  // launch and workspaceList was never even fetched, so saved workspaces
  // were completely unreachable from the UI. Only skip straight to a new
  // workspace when there's truly nothing saved yet (first run).
  workspaceStore.loadWorkspaceList().then(() => {
    if (workspaceStore.workspaceList.length > 0) {
      uiStore.showHome();
    } else {
      workspaceStore.createNewWorkspace();
    }
  });

  // Show onboarding on first run
  const hasOnboarded = localStorage.getItem("terminal-canvas:onboarded") === "true";
  if (!hasOnboarded) {
    uiStore.openOnboarding();
  }

  // Tell the main process we're ready to receive queued events (e.g. openDir)
  if (typeof window.api !== "undefined") {
    window.api.shell.rendererReady();
  }

  // Register global keyboard shortcuts
  window.addEventListener("keydown", handleKeyDown);
  // Register paste handler
  window.addEventListener("paste", handlePaste);
});

onUnmounted(() => {
  window.removeEventListener("keydown", handleKeyDown);
  window.removeEventListener("paste", handlePaste);
  if (unsubOpenDir.value) {
    unsubOpenDir.value();
  }
});
</script>

<template>
  <div class="app-root">
    <HomeView v-if="uiStore.homeVisible" />
    <template v-else>
      <!-- Top toolbar -->
      <Toolbar class="app-toolbar" />

      <!-- Main body: sidebar + canvas + inspector -->
      <div class="app-body">
        <Sidebar
          v-show="uiStore.sidebarVisible"
          class="app-sidebar"
          :style="{ width: uiStore.sidebarWidth + 'px' }"
        />
        <div class="app-canvas-area">
          <WorkspaceCanvas class="app-canvas" />
          <!-- Edge re-open tabs: appear only when a panel is collapsed, right
               where that panel would slide back in from. -->
          <button
            v-show="!uiStore.sidebarVisible"
            class="panel-reopen panel-reopen-left"
            title="Show sidebar"
            @click="uiStore.toggleSidebar()"
          >
            <PanelLeftOpen :size="16" />
          </button>
          <button
            v-show="!uiStore.inspectorVisible"
            class="panel-reopen panel-reopen-right"
            title="Show inspector"
            @click="uiStore.toggleInspector()"
          >
            <PanelRightOpen :size="16" />
          </button>
        </div>
        <Inspector
          v-show="uiStore.inspectorVisible"
          class="app-inspector"
          :style="{ width: uiStore.inspectorWidth + 'px' }"
        />
      </div>

      <!-- Bottom status bar -->
      <Statusbar class="app-statusbar" />
    </template>

    <!-- Focus Mode (V2): immersive full-screen stage overlay -->
    <FocusMode v-if="uiStore.focusModeActive" />

    <!-- Dialogs -->
    <NewTerminalDialog v-model:open="uiStore.newTerminalDialogOpen" />
    <SettingsDialog v-model:open="uiStore.settingsOpen" />
    <OnboardingDialog />
    <CommandPalette v-model:open="uiStore.commandPaletteOpen" />

    <!-- Toast notification -->
    <Transition name="toast">
      <div v-if="uiStore.toastMessage" class="app-toast">
        {{ uiStore.toastMessage }}
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.app-root {
  width: 100vw;
  height: 100vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--tc-bg-primary);
}

.app-toolbar {
  flex-shrink: 0;
  height: 42px;
  z-index: var(--tc-z-toolbar);
}

.app-body {
  flex: 1;
  display: flex;
  overflow: hidden;
  min-height: 0;
}

.app-sidebar {
  flex-shrink: 0;
  z-index: var(--tc-z-sidebar);
  position: relative;
}

.app-canvas-area {
  flex: 1;
  position: relative;
  overflow: hidden;
  min-width: 0;
}

/* Edge tabs that bring a collapsed sidebar/inspector back. Pinned to the
   canvas edges (near where each panel lives) and vertically centered. */
.panel-reopen {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  z-index: 15;
  width: 22px;
  height: 52px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--tc-bg-card);
  border: 1px solid var(--tc-border-color);
  color: var(--tc-text-secondary);
  cursor: pointer;
  transition: all var(--tc-transition-fast);
  box-shadow: var(--tc-shadow-sm);
}

.panel-reopen:hover {
  color: var(--tc-accent);
  background: var(--tc-bg-hover);
}

.panel-reopen-left {
  left: 0;
  border-left: none;
  border-radius: 0 var(--tc-border-radius) var(--tc-border-radius) 0;
}

.panel-reopen-right {
  right: 0;
  border-right: none;
  border-radius: var(--tc-border-radius) 0 0 var(--tc-border-radius);
}

.app-canvas {
  width: 100%;
  height: 100%;
}

.app-inspector {
  flex-shrink: 0;
  z-index: var(--tc-z-inspector);
  position: relative;
}

.app-statusbar {
  flex-shrink: 0;
  height: 26px;
  z-index: var(--tc-z-statusbar);
}

/* Toast */
.app-toast {
  position: fixed;
  bottom: 40px;
  left: 50%;
  transform: translateX(-50%);
  background: var(--tc-bg-card);
  color: var(--tc-text-primary);
  padding: 10px 20px;
  border-radius: var(--tc-border-radius);
  border: 1px solid var(--tc-border-color);
  box-shadow: var(--tc-shadow-lg);
  z-index: var(--tc-z-modal);
  font-size: var(--tc-font-size-sm);
  pointer-events: none;
}

/* Toast transition */
.toast-enter-active,
.toast-leave-active {
  transition: opacity 200ms ease, transform 200ms ease;
}

.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(10px);
}

.toast-enter-to,
.toast-leave-from {
  opacity: 1;
  transform: translateX(-50%) translateY(0);
}
</style>
