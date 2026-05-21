<script setup lang="ts">
import { ref, onMounted } from "vue";
import type { GroqSettings } from "@renderer/type/groq";

const props = defineProps<{
  open: boolean;
}>();

const emit = defineEmits<{
  (e: "update:open", value: boolean): void;
}>();

const settings = ref<GroqSettings>({
  apiKey: "",
  baseUrl: "https://api.groq.com/openai/v1",
  model: "llama-3.1-8b-instant",
  temperature: 0.1,
  maxTokens: 256,
  enabled: true,
});

const testing = ref(false);
const testResult = ref<string | null>(null);

onMounted(async () => {
  try {
    const saved = await window.api.groq.getSettings();
    if (saved) {
      settings.value = { ...settings.value, ...saved };
    }
  } catch {
    // Use defaults
  }
});

async function save() {
  await window.api.groq.updateSettings(settings.value);
  emit("update:open", false);
}

async function testConnection() {
  testing.value = true;
  testResult.value = null;
  try {
    const result = await window.api.groq.testConnection();
    testResult.value = result.success ? `✓ ${result.message}` : `✗ ${result.message}`;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    testResult.value = `✗ Error: ${msg}`;
  } finally {
    testing.value = false;
  }
}

function close() {
  emit("update:open", false);
}
</script>

<template>
  <div v-if="open" class="dialog-overlay" @click="close">
    <div class="dialog" @click.stop>
      <div class="dialog-header">
        <h3>Groq Settings</h3>
        <button class="dialog-close" @click="close">&times;</button>
      </div>
      
      <div class="dialog-body">
        <div class="form-group">
          <label class="form-checkbox">
            <input v-model="settings.enabled" type="checkbox" />
            <span>Enable Auto-Naming</span>
          </label>
        </div>
        
        <div class="form-group">
          <label>API Key</label>
          <input
            v-model="settings.apiKey"
            class="tc-input"
            placeholder="gsk_..."
            type="password"
          />
          <span class="form-hint">Leave empty to use GROQ_API_KEY env var</span>
        </div>
        
        <div class="form-group">
          <label>Base URL</label>
          <input v-model="settings.baseUrl" class="tc-input" type="text" />
        </div>
        
        <div class="form-group">
          <label>Model</label>
          <input v-model="settings.model" class="tc-input" placeholder="llama-3.1-8b-instant" type="text" />
          <span class="form-hint">e.g., llama-3.1-8b-instant, llama-3.3-70b-versatile</span>
        </div>
        
        <div class="form-row">
          <div class="form-group">
            <label>Temperature</label>
            <input v-model.number="settings.temperature" class="tc-input" type="number" step="0.1" min="0" max="1" />
          </div>
          <div class="form-group">
            <label>Max Tokens</label>
            <input v-model.number="settings.maxTokens" class="tc-input" type="number" min="16" max="1024" />
          </div>
        </div>
        
        <div v-if="testResult" class="test-result" :class="{ success: testResult.startsWith('✓'), error: testResult.startsWith('✗') }">
          {{ testResult }}
        </div>
      </div>
      
      <div class="dialog-footer">
        <button class="tc-btn" @click="close">Cancel</button>
        <button class="tc-btn" :disabled="testing" @click="testConnection">
          {{ testing ? "Testing..." : "Test Connection" }}
        </button>
        <button class="tc-btn tc-btn-primary" @click="save">Save</button>
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
  min-width: 420px;
  max-width: 90vw;
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
</style>
