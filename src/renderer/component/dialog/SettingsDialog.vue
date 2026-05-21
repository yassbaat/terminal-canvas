<script setup lang="ts">
import { ref, onMounted } from "vue";
import { toRaw } from "vue";
import { useTerminalStore } from "@renderer/store/terminal";
import { useWorkspaceStore } from "@renderer/store/workspace";
import type { GroqSettings } from "@renderer/type/groq";

const props = defineProps<{
  open: boolean;
}>();

const emit = defineEmits<{
  (e: "update:open", value: boolean): void;
}>();

const terminalStore = useTerminalStore();
const workspaceStore = useWorkspaceStore();

const activeTab = ref<"general" | "groq" | "system">("general");

// General settings
const defaultShellId = ref("");

// Groq settings
const groqSettings = ref<GroqSettings>({
  apiKey: "",
  baseUrl: "https://api.groq.com/openai/v1",
  model: "llama-3.1-8b-instant",
  temperature: 0.1,
  maxTokens: 256,
  enabled: true,
});
const testingGroq = ref(false);
const groqTestResult = ref<string | null>(null);

// System integration
const contextMenuRegistered = ref(false);
const contextMenuLoading = ref(false);

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

const GROQ_MODELS = [
  { value: "llama-3.1-8b-instant", label: "Llama 3.1 8B Instant" },
  { value: "llama-3.3-70b-versatile", label: "Llama 3.3 70B Versatile" },
  { value: "llama-3.1-70b-versatile", label: "Llama 3.1 70B Versatile" },
  { value: "mixtral-8x7b-32768", label: "Mixtral 8x7B" },
  { value: "gemma2-9b-it", label: "Gemma 2 9B" },
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
        <button class="dialog-close" @click="close">&times;</button>
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
          <div class="system-section">
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
  background: rgba(78, 204, 163, 0.1);
  color: var(--tc-success);
  border: 1px solid rgba(78, 204, 163, 0.2);
}

.test-result.error {
  background: rgba(233, 69, 96, 0.1);
  color: var(--tc-error);
  border: 1px solid rgba(233, 69, 96, 0.2);
}

.system-section {
  display: flex;
  flex-direction: column;
  gap: 12px;
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
