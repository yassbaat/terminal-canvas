<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useTerminalStore } from "@renderer/store/terminal";
import { useWorkspaceStore } from "@renderer/store/workspace";
import { useLaunchProfileStore } from "@renderer/store/launchProfile";
import { useUIStore } from "@renderer/store/ui";
import { Settings2, X } from "lucide-vue-next";

const props = defineProps<{
  open: boolean;
}>();

const emit = defineEmits<{
  (e: "update:open", value: boolean): void;
}>();

const terminalStore = useTerminalStore();
const workspaceStore = useWorkspaceStore();
const launchProfileStore = useLaunchProfileStore();
const uiStore = useUIStore();
const customCwd = ref(launchProfileStore.lastCwd);
const selectedProfileId = ref(launchProfileStore.lastProfileId);

// Re-read on every open rather than only at mount: the dialog stays mounted for
// the life of the window, so this is what picks up a selection made since the
// last open -- and what re-validates it if the remembered profile was deleted
// in Settings in between.
watch(
  () => props.open,
  (isOpen) => {
    if (!isOpen) return;
    selectedProfileId.value = launchProfileStore.lastProfileId;
    customCwd.value = launchProfileStore.lastCwd;
  }
);

/**
 * Which shell a new terminal opens, resolved rather than asked for. Same
 * precedence the canvas/palette/Focus "new terminal" paths already use --
 * this session's default, then the workspace's, then whatever the detector
 * reported first (which is $SHELL).
 */
const resolvedShellId = computed(() => {
  const preferred =
    terminalStore.sessionDefaultShellId || workspaceStore.settings.defaultShellId;
  const match = terminalStore.shells.find((s) => s.id === preferred);
  return match?.id ?? terminalStore.shells[0]?.id ?? "";
});

async function create() {
  if (!resolvedShellId.value) return;

  const profile = launchProfileStore.getProfile(selectedProfileId.value);
  const cwd = customCwd.value.trim();

  launchProfileStore.rememberSelection(selectedProfileId.value, cwd);

  await terminalStore.createSession({
    shellId: resolvedShellId.value,
    cols: 80,
    rows: 24,
    cwd: cwd || undefined,
    autoRunCommand: profile?.command || undefined,
  });
  close();
}

function openLaunchProfileSettings() {
  close();
  uiStore.openSettings();
}

async function browseCwd() {
  if (typeof window.api === "undefined") return;
  const result = await window.api.dialog.showOpenDialog({
    title: "Select Working Directory",
    properties: ["openDirectory"],
  });
  if (!result.canceled && result.filePaths.length > 0) {
    customCwd.value = result.filePaths[0];
  }
}

// Deliberately leaves the fields alone -- what they should hold next time is
// the last selection actually used, which the open watcher restores.
function close() {
  emit("update:open", false);
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === "Escape") {
    close();
  } else if (event.key === "Enter" && event.ctrlKey) {
    create();
  }
}
</script>

<template>
  <div
    v-if="open"
    class="dialog-overlay"
    @click="close"
    @keydown="onKeydown"
    tabindex="0"
  >
    <div class="dialog" @click.stop>
      <div class="dialog-header">
        <h3>New Terminal</h3>
        <button class="dialog-close" @click="close"><X :size="16" /></button>
      </div>

      <div class="dialog-body">
        <!-- No shell picker: a new terminal always opens the default shell
             ($SHELL, or the workspace's configured default). Choosing between
             zsh/bash/sh was a decision nobody wanted to make on every single
             terminal -- it's still switchable in Settings. The provider row is
             unlabelled for the same reason the shell picker is gone: the chips
             say what they are, and a "Launch (optional)" heading over them was
             one more line to read on the way to a terminal. -->
        <div class="form-group">
          <div class="profile-options">
            <button
              v-for="profile in launchProfileStore.featuredProfiles"
              :key="profile.id"
              class="profile-option"
              :class="{ active: selectedProfileId === profile.id }"
              :style="selectedProfileId === profile.id ? { borderColor: profile.color, color: profile.color } : {}"
              :title="profile.command ? `Runs '${profile.command}' automatically once the shell is ready` : 'Plain shell, nothing auto-run'"
              @click="selectedProfileId = profile.id"
            >
              <component :is="profile.icon" class="profile-glyph" :size="13" :style="{ color: profile.color }" />
              {{ profile.label }}
            </button>
          </div>
        </div>

        <div class="form-group">
          <label>Folder (optional)</label>
          <div class="cwd-input-row">
            <input
              v-model="customCwd"
              class="tc-input cwd-input"
              placeholder="Defaults to your home folder"
              type="text"
            />
            <button class="tc-btn browse-btn" @click="browseCwd">Browse</button>
          </div>
        </div>

      </div>

      <div class="dialog-footer">
        <button
          class="default-options-btn"
          title="Default options"
          @click="openLaunchProfileSettings"
        >
          <Settings2 :size="15" />
        </button>
        <div class="dialog-footer-actions">
          <button class="tc-btn" @click="close">Cancel</button>
          <button class="tc-btn tc-btn-primary" @click="create">Create</button>
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

.dialog-overlay:focus {
  outline: none;
}

.dialog {
  background: var(--tc-bg-card);
  border: 1px solid var(--tc-border-color);
  border-radius: var(--tc-border-radius);
  width: 340px;
  max-width: 92vw;
  box-shadow: var(--tc-shadow-lg);
}

.dialog-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  border-bottom: 1px solid var(--tc-border-color);
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
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

/* The gear sits opposite the actions rather than beside them: it goes to
   Settings instead of doing anything to this terminal, so it shouldn't read as
   a third button in the Cancel/Create sequence. */
.dialog-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 10px 14px;
  border-top: 1px solid var(--tc-border-color);
}

.dialog-footer-actions {
  display: flex;
  gap: 8px;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.form-group label {
  font-size: var(--tc-font-size-sm);
  color: var(--tc-text-secondary);
  font-weight: 500;
}


.profile-options {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.profile-option {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 10px;
  border: 1px solid var(--tc-border-color);
  border-radius: var(--tc-border-radius-sm);
  background: var(--tc-bg-secondary);
  color: var(--tc-text-secondary);
  cursor: pointer;
  font-size: var(--tc-font-size-sm);
  transition: all var(--tc-transition-fast);
  font-family: var(--tc-font-sans);
}

.profile-option:hover {
  border-color: var(--tc-border-focus);
  color: var(--tc-text-primary);
}

.profile-option.active {
  background: var(--tc-bg-hover);
}

.profile-glyph {
  font-size: 13px;
  line-height: 1;
}

.default-options-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: none;
  background: transparent;
  color: var(--tc-text-muted);
  border-radius: var(--tc-border-radius-sm);
  cursor: pointer;
  transition: all var(--tc-transition-fast);
}

.default-options-btn:hover {
  background: var(--tc-bg-hover);
  color: var(--tc-text-primary);
}

.tc-input {
  composes: tc-input from global;
}

.cwd-input-row {
  display: flex;
  gap: 8px;
  align-items: center;
}

.cwd-input {
  flex: 1;
}

.browse-btn {
  padding: 6px 12px;
  border: 1px solid var(--tc-border-color);
  border-radius: var(--tc-border-radius-sm);
  background: var(--tc-bg-secondary);
  color: var(--tc-text-secondary);
  font-size: var(--tc-font-size-sm);
  cursor: pointer;
  transition: all var(--tc-transition-fast);
  font-family: var(--tc-font-sans);
  white-space: nowrap;
}

.browse-btn:hover {
  background: var(--tc-bg-hover);
  color: var(--tc-text-primary);
  border-color: var(--tc-border-focus);
}
</style>
