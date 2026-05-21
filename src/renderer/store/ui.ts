import { defineStore } from "pinia";
import { ref } from "vue";

export type InspectorTab = "terminal" | "prompt" | "settings";
export type SidebarTab = "layers" | "workspaces";

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
    // Actions
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
