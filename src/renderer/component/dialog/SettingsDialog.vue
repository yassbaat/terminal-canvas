<script setup lang="ts">
import { ref, onMounted } from "vue";
import { toRaw } from "vue";
import { useTerminalStore } from "@renderer/store/terminal";
import { useWorkspaceStore } from "@renderer/store/workspace";
import { useUIStore } from "@renderer/store/ui";
import { useLaunchProfileStore } from "@renderer/store/launchProfile";
import type { GroqSettings } from "@renderer/type/groq";
import { X } from "lucide-vue-next";

const props = defineProps<{
  open: boolean;
}>();

const emit = defineEmits<{
  (e: "update:open", value: boolean): void;
}>();

const terminalStore = useTerminalStore();
const workspaceStore = useWorkspaceStore();
const uiStore = useUIStore();
const launchProfileStore = useLaunchProfileStore();

const activeTab = ref<"general" | "launch" | "groq" | "system">("general");

// Launch profile management
const newProfileLabel = ref("");
const newProfileCommand = ref("");
const editingProfileId = ref<string | null>(null);
const editLabel = ref("");
const editCommand = ref("");

function addProfile() {
  const label = newProfileLabel.value.trim();
  const command = newProfileCommand.value.trim();
  if (!label || !command) return;
  launchProfileStore.addCustomProfile(label, command);
  newProfileLabel.value = "";
  newProfileCommand.value = "";
}

function startEditProfile(id: string, label: string, command: string) {
  editingProfileId.value = id;
  editLabel.value = label;
  editCommand.value = command;
}

function saveEditProfile() {
  if (!editingProfileId.value) return;
  const label = editLabel.value.trim();
  const command = editCommand.value.trim();
  if (label && command) {
    launchProfileStore.updateCustomProfile(editingProfileId.value, { label, command });
  }
  editingProfileId.value = null;
}

function cancelEditProfile() {
  editingProfileId.value = null;
}

// General settings
const defaultShellId = ref("");
const defaultTermWidth = ref(900);
const defaultTermHeight = ref(640);

const SIZE_PRESETS = [
  { label: "Small", width: 640, height: 480 },
  { label: "Medium", width: 900, height: 640 },
  { label: "Large", width: 1200, height: 840 },
];

function applySizePreset(preset: { width: number; height: number }) {
  defaultTermWidth.value = preset.width;
  defaultTermHeight.value = preset.height;
}

// Groq settings
const groqSettings = ref<GroqSettings>({
  apiKey: "",
  baseUrl: "https://api.groq.com/openai/v1",
  model: "openai/gpt-oss-20b",
  temperature: 0.1,
  maxTokens: 256,
  enabled: true,
});
const testingGroq = ref(false);
const groqTestResult = ref<string | null>(null);

// System integration
const contextMenuRegistered = ref(false);
const contextMenuLoading = ref(false);
const isWindows = window.api?.platform === "win32";
const isMac = window.api?.platform === "darwin";

onMounted(async () => {
  // Load groq settings
  try {
    const saved = await window.api.groq.getSettings();
    if (saved) {
      groqSettings.value = { ...groqSettings.value, ...saved };
    }
  } catch {
    // use defaults
  }

  // Load general settings from workspace
  defaultShellId.value = workspaceStore.settings.defaultShellId || "";
  defaultTermWidth.value = workspaceStore.settings.defaultTerminalSize?.width || 900;
  defaultTermHeight.value = workspaceStore.settings.defaultTerminalSize?.height || 640;

  // Check context menu status
  try {
    contextMenuRegistered.value = await window.api.shell.isContextMenuRegistered();
  } catch {
    contextMenuRegistered.value = false;
  }
});

function close() {
  emit("update:open", false);
}

// Groq deprecated llama-3.1-70b-versatile (Jan 2025), mixtral-8x7b-32768
// (Mar 2025), and gemma2-9b-it (Oct 2025) -- all now error in production.
// llama-3.1-8b-instant and llama-3.3-70b-versatile are also deprecated as
// of 2026-08-16, with openai/gpt-oss-20b and openai/gpt-oss-120b as Groq's
// recommended replacements. See https://console.groq.com/docs/deprecations
const GROQ_MODELS = [
  { value: "openai/gpt-oss-20b", label: "GPT-OSS 20B (fast, recommended default)" },
  { value: "openai/gpt-oss-120b", label: "GPT-OSS 120B (more capable)" },
  { value: "qwen/qwen3.6-27b", label: "Qwen 3.6 27B" },
];

function plainGroqSettings(): GroqSettings {
  // Strip Vue proxies so the object can cross the IPC boundary
  return JSON.parse(JSON.stringify(toRaw(groqSettings.value)));
}

async function saveAll() {
  // Save Groq settings
  try {
    await window.api.groq.updateSettings(plainGroqSettings());
  } catch {
    // ignore
  }

  // Save workspace settings
  workspaceStore.updateSettings({
    defaultShellId: defaultShellId.value || null,
    defaultTerminalSize: {
      width: Math.max(300, defaultTermWidth.value || 900),
      height: Math.max(200, defaultTermHeight.value || 640),
    },
  });

  close();
}

async function testGroq() {
  testingGroq.value = true;
  groqTestResult.value = null;
  try {
    await window.api.groq.updateSettings(plainGroqSettings());
    const result = await window.api.groq.testConnection();
    groqTestResult.value = result.success
      ? `✓ ${result.message}`
      : `✗ ${result.message}`;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    groqTestResult.value = `✗ Error: ${msg}`;
  } finally {
    testingGroq.value = false;
  }
}

async function toggleContextMenu() {
  contextMenuLoading.value = true;
  try {
    if (contextMenuRegistered.value) {
      const result = await window.api.shell.unregisterContextMenu();
      if (result.success) {
        contextMenuRegistered.value = false;
      }
    } else {
      const result = await window.api.shell.registerContextMenu();
      if (result.success) {
        contextMenuRegistered.value = true;
      } else {
        alert(`Failed to register context menu: ${result.error || "Unknown error"}`);
      }
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    alert(`Error: ${msg}`);
  } finally {
    contextMenuLoading.value = false;
  }
}
</script>

<template>
  <div v-if="open" class="dialog-overlay" @click="close">
    <div class="dialog" @click.stop>
      <div class="dialog-header">
        <h3>Settings</h3>
        <button class="dialog-close" @click="close"><X :size="16" /></button>
      </div>

      <div class="dialog-tabs">
        <button
          class="dialog-tab"
          :class="{ active: activeTab === 'general' }"
          @click="activeTab = 'general'"
        >
          General
        </button>
        <button
          class="dialog-tab"
          :class="{ active: activeTab === 'launch' }"
          @click="activeTab = 'launch'"
        >
          Launch Profiles
        </button>
        <button
          class="dialog-tab"
          :class="{ active: activeTab === 'groq' }"
          @click="activeTab = 'groq'"
        >
          Groq
        </button>
        <button
          class="dialog-tab"
          :class="{ active: activeTab === 'system' }"
          @click="activeTab = 'system'"
        >
          System Integration
        </button>
      </div>

      <div class="dialog-body">
        <!-- General Tab -->
        <div v-if="activeTab === 'general'" class="tab-panel">
          <div class="form-group">
            <label>Default Shell</label>
            <select v-model="defaultShellId" class="tc-input">
              <option value="">Auto (first available)</option>
              <option
                v-for="shell in terminalStore.shells"
                :key="shell.id"
                :value="shell.id"
              >
                {{ shell.name }}
              </option>
            </select>
            <span class="form-hint">
              Used when creating quick terminals and during onboarding.
            </span>
          </div>

          <div class="form-group">
            <label>Default Terminal Size</label>
            <span class="form-hint">
              The canvas box size new terminals spawn at. Terminals still
              resize to fit whatever box size you drag them to afterward.
            </span>
            <div class="size-preset-row">
              <button
                v-for="preset in SIZE_PRESETS"
                :key="preset.label"
                type="button"
                class="tc-btn"
                :class="{
                  'tc-btn-primary':
                    defaultTermWidth === preset.width && defaultTermHeight === preset.height,
                }"
                @click="applySizePreset(preset)"
              >
                {{ preset.label }}
              </button>
            </div>
            <div class="form-row" style="margin-top: 6px;">
              <div class="form-group">
                <label>Width (px)</label>
                <input v-model.number="defaultTermWidth" class="tc-input" type="number" min="300" step="20" />
              </div>
              <div class="form-group">
                <label>Height (px)</label>
                <input v-model.number="defaultTermHeight" class="tc-input" type="number" min="200" step="20" />
              </div>
            </div>
          </div>

          <div class="form-group">
            <label>Terminal Header Style</label>
            <span class="form-hint">
              How much detail each terminal's header bar shows.
            </span>
            <div class="size-preset-row">
              <button
                v-for="style in (['comfortable', 'compact', 'minimal'] as const)"
                :key="style"
                type="button"
                class="tc-btn"
                :class="{ 'tc-btn-primary': uiStore.headerStyle === style }"
                @click="uiStore.setHeaderStyle(style)"
              >
                {{ style.charAt(0).toUpperCase() + style.slice(1) }}
              </button>
            </div>
          </div>

          <div class="form-group">
            <label>Attention Notifications</label>
            <span class="form-hint">
              Flags a terminal (canvas badge, layer badge, and the bell
              counter in the toolbar) when it's been busy for a while and
              then goes quiet, or when it rings the terminal bell -- the
              usual signal that a command or coding agent has finished.
            </span>
            <label class="form-checkbox" style="margin-top: 6px;">
              <input
                :checked="!uiStore.soundMuted"
                type="checkbox"
                @change="uiStore.setSoundMuted(!($event.target as HTMLInputElement).checked)"
              />
              <span>Play a sound</span>
            </label>
            <div class="form-row" style="margin-top: 6px;">
              <div class="form-group">
                <label>Notify after running for at least</label>
                <div class="cwd-input-row">
                  <input
                    :value="uiStore.idleThresholdSeconds"
                    class="tc-input"
                    type="number"
                    min="0"
                    step="1"
                    style="max-width: 90px;"
                    @change="uiStore.setIdleThresholdSeconds(Number(($event.target as HTMLInputElement).value))"
                  />
                  <span class="form-hint">seconds</span>
                </div>
                <span class="form-hint">
                  Quick commands (like `ls`) never notify; only genuinely
                  long-running ones do. Set to 0 to notify on every command.
                </span>
              </div>
            </div>
          </div>
        </div>

        <!-- Launch Profiles Tab -->
        <div v-if="activeTab === 'launch'" class="tab-panel">
          <div class="form-group">
            <label>Built-in Providers</label>
            <span class="form-hint">
              Available when creating a new terminal -- pick one to have its
              command typed and submitted automatically once the shell is ready.
            </span>
            <div class="profile-list">
              <div
                v-for="profile in launchProfileStore.builtInProfiles"
                :key="profile.id"
                class="profile-row"
              >
                <component :is="profile.icon" class="profile-row-glyph" :size="13" :style="{ color: profile.color }" />
                <span class="profile-row-label">{{ profile.label }}</span>
                <span class="profile-row-command">{{ profile.command || "(no auto-run)" }}</span>
              </div>
            </div>
          </div>

          <div class="form-group">
            <label>Custom Providers &amp; Commands</label>
            <span class="form-hint">
              Add your own auto-run shortcuts -- a different agent CLI, a venv
              activation, a dev-server start command, anything you type often.
            </span>
            <div class="profile-list">
              <div
                v-for="profile in launchProfileStore.customProfiles"
                :key="profile.id"
                class="profile-row"
              >
                <template v-if="editingProfileId === profile.id">
                  <input v-model="editLabel" class="tc-input profile-edit-input" placeholder="Label" />
                  <input v-model="editCommand" class="tc-input profile-edit-input" placeholder="Command" />
                  <button class="tc-btn tc-btn-primary" @click="saveEditProfile">Save</button>
                  <button class="tc-btn" @click="cancelEditProfile">Cancel</button>
                </template>
                <template v-else>
                  <component :is="profile.icon" class="profile-row-glyph" :size="13" :style="{ color: profile.color }" />
                  <span class="profile-row-label">{{ profile.label }}</span>
                  <span class="profile-row-command">{{ profile.command }}</span>
                  <button class="tc-btn" @click="startEditProfile(profile.id, profile.label, profile.command)">Edit</button>
                  <button class="tc-btn" @click="launchProfileStore.removeCustomProfile(profile.id)">Delete</button>
                </template>
              </div>
              <div v-if="launchProfileStore.customProfiles.length === 0" class="profile-row-empty">
                No custom providers yet.
              </div>
            </div>
            <div class="profile-add-row">
              <input v-model="newProfileLabel" class="tc-input" placeholder="Label (e.g. My Agent)" />
              <input v-model="newProfileCommand" class="tc-input" placeholder="Command (e.g. my-agent --flag)" />
              <button class="tc-btn tc-btn-primary" @click="addProfile">Add</button>
            </div>
          </div>
        </div>

        <!-- Groq Tab -->
        <div v-if="activeTab === 'groq'" class="tab-panel">
          <div class="form-group">
            <label class="form-checkbox">
              <input v-model="groqSettings.enabled" type="checkbox" />
              <span>Enable Auto-Naming</span>
            </label>
          </div>

          <div class="form-group">
            <label>API Key</label>
            <input
              v-model="groqSettings.apiKey"
              class="tc-input"
              placeholder="gsk_..."
              type="password"
            />
            <span class="form-hint">Leave empty to use GROQ_API_KEY env var</span>
          </div>

          <div class="form-group">
            <label>Base URL</label>
            <input v-model="groqSettings.baseUrl" class="tc-input" type="text" />
          </div>

          <div class="form-group">
            <label>Model</label>
            <select v-model="groqSettings.model" class="tc-input">
              <option v-for="m in GROQ_MODELS" :key="m.value" :value="m.value">
                {{ m.label }}
              </option>
            </select>
          </div>

          <div class="form-row">
            <div class="form-group">
              <label>Temperature</label>
              <input
                v-model.number="groqSettings.temperature"
                class="tc-input"
                type="number"
                step="0.1"
                min="0"
                max="1"
              />
            </div>
            <div class="form-group">
              <label>Max Tokens</label>
              <input
                v-model.number="groqSettings.maxTokens"
                class="tc-input"
                type="number"
                min="16"
                max="1024"
              />
            </div>
          </div>

          <div
            v-if="groqTestResult"
            class="test-result"
            :class="{
              success: groqTestResult.startsWith('✓'),
              error: groqTestResult.startsWith('✗'),
            }"
          >
            {{ groqTestResult }}
          </div>
        </div>

        <!-- System Integration Tab -->
        <div v-if="activeTab === 'system'" class="tab-panel">
          <div v-if="isWindows" class="system-section">
            <h4 class="system-heading">Windows Explorer Context Menu</h4>
            <p class="system-desc">
              Add "Open in Terminal Canvas" to your right-click menu in Windows
              Explorer. This lets you open any folder directly in a new terminal.
            </p>
            <div class="system-status">
              <span
                class="status-dot"
                :class="contextMenuRegistered ? 'active' : 'inactive'"
              />
              <span class="status-text">
                {{ contextMenuRegistered ? "Registered" : "Not registered" }}
              </span>
            </div>
            <button
              class="tc-btn tc-btn-primary"
              :disabled="contextMenuLoading"
              @click="toggleContextMenu"
            >
              {{ contextMenuLoading
                ? "Working..."
                : contextMenuRegistered
                  ? "Remove from Context Menu"
                  : "Add to Context Menu" }}
            </button>
          </div>
          <div v-else-if="isMac" class="system-section">
            <h4 class="system-heading">Finder Quick Action</h4>
            <p class="system-desc">
              Add "Open in Terminal Canvas" to the right-click menu for folders
              in Finder (under Quick Actions / Services). Only works from the
              installed app in /Applications, not a dev build.
            </p>
            <div class="system-status">
              <span
                class="status-dot"
                :class="contextMenuRegistered ? 'active' : 'inactive'"
              />
              <span class="status-text">
                {{ contextMenuRegistered ? "Registered" : "Not registered" }}
              </span>
            </div>
            <button
              class="tc-btn tc-btn-primary"
              :disabled="contextMenuLoading"
              @click="toggleContextMenu"
            >
              {{ contextMenuLoading
                ? "Working..."
                : contextMenuRegistered
                  ? "Remove from Finder"
                  : "Add to Finder" }}
            </button>
          </div>
          <div v-else class="system-section">
            <h4 class="system-heading">Right-Click Integration</h4>
            <p class="system-desc">
              Right-click-to-open-here integration is only available on
              Windows and macOS. Use the "Open" button in the toolbar or drag
              a folder onto the canvas instead.
            </p>
          </div>
        </div>
      </div>

      <div class="dialog-footer">
        <button class="tc-btn" @click="close">Cancel</button>
        <button
          v-if="activeTab === 'groq'"
          class="tc-btn"
          :disabled="testingGroq"
          @click="testGroq"
        >
          {{ testingGroq ? "Testing..." : "Test Connection" }}
        </button>
        <button class="tc-btn tc-btn-primary" @click="saveAll">Save</button>
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
  min-width: 480px;
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

.dialog-tabs {
  display: flex;
  border-bottom: 1px solid var(--tc-border-color);
  flex-shrink: 0;
  padding: 0 18px;
  gap: 4px;
}

.dialog-tab {
  padding: 10px 14px;
  border: none;
  background: transparent;
  color: var(--tc-text-muted);
  font-size: var(--tc-font-size-sm);
  cursor: pointer;
  transition: all var(--tc-transition-fast);
  font-family: var(--tc-font-sans);
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
}

.dialog-tab:hover {
  color: var(--tc-text-secondary);
}

.dialog-tab.active {
  color: var(--tc-accent);
  border-bottom-color: var(--tc-accent);
}

.dialog-body {
  padding: 18px;
  display: flex;
  flex-direction: column;
  gap: 14px;
  overflow-y: auto;
  flex: 1;
}

.tab-panel {
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
  flex-shrink: 0;
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

.form-row {
  display: flex;
  gap: 12px;
}

.size-preset-row {
  display: flex;
  gap: 6px;
}

.form-row .form-group {
  flex: 1;
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

.form-hint {
  font-size: var(--tc-font-size-xs);
  color: var(--tc-text-muted);
}

.tc-input {
  width: 100%;
  padding: 6px 10px;
  border: 1px solid var(--tc-border-color);
  border-radius: var(--tc-border-radius-sm);
  background: var(--tc-bg-secondary);
  color: var(--tc-text-primary);
  font-size: var(--tc-font-size-base);
  font-family: var(--tc-font-sans);
  outline: none;
  transition: border-color var(--tc-transition-fast);
}

.tc-input:focus {
  border-color: var(--tc-accent);
}

.test-result {
  padding: 8px 12px;
  border-radius: var(--tc-border-radius-sm);
  font-size: var(--tc-font-size-sm);
}

.test-result.success {
  background: var(--tc-success-soft);
  color: var(--tc-success);
  border: 1px solid rgba(78, 204, 163, 0.2);
}

.test-result.error {
  background: var(--tc-accent-soft);
  color: var(--tc-error);
  border: 1px solid rgba(233, 69, 96, 0.2);
}

.system-section {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.profile-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.profile-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border: 1px solid var(--tc-border-color);
  border-radius: var(--tc-border-radius-sm);
  background: var(--tc-bg-secondary);
}

.profile-row-glyph {
  font-size: 13px;
  line-height: 1;
  flex-shrink: 0;
  width: 16px;
  text-align: center;
}

.profile-row-label {
  font-size: var(--tc-font-size-sm);
  color: var(--tc-text-primary);
  font-weight: 500;
  flex-shrink: 0;
  min-width: 110px;
}

.profile-row-command {
  font-size: var(--tc-font-size-xs);
  color: var(--tc-text-muted);
  font-family: var(--tc-font-mono);
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.profile-row-empty {
  font-size: var(--tc-font-size-sm);
  color: var(--tc-text-muted);
  padding: 6px 8px;
}

.profile-edit-input {
  flex: 1;
}

.profile-add-row {
  display: flex;
  gap: 8px;
  margin-top: 6px;
}

.profile-add-row .tc-input {
  flex: 1;
}

.system-heading {
  font-size: var(--tc-font-size-sm);
  font-weight: 600;
  color: var(--tc-text-primary);
}

.system-desc {
  font-size: var(--tc-font-size-sm);
  color: var(--tc-text-secondary);
  line-height: var(--tc-line-height-normal);
}

.system-status {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: var(--tc-font-size-sm);
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}

.status-dot.active {
  background: var(--tc-success);
}

.status-dot.inactive {
  background: var(--tc-text-muted);
}

.status-text {
  color: var(--tc-text-secondary);
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
