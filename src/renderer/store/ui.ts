import { defineStore } from "pinia";
import { ref, computed, onScopeDispose } from "vue";

export type InspectorTab = "terminal" | "prompt" | "settings";
export type SidebarTab = "layers" | "workspaces";
export type ThemePreference = "light" | "dark" | "system";

const THEME_STORAGE_KEY = "terminal-canvas:theme";
const SOUND_MUTED_KEY = "terminal-canvas:sound-muted";
const IDLE_THRESHOLD_KEY = "terminal-canvas:idle-threshold-seconds";
const DEFAULT_IDLE_THRESHOLD_SECONDS = 2;

/**
 * Pinia store for UI state management.
 * Controls visibility of panels, dialogs, and transient UI like toasts.
 */
export const useUIStore = defineStore("ui", () => {
  // ─── Panel Visibility ────────────────────────────────────────────
  const inspectorVisible = ref(true);
  const inspectorTab = ref<InspectorTab>("terminal");
  const sidebarVisible = ref(true);
  const sidebarTab = ref<SidebarTab>("layers");

  // ─── Theme ───────────────────────────────────────────────────────
  const storedThemePref = localStorage.getItem(THEME_STORAGE_KEY);
  const themePreference = ref<ThemePreference>(
    storedThemePref === "light" || storedThemePref === "dark" || storedThemePref === "system"
      ? storedThemePref
      : "dark"
  );
  const systemPrefersDark = ref(
    typeof window.matchMedia === "function"
      ? window.matchMedia("(prefers-color-scheme: dark)").matches
      : true
  );

  if (typeof window.matchMedia === "function") {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = (e: MediaQueryListEvent) => {
      systemPrefersDark.value = e.matches;
    };
    media.addEventListener("change", handler);
    onScopeDispose(() => media.removeEventListener("change", handler));
  }

  /** The theme actually applied to the document, resolving "system". */
  const resolvedTheme = computed<"light" | "dark">(() =>
    themePreference.value === "system"
      ? systemPrefersDark.value
        ? "dark"
        : "light"
      : themePreference.value
  );

  /**
   * Set the theme preference and persist it. Applying `resolvedTheme` to
   * the document is handled by a watcher in App.vue (single source of truth
   * for the DOM side-effect).
   */
  function setThemePreference(pref: ThemePreference): void {
    themePreference.value = pref;
    localStorage.setItem(THEME_STORAGE_KEY, pref);
  }

  /** Cycle Dark -> Light -> System -> Dark, for a single toolbar toggle button. */
  function cycleTheme(): void {
    const order: ThemePreference[] = ["dark", "light", "system"];
    const next = order[(order.indexOf(themePreference.value) + 1) % order.length];
    setThemePreference(next);
  }

  // ─── Attention Notifications (idle/bell detection) ────────────────
  const soundMuted = ref(localStorage.getItem(SOUND_MUTED_KEY) === "true");
  // Note: Number(null) is 0, not NaN -- a missing key must be checked for
  // explicitly, or every first-run user silently gets threshold=0 (notify
  // on every command) instead of the intended default.
  const rawStoredThreshold = localStorage.getItem(IDLE_THRESHOLD_KEY);
  const storedThreshold = rawStoredThreshold === null ? NaN : Number(rawStoredThreshold);
  const idleThresholdSeconds = ref(
    Number.isFinite(storedThreshold) && storedThreshold >= 0
      ? storedThreshold
      : DEFAULT_IDLE_THRESHOLD_SECONDS
  );

  function setSoundMuted(muted: boolean): void {
    soundMuted.value = muted;
    localStorage.setItem(SOUND_MUTED_KEY, String(muted));
  }

  function toggleSoundMuted(): void {
    setSoundMuted(!soundMuted.value);
  }

  /** Persists locally and pushes the new value to the main process, which
   * owns the actual idle-timer logic. */
  function setIdleThresholdSeconds(seconds: number): void {
    const clamped = Math.max(0, seconds);
    idleThresholdSeconds.value = clamped;
    localStorage.setItem(IDLE_THRESHOLD_KEY, String(clamped));
    window.api?.terminal.setIdleThreshold(clamped * 1000)?.catch(() => {
      // Non-critical -- main process keeps its previous threshold.
    });
  }

  // ─── Dialog State ────────────────────────────────────────────────
  const commandPaletteOpen = ref(false);
  const newTerminalDialogOpen = ref(false);
  const groqSettingsOpen = ref(false);
  const settingsOpen = ref(false);
  const onboardingOpen = ref(false);

  // ─── Toast ───────────────────────────────────────────────────────
  const toastMessage = ref<string | null>(null);
  const toastTimeout = ref<ReturnType<typeof setTimeout> | null>(null);

  // ─── Actions ─────────────────────────────────────────────────────

  /**
   * Toggle the inspector panel visibility.
   */
  function toggleInspector(): void {
    inspectorVisible.value = !inspectorVisible.value;
  }

  /**
   * Set the active inspector tab.
   */
  function setInspectorTab(tab: InspectorTab): void {
    inspectorTab.value = tab;
    inspectorVisible.value = true;
  }

  /**
   * Toggle the sidebar visibility.
   */
  function toggleSidebar(): void {
    sidebarVisible.value = !sidebarVisible.value;
  }

  /**
   * Set the active sidebar tab.
   */
  function setSidebarTab(tab: SidebarTab): void {
    sidebarTab.value = tab;
    sidebarVisible.value = true;
  }

  /**
   * Open the command palette.
   */
  function openCommandPalette(): void {
    commandPaletteOpen.value = true;
  }

  /**
   * Close the command palette.
   */
  function closeCommandPalette(): void {
    commandPaletteOpen.value = false;
  }

  /**
   * Toggle the command palette.
   */
  function toggleCommandPalette(): void {
    commandPaletteOpen.value = !commandPaletteOpen.value;
  }

  /**
   * Open the new terminal dialog.
   */
  function openNewTerminalDialog(): void {
    newTerminalDialogOpen.value = true;
  }

  /**
   * Close the new terminal dialog.
   */
  function closeNewTerminalDialog(): void {
    newTerminalDialogOpen.value = false;
  }

  /**
   * Open the Groq settings dialog.
   */
  function openGroqSettings(): void {
    groqSettingsOpen.value = true;
  }

  /**
   * Close the Groq settings dialog.
   */
  function closeGroqSettings(): void {
    groqSettingsOpen.value = false;
  }

  /**
   * Open the general settings dialog.
   */
  function openSettings(): void {
    settingsOpen.value = true;
  }

  /**
   * Close the general settings dialog.
   */
  function closeSettings(): void {
    settingsOpen.value = false;
  }

  /**
   * Open the onboarding dialog.
   */
  function openOnboarding(): void {
    onboardingOpen.value = true;
  }

  /**
   * Close the onboarding dialog.
   */
  function closeOnboarding(): void {
    onboardingOpen.value = false;
  }

  /**
   * Show a toast message that auto-dismisses after a duration.
   */
  function showToast(message: string, duration = 3000): void {
    // Clear any existing toast timeout
    if (toastTimeout.value) {
      clearTimeout(toastTimeout.value);
    }
    toastMessage.value = message;
    toastTimeout.value = setTimeout(() => {
      toastMessage.value = null;
      toastTimeout.value = null;
    }, duration);
  }

  /**
   * Hide the toast immediately.
   */
  function hideToast(): void {
    toastMessage.value = null;
    if (toastTimeout.value) {
      clearTimeout(toastTimeout.value);
      toastTimeout.value = null;
    }
  }

  return {
    // State
    inspectorVisible,
    inspectorTab,
    sidebarVisible,
    sidebarTab,
    commandPaletteOpen,
    newTerminalDialogOpen,
    groqSettingsOpen,
    settingsOpen,
    onboardingOpen,
    toastMessage,
    themePreference,
    resolvedTheme,
    soundMuted,
    idleThresholdSeconds,
    // Actions
    setThemePreference,
    cycleTheme,
    setSoundMuted,
    toggleSoundMuted,
    setIdleThresholdSeconds,
    toggleInspector,
    setInspectorTab,
    toggleSidebar,
    setSidebarTab,
    openCommandPalette,
    closeCommandPalette,
    toggleCommandPalette,
    openNewTerminalDialog,
    closeNewTerminalDialog,
    openGroqSettings,
    closeGroqSettings,
    openSettings,
    closeSettings,
    openOnboarding,
    closeOnboarding,
    showToast,
    hideToast,
  };
});
