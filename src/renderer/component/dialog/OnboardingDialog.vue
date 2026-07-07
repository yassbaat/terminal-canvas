<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { toRaw } from "vue";
import { useTerminalStore } from "@renderer/store/terminal";
import { useWorkspaceStore } from "@renderer/store/workspace";
import { useUIStore } from "@renderer/store/ui";
import type { GroqSettings } from "@renderer/type/groq";

const terminalStore = useTerminalStore();
const workspaceStore = useWorkspaceStore();
const uiStore = useUIStore();

const step = ref(0);
const selectedShellId = ref("");
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

const totalSteps = 5;

const canProceed = computed(() => {
  if (step.value === 1) return !!selectedShellId.value;
  return true;
});

onMounted(() => {
  if (terminalStore.shells.length > 0 && !selectedShellId.value) {
    selectedShellId.value = terminalStore.shells[0].id;
  }
});

function next() {
  if (step.value < totalSteps - 1) {
    step.value++;
  }
}

function back() {
  if (step.value > 0) {
    step.value--;
  }
}

function skip() {
  step.value = totalSteps - 1;
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

async function saveGroqAndContinue() {
  try {
    await window.api.groq.updateSettings(plainGroqSettings());
  } catch {
    // ignore
  }
  next();
}

async function finish() {
  // Save default shell preference to workspace settings
  if (selectedShellId.value) {
    workspaceStore.updateSettings({ defaultShellId: selectedShellId.value });
  }

  // Mark onboarding as complete
  localStorage.setItem("terminal-canvas:onboarded", "true");

  // Create a first terminal (skip if no shell is available yet rather than
  // falling back to a Windows-only id like "cmd" that doesn't exist on
  // macOS/Linux and would throw "Shell not found").
  const shellId = selectedShellId.value || terminalStore.shells[0]?.id;
  if (shellId) {
    await terminalStore.createSession({ shellId, cols: 80, rows: 24 });
  }

  uiStore.closeOnboarding();
}

function finishWithoutTerminal() {
  if (selectedShellId.value) {
    workspaceStore.updateSettings({ defaultShellId: selectedShellId.value });
  }
  localStorage.setItem("terminal-canvas:onboarded", "true");
  uiStore.closeOnboarding();
}
</script>

<template>
  <div v-if="uiStore.onboardingOpen" class="onboarding-overlay">
    <div class="onboarding-card">
      <!-- Progress dots -->
      <div class="onboarding-progress">
        <div
          v-for="i in totalSteps"
          :key="i"
          class="progress-dot"
          :class="{ active: i - 1 === step, completed: i - 1 < step }"
        />
      </div>

      <!-- Step 0: Welcome -->
      <div v-if="step === 0" class="onboarding-step">
        <div class="step-icon">◆</div>
        <h2 class="step-title">Welcome to Terminal Canvas</h2>
        <p class="step-desc">
          Your infinite canvas for coding-agent terminals. Pan, zoom, group, and
          remember every prompt — all in one place.
        </p>
        <div class="step-features">
          <div class="feature">
            <span class="feature-icon">⊞</span>
            <span>Infinite canvas with pan & zoom</span>
          </div>
          <div class="feature">
            <span class="feature-icon">⌨</span>
            <span>Embedded real terminals (PowerShell, Bash, WSL)</span>
          </div>
          <div class="feature">
            <span class="feature-icon">🧠</span>
            <span>Agent Memory — every prompt you type is captured</span>
          </div>
          <div class="feature">
            <span class="feature-icon">✨</span>
            <span>AI auto-naming powered by Groq</span>
          </div>
        </div>
      </div>

      <!-- Step 1: Default Shell -->
      <div v-else-if="step === 1" class="onboarding-step">
        <h2 class="step-title">Choose Your Default Shell</h2>
        <p class="step-desc">
          Pick the shell you use most often. You can always create terminals with
          other shells later.
        </p>
        <div class="shell-grid">
          <button
            v-for="shell in terminalStore.shells"
            :key="shell.id"
            class="shell-card"
            :class="{ active: selectedShellId === shell.id }"
            @click="selectedShellId = shell.id"
          >
            <div class="shell-name">{{ shell.name }}</div>
            <div class="shell-path">{{ shell.path }}</div>
          </button>
        </div>
      </div>

      <!-- Step 2: Groq API Key -->
      <div v-else-if="step === 2" class="onboarding-step">
        <h2 class="step-title">Groq Auto-Naming</h2>
        <p class="step-desc">
          Terminal Canvas can automatically name your sessions using Groq AI — so
          "Terminal 1" becomes "Zoy API Dev Server". Completely optional.
        </p>

        <div class="form-group">
          <label class="form-checkbox">
            <input v-model="groqSettings.enabled" type="checkbox" />
            <span>Enable AI-powered auto-naming</span>
          </label>
        </div>

        <div v-if="groqSettings.enabled" class="groq-form">
          <div class="form-group">
            <label>API Key</label>
            <input
              v-model="groqSettings.apiKey"
              class="tc-input"
              placeholder="gsk_..."
              type="password"
            />
            <span class="form-hint">
              Get your key at
              <a href="https://console.groq.com" target="_blank">console.groq.com</a>
              — or leave blank to use GROQ_API_KEY env var later.
            </span>
          </div>

          <div class="form-group">
            <label>Model</label>
            <select v-model="groqSettings.model" class="tc-input">
              <option v-for="m in GROQ_MODELS" :key="m.value" :value="m.value">
                {{ m.label }}
              </option>
            </select>
          </div>

          <div v-if="groqTestResult" class="test-result" :class="{ success: groqTestResult.startsWith('✓'), error: groqTestResult.startsWith('✗') }">
            {{ groqTestResult }}
          </div>
        </div>
      </div>

      <!-- Step 3: Tips -->
      <div v-else-if="step === 3" class="onboarding-step">
        <h2 class="step-title">Quick Tips</h2>
        <div class="tips-list">
          <div class="tip">
            <span class="tip-key">Ctrl + N</span>
            <span class="tip-desc">Create a new terminal instantly</span>
          </div>
          <div class="tip">
            <span class="tip-key">Ctrl + S</span>
            <span class="tip-desc">Save your workspace layout</span>
          </div>
          <div class="tip">
            <span class="tip-key">Scroll</span>
            <span class="tip-desc">Zoom the canvas in and out</span>
          </div>
          <div class="tip">
            <span class="tip-key">Space + drag</span>
            <span class="tip-desc">Pan around the infinite canvas</span>
          </div>
          <div class="tip">
            <span class="tip-key">Esc</span>
            <span class="tip-desc">Unfocus terminal and return to canvas mode</span>
          </div>
          <div class="tip">
            <span class="tip-key">Click terminal</span>
            <span class="tip-desc">Focus it to type; drag the header to move</span>
          </div>
        </div>
      </div>

      <!-- Step 4: Finish -->
      <div v-else-if="step === 4" class="onboarding-step">
        <div class="step-icon">🚀</div>
        <h2 class="step-title">You're All Set</h2>
        <p class="step-desc">
          Terminal Canvas is ready. Create your first terminal and start building.
        </p>
      </div>

      <!-- Navigation -->
      <div class="onboarding-nav">
        <button v-if="step > 0" class="tc-btn" @click="back">Back</button>
        <div class="nav-spacer" />
        <button
          v-if="step < totalSteps - 1 && step !== 2"
          class="tc-btn tc-btn-primary"
          :disabled="!canProceed"
          @click="next"
        >
          Next
        </button>
        <button
          v-if="step === 2"
          class="tc-btn"
          @click="skip"
        >
          Skip
        </button>
        <button
          v-if="step === 2"
          class="tc-btn tc-btn-primary"
          :disabled="testingGroq"
          @click="saveGroqAndContinue"
        >
          {{ testingGroq ? "Testing..." : "Continue" }}
        </button>
        <button
          v-if="step === 2 && groqSettings.enabled && groqSettings.apiKey"
          class="tc-btn"
          :disabled="testingGroq"
          @click="testGroq"
        >
          Test Connection
        </button>
        <button
          v-if="step === totalSteps - 1"
          class="tc-btn tc-btn-primary"
          @click="finish"
        >
          Create First Terminal
        </button>
        <button
          v-if="step === totalSteps - 1"
          class="tc-btn"
          @click="finishWithoutTerminal"
        >
          Skip for Now
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.onboarding-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.75);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: var(--tc-z-modal);
  backdrop-filter: blur(4px);
}

.onboarding-card {
  background: var(--tc-bg-card);
  border: 1px solid var(--tc-border-color);
  border-radius: var(--tc-border-radius);
  width: 560px;
  max-width: 92vw;
  max-height: 90vh;
  display: flex;
  flex-direction: column;
  box-shadow: var(--tc-shadow-lg);
  overflow: hidden;
}

.onboarding-progress {
  display: flex;
  justify-content: center;
  gap: 8px;
  padding: 18px 18px 6px;
  flex-shrink: 0;
}

.progress-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--tc-border-color);
  transition: all var(--tc-transition-fast);
}

.progress-dot.active {
  background: var(--tc-accent);
  width: 24px;
  border-radius: 4px;
}

.progress-dot.completed {
  background: var(--tc-success);
}

.onboarding-step {
  flex: 1;
  padding: 18px 28px;
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  overflow-y: auto;
}

.step-icon {
  font-size: 48px;
  color: var(--tc-accent);
  margin-bottom: 8px;
  line-height: 1;
}

.step-title {
  font-size: var(--tc-font-size-lg);
  font-weight: 700;
  color: var(--tc-text-primary);
  margin-bottom: 8px;
}

.step-desc {
  font-size: var(--tc-font-size-sm);
  color: var(--tc-text-secondary);
  line-height: var(--tc-line-height-normal);
  max-width: 420px;
  margin-bottom: 18px;
}

.step-features {
  display: flex;
  flex-direction: column;
  gap: 10px;
  width: 100%;
  max-width: 380px;
  text-align: left;
}

.feature {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: var(--tc-font-size-sm);
  color: var(--tc-text-primary);
  background: var(--tc-bg-secondary);
  padding: 10px 14px;
  border-radius: var(--tc-border-radius-sm);
  border: 1px solid var(--tc-border-color);
}

.feature-icon {
  font-size: 16px;
  width: 24px;
  text-align: center;
  flex-shrink: 0;
}

.shell-grid {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 100%;
  max-width: 420px;
  text-align: left;
}

.shell-card {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 12px 14px;
  border: 1px solid var(--tc-border-color);
  border-radius: var(--tc-border-radius-sm);
  background: var(--tc-bg-secondary);
  color: var(--tc-text-primary);
  cursor: pointer;
  transition: all var(--tc-transition-fast);
  text-align: left;
}

.shell-card:hover {
  border-color: var(--tc-border-focus);
}

.shell-card.active {
  border-color: var(--tc-accent);
  background: var(--tc-accent-soft);
}

.shell-name {
  font-size: var(--tc-font-size-sm);
  font-weight: 600;
}

.shell-path {
  font-size: var(--tc-font-size-xs);
  color: var(--tc-text-muted);
  font-family: var(--tc-font-mono);
}

.groq-form {
  width: 100%;
  max-width: 420px;
  display: flex;
  flex-direction: column;
  gap: 14px;
  text-align: left;
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

.form-hint a {
  color: var(--tc-accent);
  text-decoration: none;
}

.form-hint a:hover {
  text-decoration: underline;
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

.tips-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  width: 100%;
  max-width: 380px;
  text-align: left;
}

.tip {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: var(--tc-font-size-sm);
  color: var(--tc-text-primary);
  background: var(--tc-bg-secondary);
  padding: 10px 14px;
  border-radius: var(--tc-border-radius-sm);
  border: 1px solid var(--tc-border-color);
}

.tip-key {
  font-family: var(--tc-font-mono);
  font-size: var(--tc-font-size-xs);
  color: var(--tc-accent);
  background: var(--tc-accent-soft);
  padding: 3px 8px;
  border-radius: var(--tc-border-radius-sm);
  white-space: nowrap;
  flex-shrink: 0;
  min-width: 90px;
  text-align: center;
}

.tip-desc {
  color: var(--tc-text-secondary);
}

.onboarding-nav {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 14px 18px;
  border-top: 1px solid var(--tc-border-color);
  flex-shrink: 0;
}

.nav-spacer {
  flex: 1;
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
