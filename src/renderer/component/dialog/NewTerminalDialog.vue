<script setup lang="ts">
import { ref, onMounted, watch } from "vue";
import { useTerminalStore } from "@renderer/store/terminal";
import { useLaunchProfileStore } from "@renderer/store/launchProfile";
import { useUIStore } from "@renderer/store/ui";
import { X } from "lucide-vue-next";

const props = defineProps<{
  open: boolean;
}>();

const emit = defineEmits<{
  (e: "update:open", value: boolean): void;
}>();

const terminalStore = useTerminalStore();
const launchProfileStore = useLaunchProfileStore();
const uiStore = useUIStore();
const selectedShellId = ref("");
const customCwd = ref("");
const selectedProfileId = ref("plain-shell");

// Auto-select first shell when shells load or dialog opens
watch(
  () => props.open,
  (isOpen) => {
    if (isOpen && terminalStore.shells.length > 0 && !selectedShellId.value) {
      selectedShellId.value = terminalStore.shells[0].id;
    }
  }
);

watch(
  () => terminalStore.shells,
  (shells) => {
    if (shells.length > 0 && !selectedShellId.value) {
      selectedShellId.value = shells[0].id;
    }
  },
  { immediate: true }
);

onMounted(() => {
  if (terminalStore.shells.length > 0 && !selectedShellId.value) {
    selectedShellId.value = terminalStore.shells[0].id;
  }
});

async function create() {
  if (!selectedShellId.value) return;

  const profile = launchProfileStore.getProfile(selectedProfileId.value);

  await terminalStore.createSession({
    shellId: selectedShellId.value,
    cols: 80,
    rows: 24,
    cwd: customCwd.value || undefined,
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

function close() {
  emit("update:open", false);
  customCwd.value = "";
  selectedProfileId.value = "plain-shell";
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
        <div class="form-group">
          <label>Shell</label>
          <div class="shell-options">
            <button
              v-for="shell in terminalStore.shells"
              :key="shell.id"
              class="shell-option"
              :class="{ active: selectedShellId === shell.id }"
              @click="selectedShellId = shell.id"
            >
              {{ shell.name }}
            </button>
          </div>
        </div>

        <div class="form-group">
          <label>Launch (optional)</label>
          <div class="profile-options">
            <button
              v-for="profile in launchProfileStore.allProfiles"
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
          <span class="form-hint">
            Auto-types and submits the command once the shell is ready.
            <a href="#" class="manage-profiles-link" @click.prevent="openLaunchProfileSettings">Manage providers &amp; commands</a>
          </span>
        </div>

        <div class="form-group">
          <label>Working Directory (optional)</label>
          <div class="cwd-input-row">
            <input
              v-model="customCwd"
              class="tc-input cwd-input"
              placeholder="C:\Projects\..."
              type="text"
            />
            <button class="tc-btn browse-btn" @click="browseCwd">Browse</button>
          </div>
        </div>

      </div>

      <div class="dialog-footer">
        <button class="tc-btn" @click="close">Cancel</button>
        <button class="tc-btn tc-btn-primary" @click="create">Create</button>
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

.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 10px 14px;
  border-top: 1px solid var(--tc-border-color);
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

.shell-options {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.shell-option {
  padding: 5px 11px;
  border: 1px solid var(--tc-border-color);
  border-radius: var(--tc-border-radius-sm);
  background: var(--tc-bg-secondary);
  color: var(--tc-text-secondary);
  cursor: pointer;
  font-size: var(--tc-font-size-sm);
  transition: all var(--tc-transition-fast);
  font-family: var(--tc-font-sans);
}

.shell-option:hover {
  border-color: var(--tc-border-focus);
  color: var(--tc-text-primary);
}

.shell-option.active {
  border-color: var(--tc-accent);
  background: var(--tc-accent-soft);
  color: var(--tc-accent);
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

.manage-profiles-link {
  color: var(--tc-accent);
  text-decoration: none;
  margin-left: 4px;
}

.manage-profiles-link:hover {
  text-decoration: underline;
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
