import { defineStore } from "pinia";
import { ref, computed, onScopeDispose } from "vue";

export type InspectorTab = "terminal" | "prompt" | "settings";
export type SidebarTab = "layers" | "workspaces";
export type ThemePreference = "light" | "dark" | "system";
/** What happens on the canvas when a new terminal/note is added. */
export type NewItemPlacement = "focus" | "arrow";

/** A request for the canvas to reveal a just-added item (see revealNewItem). */
export interface RevealTarget {
  x: number;
  y: number;
  width: number;
  height: number;
  id?: string;
  /**
   * Force center-and-focus regardless of the user's newItemPlacement setting.
   * Set for freshly-created terminals so the user can start typing immediately
   * (the "arrow" placement mode still applies to notes and other items).
   */
  focus?: boolean;
  /** Bumped every request so identical positions still re-trigger the watcher. */
  nonce: number;
}

const THEME_STORAGE_KEY = "terminal-canvas:theme";
const SOUND_MUTED_KEY = "terminal-canvas:sound-muted";
const IDLE_THRESHOLD_KEY = "terminal-canvas:idle-threshold-seconds";
const DEFAULT_IDLE_THRESHOLD_SECONDS = 2;
const OUTLINE_HEIGHT_KEY = "terminal-canvas:outline-height";
const INSPECTOR_WIDTH_KEY = "terminal-canvas:inspector-width";
const MEMORY_RAIL_WIDTH_KEY = "terminal-canvas:memory-rail-width";
const TERMINAL_TITLE_SIZE_KEY = "terminal-canvas:terminal-title-size";
const NEW_ITEM_PLACEMENT_KEY = "terminal-canvas:new-item-placement";
const SHOW_SHELL_TYPE_KEY = "terminal-canvas:show-shell-type";
const FILE_DRAWER_WIDTH_KEY = "terminal-canvas:file-drawer-width";

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
  /**
   * The Outline region (Layers / Workspaces) at the bottom of the right panel.
   * This used to be a separate left sidebar; it moved so the left edge of the
   * canvas belongs entirely to the per-terminal file explorers, and so the two
   * workspace-wide navigators sit next to the per-session inspectors instead of
   * across the screen from them.
   */
  const outlineVisible = ref(true);
  const sidebarTab = ref<SidebarTab>("layers");

  // ─── Resizable Panel Widths ──────────────────────────────────────
  const outlineHeight = ref(readStoredWidth(OUTLINE_HEIGHT_KEY, 260));
  const inspectorWidth = ref(readStoredWidth(INSPECTOR_WIDTH_KEY, 280));
  const memoryRailWidth = ref(readStoredWidth(MEMORY_RAIL_WIDTH_KEY, 220));

  function setOutlineHeight(height: number): void {
    outlineHeight.value = Math.min(700, Math.max(120, height));
    localStorage.setItem(OUTLINE_HEIGHT_KEY, String(outlineHeight.value));
  }

  function setInspectorWidth(width: number): void {
    inspectorWidth.value = Math.min(480, Math.max(200, width));
    localStorage.setItem(INSPECTOR_WIDTH_KEY, String(inspectorWidth.value));
  }

  function setMemoryRailWidth(width: number): void {
    memoryRailWidth.value = Math.min(480, Math.max(160, width));
    localStorage.setItem(MEMORY_RAIL_WIDTH_KEY, String(memoryRailWidth.value));
  }

  // ─── File explorer drawer (per-terminal, on the canvas) ──────────
  const fileDrawerWidth = ref(readStoredWidth(FILE_DRAWER_WIDTH_KEY, 240));

  /**
   * Returns how much the width actually changed after clamping. The drawer
   * lives inside a canvas node whose box has to grow by the same amount, and
   * that caller needs the clamped delta, not the requested one -- otherwise
   * dragging past the limit keeps widening the node while the drawer stays put.
   */
  function setFileDrawerWidth(width: number): number {
    const previous = fileDrawerWidth.value;
    fileDrawerWidth.value = Math.min(480, Math.max(160, width));
    localStorage.setItem(FILE_DRAWER_WIDTH_KEY, String(fileDrawerWidth.value));
    return fileDrawerWidth.value - previous;
  }

  // ─── Terminal title size ─────────────────────────────────────────
  // Replaced the old three-way header-style setting. The variants differed by
  // how much they stacked below the name (cwd line, duplicate agent pill) --
  // information the name and the agent glyph already carry, at the cost of
  // making every node taller. One header now, and the thing that genuinely
  // varies by taste and display is adjustable instead.
  const terminalTitleSize = ref(readStoredWidth(TERMINAL_TITLE_SIZE_KEY, 13));

  function setTerminalTitleSize(px: number): void {
    terminalTitleSize.value = Math.min(22, Math.max(10, Math.round(px)));
    localStorage.setItem(TERMINAL_TITLE_SIZE_KEY, String(terminalTitleSize.value));
  }

  // ─── Show shell type (zsh, bash, PowerShell…) ────────────────────
  // Off by default: which shell a terminal runs is rarely something the user
  // needs to see once they're working, and it adds clutter to headers, the
  // Layers list and the Inspector. Opt in from Settings → Appearance.
  const showShellType = ref(localStorage.getItem(SHOW_SHELL_TYPE_KEY) === "true");

  function setShowShellType(value: boolean): void {
    showShellType.value = value;
    localStorage.setItem(SHOW_SHELL_TYPE_KEY, String(value));
  }

  // ─── New-item placement behavior ─────────────────────────────────
  const storedPlacement = localStorage.getItem(NEW_ITEM_PLACEMENT_KEY);
  const newItemPlacement = ref<NewItemPlacement>(
    storedPlacement === "focus" || storedPlacement === "arrow" ? storedPlacement : "arrow"
  );

  function setNewItemPlacement(mode: NewItemPlacement): void {
    newItemPlacement.value = mode;
    localStorage.setItem(NEW_ITEM_PLACEMENT_KEY, mode);
  }

  // Signal for the canvas to reveal a just-created item (center+focus, or a
  // temporary pointer arrow). Set via revealNewItem; WorkspaceCanvas watches
  // it. Kept here (not a canvas-local ref) because items get created from
  // the Toolbar, dialogs, and the command palette -- none of which own the
  // Vue Flow instance that can actually move the viewport.
  const revealTarget = ref<RevealTarget | null>(null);

  function revealNewItem(rect: { x: number; y: number; width: number; height: number; id?: string; focus?: boolean }): void {
    revealTarget.value = { ...rect, nonce: Date.now() };
  }

  // ─── Canvas / Layers Hover ───────────────────────────────────────
  // The terminal node the pointer is currently over on the canvas. Drives the
  // hovered node's z-index lift (so its hover card isn't obstructed by
  // neighbours), the zoomed-in info popup, and the minimap highlight.
  const hoveredTerminalId = ref<string | null>(null);
  // The layer item (terminal/group/note) the pointer is over in the sidebar
  // Layers list. Drives the minimap highlight so hovering the list shows you
  // where that item lives on the canvas.
  const hoveredLayerId = ref<string | null>(null);

  function setHoveredTerminal(id: string | null): void {
    hoveredTerminalId.value = id;
  }

  function setHoveredLayer(id: string | null): void {
    hoveredLayerId.value = id;
  }

  /** The item to highlight on the minimap: an explicitly-hovered layer wins,
   * otherwise the hovered canvas node. */
  const minimapHighlightId = computed(
    () => hoveredLayerId.value ?? hoveredTerminalId.value
  );

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

  // ─── Focus Mode (V2) ─────────────────────────────────────────────
  // An immersive full-screen "stage" showing a curated subset of terminals in
  // an auto-grid. Terminals never leave the canvas -- the Focus Set is just an
  // ordered list of ids to display, so exiting snaps straight back with no
  // ownership/sync complexity (single source of truth stays the canvas).
  const FOCUS_PER_SCREEN_KEY = "terminal-canvas:focus-per-screen";
  const focusModeActive = ref(false);
  const focusSet = ref<string[]>([]);
  const focusPerScreen = ref(readStoredWidth(FOCUS_PER_SCREEN_KEY, 2));
  const focusPage = ref(0);
  // Which staged terminal's memory panel is open (null = hidden, the default).
  const focusMemoryTerminalId = ref<string | null>(null);

  function isInFocusSet(id: string): boolean {
    return focusSet.value.includes(id);
  }

  /** Stage the given terminals and open the full-screen focus view. */
  function enterFocus(ids: string[]): void {
    const unique = Array.from(new Set(ids)).filter(Boolean);
    if (unique.length === 0) return;
    focusSet.value = unique;
    focusPage.value = 0;
    focusMemoryTerminalId.value = null;
    focusModeActive.value = true;
  }

  function exitFocus(): void {
    focusModeActive.value = false;
    focusMemoryTerminalId.value = null;
  }

  function addToFocus(id: string): void {
    if (!focusSet.value.includes(id)) focusSet.value = [...focusSet.value, id];
  }

  function removeFromFocus(id: string): void {
    focusSet.value = focusSet.value.filter((x) => x !== id);
    if (focusSet.value.length === 0) exitFocus();
  }

  /**
   * Swap two staged terminals' positions in the focus set (drag-and-drop on the
   * Focus stage). Reorders the underlying array so the swap survives paging and
   * per-screen changes -- the grid always renders a slice of focusSet in order.
   */
  function swapFocus(idA: string, idB: string): void {
    if (idA === idB) return;
    const a = focusSet.value.indexOf(idA);
    const b = focusSet.value.indexOf(idB);
    if (a === -1 || b === -1) return;
    const next = [...focusSet.value];
    [next[a], next[b]] = [next[b], next[a]];
    focusSet.value = next;
  }

  /** How many terminals to show per screen/page (1 for small displays, up to 6). */
  function setFocusPerScreen(n: number): void {
    focusPerScreen.value = Math.max(1, Math.min(6, Math.round(n)));
    localStorage.setItem(FOCUS_PER_SCREEN_KEY, String(focusPerScreen.value));
    focusPage.value = 0;
  }

  const focusPageCount = computed(() =>
    Math.max(1, Math.ceil(focusSet.value.length / focusPerScreen.value))
  );

  function setFocusPage(p: number): void {
    focusPage.value = Math.max(0, Math.min(focusPageCount.value - 1, p));
  }

  /** Toggle the memory side-panel for a staged terminal. */
  function toggleFocusMemory(id: string): void {
    focusMemoryTerminalId.value = focusMemoryTerminalId.value === id ? null : id;
  }

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
   * Toggle the Outline region (Layers / Workspaces).
   */
  function toggleOutline(): void {
    outlineVisible.value = !outlineVisible.value;
  }

  /**
   * Set the active Outline tab.
   */
  function setSidebarTab(tab: SidebarTab): void {
    sidebarTab.value = tab;
    outlineVisible.value = true;
    inspectorVisible.value = true;
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
    outlineVisible,
    sidebarTab,
    outlineHeight,
    inspectorWidth,
    memoryRailWidth,
    fileDrawerWidth,
    terminalTitleSize,
    showShellType,
    newItemPlacement,
    revealTarget,
    hoveredTerminalId,
    hoveredLayerId,
    minimapHighlightId,
    focusModeActive,
    focusSet,
    focusPerScreen,
    focusPage,
    focusPageCount,
    focusMemoryTerminalId,
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
    toggleOutline,
    setSidebarTab,
    setOutlineHeight,
    setInspectorWidth,
    setMemoryRailWidth,
    setFileDrawerWidth,
    setTerminalTitleSize,
    setShowShellType,
    setNewItemPlacement,
    revealNewItem,
    setHoveredTerminal,
    setHoveredLayer,
    isInFocusSet,
    enterFocus,
    exitFocus,
    addToFocus,
    removeFromFocus,
    swapFocus,
    setFocusPerScreen,
    setFocusPage,
    toggleFocusMemory,
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
