<script setup lang="ts">
import { ref, onMounted, watch } from "vue";
import { useTerminalStore } from "@renderer/store/terminal";
import { useWorkspaceStore } from "@renderer/store/workspace";

const props = defineProps<{
  open: boolean;
}>();

const emit = defineEmits<{
  (e: "update:open", value: boolean): void;
}>();

const terminalStore = useTerminalStore();
const workspaceStore = useWorkspaceStore();

const selectedShellId = ref("");
const customCwd = ref(terminalStore.lastUsedCwd);
const name = ref("");
const command = ref("");
const autoRun = ref(false);
const rememberForSession = ref(false);
const rememberAlways = ref(false);
const savePresetName = ref("");
const showSavePreset = ref(false);

// Auto-select first shell when shells load or dialog opens
watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) {
      customCwd.value = terminalStore.lastUsedCwd;
      if (terminalStore.shells.length > 0 && !selectedShellId.value) {
        selectedShellId.value = terminalStore.shells[0].id;
      }
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

function applyPreset(presetCommand: string) {
  command.value = presetCommand;
  autoRun.value = true;
}

function removePreset(id: string, event: MouseEvent) {
  event.stopPropagation();
  terminalStore.removeCommandPreset(id);
}

function startSavePreset() {
  if (!command.value.trim()) return;
  savePresetName.value = command.value.trim().split(/\s+/)[0];
  showSavePreset.value = true;
}

function confirmSavePreset() {
  const trimmed = savePresetName.value.trim();
  if (!trimmed || !command.value.trim()) return;
  terminalStore.addCommandPreset({ name: trimmed, command: command.value.trim() });
  showSavePreset.value = false;
  savePresetName.value = "";
}

async function create() {
  if (!selectedShellId.value) return;

  const cwd = customCwd.value.trim() || undefined;
  if (cwd) {
    terminalStore.setLastUsedCwd(cwd);
  }

  if (rememberForSession.value) {
    terminalStore.sessionDefaultShellId = selectedShellId.value;
  }
  if (rememberAlways.value) {
    workspaceStore.updateSettings({ defaultShellId: selectedShellId.value });
  }

  const session = await terminalStore.createSession({
    shellId: selectedShellId.value,
    cols: 80,
    rows: 24,
    cwd,
    name: name.value || undefined,
  });

  terminalStore.setLastTerminalConfig({
    shellId: selectedShellId.value,
    cwd: cwd || "",
    command: command.value.trim() || null,
  });

  if (command.value.trim() && autoRun.value) {
    // Wait briefly for the shell prompt to appear
    setTimeout(() => {
      terminalStore.writeToTerminal(session.id, command.value.trim() + "\r");
    }, 600);
  }

  close();
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
  customCwd.value = terminalStore.lastUsedCwd;
  name.value = "";
  command.value = "";
  autoRun.value = false;
  rememberForSession.value = false;
  rememberAlways.value = false;
  showSavePreset.value = false;
  savePresetName.value = "";
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
        <button class="dialog-close" @click="close">&#215;</button>
      </div>

      <div class="dialog-body">
        <!-- Shell picker -->
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

        <!-- Working directory -->
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

        <!-- Name -->
        <div class="form-group">
          <label>Name (optional)</label>
          <input
            v-model="name"
            class="tc-input"
            placeholder="My Terminal"
            type="text"
          />
        </div>

        <!-- Startup command -->
        <div class="form-group">
          <div class="command-header">
            <label>Startup Command</label>
            <label class="auto-run-label">
              <input v-model="autoRun" type="checkbox" />
              <span>Auto-run</span>
            </label>
          </div>
          <div class="command-row">
            <input
              v-model="command"
              class="tc-input command-input"
              placeholder="e.g. npm run dev"
              type="text"
            />
            <button
              v-if="command.trim() && !showSavePreset"
              class="tc-btn save-preset-btn"
              title="Save as preset"
              @click="startSavePreset"
            >
              +
            </button>
          </div>

          <!-- Save preset inline -->
          <div v-if="showSavePreset" class="save-preset-row">
            <input
              v-model="savePresetName"
              class="tc-input"
              placeholder="Preset name"
              type="text"
              @keydown.enter="confirmSavePreset"
            />
            <button class="tc-btn" @click="confirmSavePreset">Save</button>
            <button class="tc-btn" @click="showSavePreset = false">Cancel</button>
          </div>

          <!-- Preset chips -->
          <div v-if="terminalStore.commandPresets.length > 0" class="preset-chips">
            <button
              v-for="preset in terminalStore.commandPresets"
              :key="preset.id"
              class="preset-chip"
              :class="{ active: command.trim() === preset.command }"
              @click="applyPreset(preset.command)"
            >
              <span class="chip-name">{{ preset.name }}</span>
              <span
                v-if="!preset.id.startsWith('default-')"
                class="chip-remove"
                @click="removePreset(preset.id, $event)"
              >
                &#215;
              </span>
            </button>
          </div>
        </div>

        <!-- Default checkboxes -->
        <div class="form-group checkbox-group">
          <label class="form-checkbox">
            <input v-model="rememberForSession" type="checkbox" />
            <span>Always use this shell for this session</span>
          </label>
          <label class="form-checkbox">
            <input v-model="rememberAlways" type="checkbox" />
            <span>Always use this shell (save to workspace)</span>
          </label>
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
  min-width: 440px;
  max-width: 90vw;
  max-height: 90vh;
  overflow-y: auto;
  box-shadow: var(--tc-shadow-lg);
}

.dialog-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 18px;
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
  padding: 18px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 18px;
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
  padding: 6px 14px;
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

.command-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.auto-run-label {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: var(--tc-font-size-sm);
  color: var(--tc-text-secondary);
  font-weight: 400;
  cursor: pointer;
}

.auto-run-label input[type="checkbox"] {
  width: 14px;
  height: 14px;
  accent-color: var(--tc-accent);
}

.command-row {
  display: flex;
  gap: 8px;
  align-items: center;
}

.command-input {
  flex: 1;
}

.save-preset-btn {
  padding: 6px 10px;
  border: 1px solid var(--tc-border-color);
  border-radius: var(--tc-border-radius-sm);
  background: var(--tc-bg-secondary);
  color: var(--tc-text-secondary);
  font-size: 16px;
  cursor: pointer;
  transition: all var(--tc-transition-fast);
  font-family: var(--tc-font-sans);
}

.save-preset-btn:hover {
  background: var(--tc-bg-hover);
  color: var(--tc-text-primary);
  border-color: var(--tc-border-focus);
}

.save-preset-row {
  display: flex;
  gap: 8px;
  align-items: center;
}

.save-preset-row .tc-input {
  flex: 1;
}

.preset-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 4px;
}

.preset-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  border: 1px solid var(--tc-border-color);
  border-radius: var(--tc-border-radius-sm);
  background: var(--tc-bg-secondary);
  color: var(--tc-text-secondary);
  cursor: pointer;
  font-size: var(--tc-font-size-xs);
  transition: all var(--tc-transition-fast);
  font-family: var(--tc-font-sans);
}

.preset-chip:hover {
  border-color: var(--tc-border-focus);
  color: var(--tc-text-primary);
}

.preset-chip.active {
  border-color: var(--tc-accent);
  background: var(--tc-accent-soft);
  color: var(--tc-accent);
}

.chip-name {
  white-space: nowrap;
}

.chip-remove {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  font-size: 10px;
  line-height: 1;
  color: var(--tc-text-muted);
}

.chip-remove:hover {
  background: var(--tc-error);
  color: white;
}

.checkbox-group {
  gap: 10px;
  margin-top: 2px;
}

.form-checkbox {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  font-size: var(--tc-font-size-sm);
  color: var(--tc-text-primary);
}

.form-checkbox input[type="checkbox"] {
  width: 16px;
  height: 16px;
  accent-color: var(--tc-accent);
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
</style>
