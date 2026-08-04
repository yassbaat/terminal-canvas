<script setup lang="ts">
import { ref, onMounted, computed } from "vue";
import { toRaw } from "vue";
import { useTerminalStore } from "@renderer/store/terminal";
import { useWorkspaceStore } from "@renderer/store/workspace";
import { useUIStore } from "@renderer/store/ui";
import { useLaunchProfileStore } from "@renderer/store/launchProfile";
import type { GroqSettings } from "@renderer/type/groq";
import type { ThemePreference } from "@renderer/store/ui";
import {
  X,
  SlidersHorizontal,
  Palette,
  Bell,
  Rocket,
  Sparkles,
  MonitorCog,
  Monitor,
  Plus,
  Pencil,
  Trash2,
  Check,
} from "lucide-vue-next";

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

type SettingsTab = "general" | "appearance" | "notifications" | "launch" | "groq" | "system";
const activeTab = ref<SettingsTab>("general");

// Left-nav configuration. System integration only surfaces the actively
// supported platforms, but the tab itself always shows (it explains the
// state on other platforms).
const NAV: Array<{ id: SettingsTab; label: string; icon: unknown }> = [
  { id: "general", label: "General", icon: SlidersHorizontal },
  { id: "appearance", label: "Appearance", icon: Palette },
  { id: "notifications", label: "Notifications", icon: Bell },
  { id: "launch", label: "Launch Profiles", icon: Rocket },
  { id: "groq", label: "AI Naming", icon: Sparkles },
  { id: "system", label: "System", icon: MonitorCog },
];

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
const defaultTermHeight = ref(760);

const SIZE_PRESETS = [
  { label: "Small", width: 640, height: 480 },
  { label: "Medium", width: 900, height: 640 },
  { label: "Agent", width: 900, height: 760 },
  { label: "Large", width: 1200, height: 840 },
];

function applySizePreset(preset: { width: number; height: number }) {
  defaultTermWidth.value = preset.width;
  defaultTermHeight.value = preset.height;
}

const sizeMatchesPreset = computed(
  () => (preset: { width: number; height: number }) =>
    defaultTermWidth.value === preset.width && defaultTermHeight.value === preset.height
);

// Appearance — theme
const THEME_OPTIONS: Array<{ value: ThemePreference; label: string }> = [
  { value: "dark", label: "Dark" },
  { value: "light", label: "Light" },
  { value: "system", label: "System" },
];

// Literal (non-var()) colors for the preview cards below, since a card has
// to show what its OWN theme looks like regardless of which theme is
// currently active -- var(--tc-*) would just resolve to whatever theme the
// rest of the dialog is already in. Kept in sync with variables.css by hand;
// there are only two, so a build-time export felt like more machinery than
// the problem needs. Terminal Canvas has no per-theme syntax palette (see
// --tc-syn-* in variables.css, which is intentionally theme-independent), so
// the preview mocks a terminal prompt rather than a code editor -- an
// honest picture of what switching themes actually changes here.
const THEME_PREVIEW: Record<"dark" | "light", { bg: string; text: string; accent: string; success: string; warning: string; error: string }> = {
  dark: {
    bg: "hsl(43, 28%, 5%)",
    text: "hsl(40, 25%, 94%)",
    accent: "hsl(218, 94%, 51%)",
    success: "hsl(152, 62%, 45%)",
    warning: "hsl(38, 92%, 56%)",
    error: "hsl(356, 82%, 59%)",
  },
  light: {
    bg: "hsl(43, 30%, 97%)",
    text: "hsl(40, 25%, 12%)",
    accent: "hsl(221, 88%, 45%)",
    success: "hsl(152, 65%, 32%)",
    warning: "hsl(36, 85%, 38%)",
    error: "hsl(356, 72%, 46%)",
  },
};

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

/**
 * Forget the stored key. This needs its own action because saving a blank
 * field deliberately means "leave the key alone" -- otherwise the onboarding
 * dialog, which re-sends its settings with an empty field on every advance,
 * would wipe a key supplied via GROQ_API_KEY.
 */
async function removeApiKey(): Promise<void> {
  await window.api.groq.clearApiKey();
  groqSettings.value.apiKey = "";
  groqTestResult.value = null;
  uiStore.showToast("Groq API key removed");
}

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
  defaultTermHeight.value = workspaceStore.settings.defaultTerminalSize?.height || 760;

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
      height: Math.max(200, defaultTermHeight.value || 760),
    },
  });

  uiStore.showToast("Settings saved");
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

      <div class="dialog-main">
        <!-- Left nav -->
        <nav class="settings-nav">
          <button
            v-for="item in NAV"
            :key="item.id"
            class="settings-nav-item"
            :class="{ active: activeTab === item.id }"
            @click="activeTab = item.id"
          >
            <component :is="item.icon" :size="15" class="settings-nav-icon" />
            <span>{{ item.label }}</span>
          </button>
        </nav>

        <!-- Content -->
        <div class="settings-content">
          <!-- General -->
          <section v-if="activeTab === 'general'" class="settings-section">
            <h4 class="section-title">General</h4>

            <div class="setting-block">
              <label class="setting-label">Default shell</label>
              <p class="setting-desc">Used when creating quick terminals and during onboarding.</p>
              <select v-model="defaultShellId" class="tc-input">
                <option value="">Auto (first available)</option>
                <option v-for="shell in terminalStore.shells" :key="shell.id" :value="shell.id">
                  {{ shell.name }}
                </option>
              </select>
            </div>

            <div class="setting-divider" />

            <div class="setting-block">
              <label class="setting-label">Default terminal size</label>
              <p class="setting-desc">
                The canvas box size new terminals spawn at. You can still resize any
                terminal by dragging afterward. "Agent" is tuned for coding-agent TUIs.
              </p>
              <div class="segmented">
                <button
                  v-for="preset in SIZE_PRESETS"
                  :key="preset.label"
                  type="button"
                  class="segmented-btn"
                  :class="{ active: sizeMatchesPreset(preset) }"
                  @click="applySizePreset(preset)"
                >
                  {{ preset.label }}
                </button>
              </div>
              <div class="field-row">
                <div class="field">
                  <label class="field-label">Width (px)</label>
                  <input v-model.number="defaultTermWidth" class="tc-input" type="number" min="300" step="20" />
                </div>
                <div class="field">
                  <label class="field-label">Height (px)</label>
                  <input v-model.number="defaultTermHeight" class="tc-input" type="number" min="200" step="20" />
                </div>
              </div>
            </div>

            <div class="setting-divider" />

            <div class="setting-block">
              <label class="toggle-row">
                <input
                  type="checkbox"
                  :checked="uiStore.fileExplorerDefaultOpen"
                  @change="uiStore.setFileExplorerDefaultOpen(($event.target as HTMLInputElement).checked)"
                />
                <span class="toggle-text">
                  <span class="toggle-title">Open the file explorer in new terminals</span>
                  <span class="toggle-sub">Show the file tree beside every new terminal that starts in a project. The terminal keeps its size — the explorer claims new space to its left — so turn this off to keep new terminals narrow. Either way, the Files button in a terminal's header toggles it any time.</span>
                </span>
              </label>
            </div>
          </section>

          <!-- Appearance -->
          <section v-else-if="activeTab === 'appearance'" class="settings-section">
            <h4 class="section-title">Appearance</h4>

            <div class="setting-block">
              <label class="setting-label">Theme</label>
              <p class="setting-desc">
                Applies to the app chrome. Terminals keep their dark palette in both
                themes, as terminals always do.
              </p>
              <div class="theme-grid">
                <button
                  v-for="opt in THEME_OPTIONS"
                  :key="opt.value"
                  type="button"
                  class="theme-card"
                  :class="{ active: uiStore.themePreference === opt.value }"
                  @click="uiStore.setThemePreference(opt.value)"
                >
                  <span v-if="uiStore.themePreference === opt.value" class="theme-card-check">
                    <Check :size="11" />
                  </span>

                  <!-- Dark / Light: a small terminal-prompt mock plus the
                       theme's actual accent/status colors -- this app has no
                       per-theme syntax palette, so a fake code editor would
                       show something you'd never actually see. -->
                  <span
                    v-if="opt.value === 'dark' || opt.value === 'light'"
                    class="theme-preview"
                    :style="{ background: THEME_PREVIEW[opt.value].bg }"
                  >
                    <span class="theme-preview-prompt" :style="{ color: THEME_PREVIEW[opt.value].text }">
                      <span :style="{ color: THEME_PREVIEW[opt.value].accent }">&gt;</span> run
                    </span>
                    <span class="theme-preview-swatches">
                      <span class="theme-swatch" :style="{ background: THEME_PREVIEW[opt.value].accent }" />
                      <span class="theme-swatch" :style="{ background: THEME_PREVIEW[opt.value].success }" />
                      <span class="theme-swatch" :style="{ background: THEME_PREVIEW[opt.value].warning }" />
                      <span class="theme-swatch" :style="{ background: THEME_PREVIEW[opt.value].error }" />
                    </span>
                  </span>

                  <!-- System: honestly split rather than faked as a fixed
                       palette, since it resolves to whichever of the two
                       above actually matches the OS at any given moment. -->
                  <span
                    v-else
                    class="theme-preview theme-preview-split"
                    :style="{ background: `linear-gradient(135deg, ${THEME_PREVIEW.dark.bg} 0%, ${THEME_PREVIEW.dark.bg} 49%, ${THEME_PREVIEW.light.bg} 51%, ${THEME_PREVIEW.light.bg} 100%)` }"
                  >
                    <span class="theme-preview-split-badge">
                      <Monitor :size="13" />
                    </span>
                  </span>

                  <span class="theme-card-label">{{ opt.label }}</span>
                </button>
              </div>
            </div>

            <div class="setting-divider" />

            <div class="setting-block">
              <label class="setting-label">
                Terminal title size
                <span class="setting-value">{{ uiStore.terminalTitleSize }}px</span>
              </label>
              <p class="setting-desc">
                How large each terminal's name reads in its header. Everything else
                in the header scales with it.
              </p>
              <input
                class="setting-range"
                type="range"
                min="10"
                max="22"
                step="1"
                :value="uiStore.terminalTitleSize"
                @input="uiStore.setTerminalTitleSize(Number(($event.target as HTMLInputElement).value))"
              />
            </div>

            <div class="setting-divider" />

            <div class="setting-block">
              <label class="toggle-row">
                <input
                  type="checkbox"
                  :checked="uiStore.showShellType"
                  @change="uiStore.setShowShellType(($event.target as HTMLInputElement).checked)"
                />
                <span class="toggle-text">
                  <span class="toggle-title">Show shell type</span>
                  <span class="toggle-sub">Display which shell each terminal runs (zsh, bash, PowerShell…) in headers, the Layers list and the Inspector. Off by default.</span>
                </span>
              </label>
            </div>

            <div class="setting-divider" />

            <div class="setting-block">
              <label class="toggle-row">
                <input
                  type="checkbox"
                  :checked="uiStore.minimapVisible"
                  @change="uiStore.setMinimapVisible(($event.target as HTMLInputElement).checked)"
                />
                <span class="toggle-text">
                  <span class="toggle-title">Show minimap</span>
                  <span class="toggle-sub">The canvas overview in the bottom-left corner. Turn it off to reclaim the space on a small display.</span>
                </span>
              </label>
            </div>

            <div class="setting-divider" />

            <div class="setting-block">
              <label class="setting-label">When adding a terminal or note</label>
              <p class="setting-desc">
                What the canvas does when a new item appears. New terminals always take
                focus so you can type right away; this controls notes and other items.
              </p>
              <div class="segmented">
                <button
                  type="button"
                  class="segmented-btn"
                  :class="{ active: uiStore.newItemPlacement === 'arrow' }"
                  @click="uiStore.setNewItemPlacement('arrow')"
                >
                  Point an arrow to it
                </button>
                <button
                  type="button"
                  class="segmented-btn"
                  :class="{ active: uiStore.newItemPlacement === 'focus' }"
                  @click="uiStore.setNewItemPlacement('focus')"
                >
                  Jump to it
                </button>
              </div>
            </div>
          </section>

          <!-- Notifications -->
          <section v-else-if="activeTab === 'notifications'" class="settings-section">
            <h4 class="section-title">Notifications</h4>

            <div class="setting-block">
              <p class="setting-desc">
                Flags a terminal (canvas badge, layer badge, and the bell counter in the
                toolbar) when a long-running command or coding agent finishes or wants
                your attention.
              </p>
              <label class="toggle-row">
                <input
                  :checked="!uiStore.soundMuted"
                  type="checkbox"
                  @change="uiStore.setSoundMuted(!($event.target as HTMLInputElement).checked)"
                />
                <span class="toggle-text">
                  <span class="toggle-title">Play a sound</span>
                  <span class="toggle-sub">A soft chime when a terminal needs you.</span>
                </span>
              </label>
            </div>

            <div class="setting-divider" />

            <div class="setting-block">
              <label class="setting-label">Notify after running for at least</label>
              <p class="setting-desc">
                Quick commands (like <code>ls</code>) never notify; only genuinely
                long-running ones do. Set to 0 to notify on every command.
              </p>
              <div class="inline-field">
                <input
                  :value="uiStore.idleThresholdSeconds"
                  class="tc-input"
                  type="number"
                  min="0"
                  step="1"
                  style="max-width: 96px"
                  @change="uiStore.setIdleThresholdSeconds(Number(($event.target as HTMLInputElement).value))"
                />
                <span class="setting-desc" style="margin: 0">seconds</span>
              </div>
            </div>

            <div class="setting-divider" />

            <div class="setting-block">
              <div class="info-card">
                <Bell :size="14" class="info-card-icon" />
                <span>
                  Prompts that need your input (a <em>choose an option</em> menu, a
                  <code>(y/n)</code> confirm, and the like) always notify — even in quick
                  succession — so a blocked agent is never missed.
                </span>
              </div>
            </div>
          </section>

          <!-- Launch Profiles -->
          <section v-else-if="activeTab === 'launch'" class="settings-section">
            <h4 class="section-title">Launch Profiles</h4>

            <div class="setting-block">
              <label class="setting-label">Built-in providers</label>
              <p class="setting-desc">
                Each one's command is typed and submitted automatically once the shell
                is ready. The New Terminal dialog offers the four most-used as one-click
                chips; the rest live here — still recognized (and badged) whenever you
                launch them by hand.
              </p>
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

            <div class="setting-divider" />

            <div class="setting-block">
              <label class="setting-label">Custom providers &amp; commands</label>
              <p class="setting-desc">
                Add your own auto-run shortcuts — a different agent CLI, a venv
                activation, a dev-server start command, anything you type often.
              </p>
              <div class="profile-list">
                <div
                  v-for="profile in launchProfileStore.customProfiles"
                  :key="profile.id"
                  class="profile-row"
                >
                  <template v-if="editingProfileId === profile.id">
                    <input v-model="editLabel" class="tc-input profile-edit-input" placeholder="Label" />
                    <input v-model="editCommand" class="tc-input profile-edit-input" placeholder="Command" />
                    <button class="tc-btn tc-btn-primary tc-btn-sm" @click="saveEditProfile">Save</button>
                    <button class="tc-btn tc-btn-sm" @click="cancelEditProfile">Cancel</button>
                  </template>
                  <template v-else>
                    <component :is="profile.icon" class="profile-row-glyph" :size="13" :style="{ color: profile.color }" />
                    <span class="profile-row-label">{{ profile.label }}</span>
                    <span class="profile-row-command">{{ profile.command }}</span>
                    <button class="icon-btn" title="Edit" @click="startEditProfile(profile.id, profile.label, profile.command)">
                      <Pencil :size="13" />
                    </button>
                    <button class="icon-btn icon-btn-danger" title="Delete" @click="launchProfileStore.removeCustomProfile(profile.id)">
                      <Trash2 :size="13" />
                    </button>
                  </template>
                </div>
                <div v-if="launchProfileStore.customProfiles.length === 0" class="profile-row-empty">
                  No custom providers yet.
                </div>
              </div>
              <div class="profile-add-row">
                <input v-model="newProfileLabel" class="tc-input" placeholder="Label (e.g. My Agent)" />
                <input v-model="newProfileCommand" class="tc-input" placeholder="Command (e.g. my-agent --flag)" />
                <button class="tc-btn tc-btn-primary" @click="addProfile">
                  <Plus :size="14" /> Add
                </button>
              </div>
            </div>
          </section>

          <!-- AI Naming (Groq) -->
          <section v-else-if="activeTab === 'groq'" class="settings-section">
            <h4 class="section-title">AI Naming</h4>
            <p class="section-intro">
              Groq generates short, meaningful names for your terminals and groups, and
              summarizes long commands in hover cards. Bring your own API key.
            </p>

            <label class="toggle-row">
              <input v-model="groqSettings.enabled" type="checkbox" />
              <span class="toggle-text">
                <span class="toggle-title">Enable AI auto-naming</span>
                <span class="toggle-sub">Falls back to heuristic names when off or unavailable.</span>
              </span>
            </label>

            <div class="setting-divider" />

            <div class="setting-block">
              <label class="setting-label">API key</label>
              <input v-model="groqSettings.apiKey" class="tc-input" placeholder="gsk_..." type="password" />
              <p class="setting-desc">
                Stored in your system keychain. Leave empty to use the
                <code>GROQ_API_KEY</code> environment variable — a blank field keeps
                the saved key rather than clearing it.
              </p>
              <button class="tc-btn tc-btn-sm setting-inline-btn" type="button" @click="removeApiKey">
                Remove saved key
              </button>
            </div>

            <div class="setting-block">
              <label class="setting-label">Model</label>
              <select v-model="groqSettings.model" class="tc-input">
                <option v-for="m in GROQ_MODELS" :key="m.value" :value="m.value">{{ m.label }}</option>
              </select>
            </div>

            <div class="field-row">
              <div class="field">
                <label class="field-label">Temperature</label>
                <input v-model.number="groqSettings.temperature" class="tc-input" type="number" step="0.1" min="0" max="1" />
              </div>
              <div class="field">
                <label class="field-label">Max tokens</label>
                <input v-model.number="groqSettings.maxTokens" class="tc-input" type="number" min="16" max="1024" />
              </div>
            </div>

            <details class="advanced">
              <summary>Advanced</summary>
              <div class="setting-block" style="margin-top: 10px">
                <label class="setting-label">Base URL</label>
                <input v-model="groqSettings.baseUrl" class="tc-input" type="text" />
              </div>
            </details>

            <div
              v-if="groqTestResult"
              class="test-result"
              :class="{ success: groqTestResult.startsWith('✓'), error: groqTestResult.startsWith('✗') }"
            >
              {{ groqTestResult }}
            </div>
          </section>

          <!-- System -->
          <section v-else-if="activeTab === 'system'" class="settings-section">
            <h4 class="section-title">System Integration</h4>

            <div v-if="isWindows" class="system-block">
              <label class="setting-label">Windows Explorer context menu</label>
              <p class="setting-desc">
                Add "Open in Terminal Canvas" to your right-click menu in Explorer, to
                open any folder directly in a new terminal.
              </p>
              <div class="system-status">
                <span class="status-dot" :class="contextMenuRegistered ? 'active' : 'inactive'" />
                <span>{{ contextMenuRegistered ? "Registered" : "Not registered" }}</span>
              </div>
              <button class="tc-btn tc-btn-primary" :disabled="contextMenuLoading" @click="toggleContextMenu">
                {{ contextMenuLoading ? "Working..." : contextMenuRegistered ? "Remove from Context Menu" : "Add to Context Menu" }}
              </button>
            </div>

            <div v-else-if="isMac" class="system-block">
              <label class="setting-label">Finder Quick Action</label>
              <p class="setting-desc">
                Add "Open in Terminal Canvas" to the right-click menu for folders in
                Finder (under Quick Actions). Only works from the installed app in
                /Applications, not a dev build.
              </p>
              <div class="system-status">
                <span class="status-dot" :class="contextMenuRegistered ? 'active' : 'inactive'" />
                <span>{{ contextMenuRegistered ? "Registered" : "Not registered" }}</span>
              </div>
              <button class="tc-btn tc-btn-primary" :disabled="contextMenuLoading" @click="toggleContextMenu">
                {{ contextMenuLoading ? "Working..." : contextMenuRegistered ? "Remove from Finder" : "Add to Finder" }}
              </button>
            </div>

            <div v-else class="system-block">
              <label class="setting-label">Right-click integration</label>
              <p class="setting-desc">
                Right-click-to-open-here integration is only available on Windows and
                macOS. Use the "Open" button in the toolbar or drag a folder onto the
                canvas instead.
              </p>
            </div>
          </section>
        </div>
      </div>

      <div class="dialog-footer">
        <button class="tc-btn" @click="close">Cancel</button>
        <button v-if="activeTab === 'groq'" class="tc-btn" :disabled="testingGroq" @click="testGroq">
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

/* Fixed size so switching tabs never resizes the modal. */
.dialog {
  background: var(--tc-bg-card);
  border: 1px solid var(--tc-border-color);
  border-radius: var(--tc-border-radius);
  width: 800px;
  height: 600px;
  max-width: 94vw;
  max-height: 88vh;
  display: flex;
  flex-direction: column;
  box-shadow: var(--tc-shadow-lg);
  overflow: hidden;
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
  display: flex;
  align-items: center;
  justify-content: center;
}

.dialog-close:hover {
  background: var(--tc-bg-hover);
  color: var(--tc-text-primary);
}

.dialog-main {
  flex: 1;
  display: flex;
  min-height: 0;
}

/* Left nav */
.settings-nav {
  width: 196px;
  flex-shrink: 0;
  border-right: 1px solid var(--tc-border-color);
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  background: var(--tc-bg-secondary);
  overflow-y: auto;
}

.settings-nav-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border: none;
  background: transparent;
  color: var(--tc-text-secondary);
  font-size: var(--tc-font-size-sm);
  font-family: var(--tc-font-sans);
  text-align: left;
  cursor: pointer;
  border-radius: var(--tc-border-radius-sm);
  transition: all var(--tc-transition-fast);
  border-left: 2px solid transparent;
}

.settings-nav-item:hover {
  background: var(--tc-bg-hover);
  color: var(--tc-text-primary);
}

.settings-nav-item.active {
  background: var(--tc-accent-soft);
  color: var(--tc-accent);
  border-left-color: var(--tc-accent);
  font-weight: 600;
}

.settings-nav-icon {
  flex-shrink: 0;
  opacity: 0.9;
}

/* Content */
.settings-content {
  flex: 1;
  overflow-y: auto;
  padding: 20px 22px;
  min-width: 0;
}

.settings-section {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.section-title {
  font-size: var(--tc-font-size-md);
  font-weight: 700;
  color: var(--tc-text-primary);
  margin: 0;
}

.section-intro {
  font-size: var(--tc-font-size-sm);
  color: var(--tc-text-secondary);
  line-height: 1.5;
  margin: -6px 0 0;
}

.setting-block {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.setting-label {
  font-size: var(--tc-font-size-sm);
  font-weight: 600;
  color: var(--tc-text-primary);
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
}

.setting-value {
  font-family: var(--tc-font-mono);
  font-size: var(--tc-font-size-xs);
  font-weight: 500;
  color: var(--tc-text-muted);
}

.setting-range {
  width: 100%;
  accent-color: var(--tc-accent);
  cursor: pointer;
}

.setting-inline-btn {
  align-self: flex-start;
  margin-top: 8px;
}

.setting-desc {
  font-size: var(--tc-font-size-xs);
  color: var(--tc-text-muted);
  line-height: 1.5;
  margin: 0;
}

.setting-desc code,
.info-card code {
  font-family: var(--tc-font-mono);
  background: var(--tc-bg-secondary);
  padding: 0 4px;
  border-radius: 3px;
  font-size: 0.92em;
}

.setting-divider {
  height: 1px;
  background: var(--tc-border-color);
  opacity: 0.7;
}

/* Segmented control */
.segmented {
  display: inline-flex;
  flex-wrap: wrap;
  gap: 4px;
  padding: 4px;
  background: var(--tc-bg-secondary);
  border: 1px solid var(--tc-border-color);
  border-radius: var(--tc-border-radius);
  align-self: flex-start;
}

.segmented-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border: none;
  background: transparent;
  color: var(--tc-text-secondary);
  font-size: var(--tc-font-size-sm);
  font-family: var(--tc-font-sans);
  cursor: pointer;
  border-radius: var(--tc-border-radius-sm);
  transition: all var(--tc-transition-fast);
}

.segmented-btn:hover {
  background: var(--tc-bg-hover);
  color: var(--tc-text-primary);
}

.segmented-btn.active {
  background: var(--tc-accent);
  color: #fff;
  font-weight: 600;
}

/* Theme picker */
.theme-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
  max-width: 460px;
}

.theme-card {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 8px;
  border: 1px solid var(--tc-border-color);
  border-radius: var(--tc-border-radius);
  background: var(--tc-bg-secondary);
  cursor: pointer;
  transition: border-color var(--tc-transition-fast), box-shadow var(--tc-transition-fast);
  font-family: var(--tc-font-sans);
}

.theme-card:hover {
  border-color: var(--tc-border-focus);
}

.theme-card.active {
  border-color: var(--tc-accent);
  box-shadow: 0 0 0 1px var(--tc-accent);
}

.theme-card-check {
  position: absolute;
  top: 6px;
  right: 6px;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--tc-accent);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1;
}

.theme-preview {
  height: 60px;
  border-radius: var(--tc-border-radius-sm);
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  padding: 8px;
  overflow: hidden;
}

.theme-preview-prompt {
  font-family: var(--tc-font-mono);
  font-size: 11px;
  font-weight: 600;
}

.theme-preview-swatches {
  display: flex;
  gap: 4px;
}

.theme-swatch {
  width: 10px;
  height: 10px;
  border-radius: 50%;
}

.theme-preview-split {
  align-items: center;
  justify-content: center;
}

.theme-preview-split-badge {
  width: 26px;
  height: 26px;
  border-radius: 50%;
  background: var(--tc-bg-card);
  color: var(--tc-text-primary);
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: var(--tc-shadow-sm);
}

.theme-card-label {
  font-size: var(--tc-font-size-sm);
  color: var(--tc-text-secondary);
  text-align: center;
}

.theme-card.active .theme-card-label {
  color: var(--tc-text-primary);
  font-weight: 600;
}

/* Fields */
.field-row {
  display: flex;
  gap: 12px;
}

.field {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.field-label {
  font-size: var(--tc-font-size-xs);
  color: var(--tc-text-muted);
}

.inline-field {
  display: flex;
  align-items: center;
  gap: 8px;
}

.tc-input {
  width: 100%;
  padding: 7px 10px;
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

/* Toggle rows */
.toggle-row {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  cursor: pointer;
}

.toggle-row input[type="checkbox"] {
  width: 16px;
  height: 16px;
  margin-top: 2px;
  accent-color: var(--tc-accent);
  flex-shrink: 0;
}

.toggle-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.toggle-title {
  font-size: var(--tc-font-size-sm);
  color: var(--tc-text-primary);
  font-weight: 500;
}

.toggle-sub {
  font-size: var(--tc-font-size-xs);
  color: var(--tc-text-muted);
}

.info-card {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  padding: 10px 12px;
  background: var(--tc-accent-soft);
  border: 1px solid color-mix(in srgb, var(--tc-accent) 30%, transparent);
  border-radius: var(--tc-border-radius-sm);
  font-size: var(--tc-font-size-xs);
  color: var(--tc-text-secondary);
  line-height: 1.5;
}

.info-card-icon {
  color: var(--tc-accent);
  flex-shrink: 0;
  margin-top: 1px;
}

.advanced {
  border-top: 1px solid var(--tc-border-color);
  padding-top: 10px;
}

.advanced summary {
  cursor: pointer;
  font-size: var(--tc-font-size-sm);
  color: var(--tc-text-secondary);
  user-select: none;
}

.advanced summary:hover {
  color: var(--tc-text-primary);
}

/* Test result */
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

/* Launch profiles */
.profile-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.profile-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 10px;
  border: 1px solid var(--tc-border-color);
  border-radius: var(--tc-border-radius-sm);
  background: var(--tc-bg-secondary);
}

.profile-row-glyph {
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
  padding: 8px 10px;
  border: 1px dashed var(--tc-border-color);
  border-radius: var(--tc-border-radius-sm);
  text-align: center;
}

.profile-edit-input {
  flex: 1;
}

.profile-add-row {
  display: flex;
  gap: 8px;
  margin-top: 8px;
}

.profile-add-row .tc-input {
  flex: 1;
}

.icon-btn {
  width: 26px;
  height: 26px;
  border: none;
  background: transparent;
  color: var(--tc-text-muted);
  cursor: pointer;
  border-radius: var(--tc-border-radius-sm);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  transition: all var(--tc-transition-fast);
}

.icon-btn:hover {
  background: var(--tc-bg-hover);
  color: var(--tc-text-primary);
}

.icon-btn-danger:hover {
  color: var(--tc-error);
}

/* System */
.system-block {
  display: flex;
  flex-direction: column;
  gap: 10px;
  align-items: flex-start;
}

.system-status {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: var(--tc-font-size-sm);
  color: var(--tc-text-secondary);
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

/* Footer + buttons */
.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 18px;
  border-top: 1px solid var(--tc-border-color);
  flex-shrink: 0;
}

.tc-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 7px 14px;
  border: 1px solid var(--tc-border-color);
  border-radius: var(--tc-border-radius-sm);
  background: var(--tc-bg-card);
  color: var(--tc-text-secondary);
  font-size: var(--tc-font-size-sm);
  cursor: pointer;
  transition: all var(--tc-transition-fast);
  font-family: var(--tc-font-sans);
}

.tc-btn-sm {
  padding: 4px 10px;
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
  color: #fff;
}
</style>
