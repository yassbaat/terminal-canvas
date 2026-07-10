import { defineStore } from "pinia";
import { ref, computed, onScopeDispose } from "vue";

export type InspectorTab = "terminal" | "prompt" | "settings";
export type SidebarTab = "layers" | "workspaces";
export type ThemePreference = "light" | "dark" | "system";
export type TerminalHeaderStyle = "comfortable" | "compact" | "minimal";

const THEME_STORAGE_KEY = "terminal-canvas:theme";
const SOUND_MUTED_KEY = "terminal-canvas:sound-muted";
const IDLE_THRESHOLD_KEY = "terminal-canvas:idle-threshold-seconds";
const DEFAULT_IDLE_THRESHOLD_SECONDS = 2;
const SIDEBAR_WIDTH_KEY = "terminal-canvas:sidebar-width";
const INSPECTOR_WIDTH_KEY = "terminal-canvas:inspector-width";
const MEMORY_RAIL_WIDTH_KEY = "terminal-canvas:memory-rail-width";
const HEADER_STYLE_KEY = "terminal-canvas:terminal-header-style";

function readStoredWidth(key: string, fallback: number): number {
  const raw = localStorage.getItem(key);
  const n = raw === null ? NaN : Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/**
 * Pinia store for UI state management.
 * Controls visibility of panels, dialogs, and transient UI like toasts.
 */
export const useUIStore = defineStore("ui", () => {
  // ─── Panel Visibility ────────────────────────────────────────────
  const inspectorVisible = ref(true);
  const inspectorTab = ref<InspectorTab>("prompt");
  const sidebarVisible = ref(true);
  const sidebarTab = ref<SidebarTab>("layers");

  // ─── Resizable Panel Widths ──────────────────────────────────────
  const sidebarWidth = ref(readStoredWidth(SIDEBAR_WIDTH_KEY, 220));
  const inspectorWidth = ref(readStoredWidth(INSPECTOR_WIDTH_KEY, 280));
  const memoryRailWidth = ref(readStoredWidth(MEMORY_RAIL_WIDTH_KEY, 220));

  function setSidebarWidth(width: number): void {
    sidebarWidth.value = Math.min(480, Math.max(160, width));
    localStorage.setItem(SIDEBAR_WIDTH_KEY, String(sidebarWidth.value));
  }

  function setInspectorWidth(width: number): void {
    inspectorWidth.value = Math.min(480, Math.max(200, width));
    localStorage.setItem(INSPECTOR_WIDTH_KEY, String(inspectorWidth.value));
  }

  function setMemoryRailWidth(width: number): void {
    memoryRailWidth.value = Math.min(480, Math.max(160, width));
    localStorage.setItem(MEMORY_RAIL_WIDTH_KEY, String(memoryRailWidth.value));
  }

  // ─── Terminal Header Style ───────────────────────────────────────
  const storedHeaderStyle = localStorage.getItem(HEADER_STYLE_KEY);
  const headerStyle = ref<TerminalHeaderStyle>(
    storedHeaderStyle === "comfortable" || storedHeaderStyle === "compact" || storedHeaderStyle === "minimal"
      ? storedHeaderStyle
      : "comfortable"
  );

  function setHeaderStyle(style: TerminalHeaderStyle): void {
    headerStyle.value = style;
    localStorage.setItem(HEADER_STYLE_KEY, style);
  }

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

  // ─── Home / Launcher Screen ──────────────────────────────────────
  // Whole-window takeover shown instead of the toolbar/canvas/sidebar when
  // the user has saved workspaces to pick from (see App.vue's onMounted).
  const homeVisible = ref(false);

  function showHome(): void {
    homeVisible.value = true;
  }

  function hideHome(): void {
    homeVisible.value = false;
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

  // ─── Canvas Pan Mode ─────────────────────────────────────────────
  // Whether the pan modifier (Shift/Space) is currently held. Lives here
  // (rather than as a local ref in WorkspaceCanvas.vue) so other components
  // that need to yield to a pan gesture -- e.g. XtermView.vue deciding
  // whether to stop propagation on mousedown -- can read it too.
  const isPanKeyPressed = ref(false);

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
    sidebarWidth,
    inspectorWidth,
    memoryRailWidth,
    headerStyle,
    homeVisible,
    isPanKeyPressed,
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
    setSidebarWidth,
    setInspectorWidth,
    setMemoryRailWidth,
    setHeaderStyle,
    showHome,
    hideHome,
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
