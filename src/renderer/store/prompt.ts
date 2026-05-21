import { defineStore } from "pinia";
import { ref, computed } from "vue";
import type { PromptEntry } from "@renderer/type/prompt";

/**
 * Pinia store for Agent Memory (PromptRail).
 * Manages prompt history per-terminal with sorting, pinning, and resend.
 */
export const usePromptStore = defineStore("prompt", () => {
  // ─── State ───────────────────────────────────────────────────────
  const promptsByTerminal = ref<Map<string, PromptEntry[]>>(new Map());
  const selectedPromptId = ref<string | null>(null);

  // ─── Getters ─────────────────────────────────────────────────────

  /**
   * Get prompts for a terminal, sorted: pinned first, then by submission time (newest first).
   */
  const getPromptsForTerminal = computed(
    () =>
      (terminalId: string): PromptEntry[] => {
        const prompts = promptsByTerminal.value.get(terminalId) || [];
        return [...prompts].sort((a, b) => {
          if (a.pinned && !b.pinned) return -1;
          if (!a.pinned && b.pinned) return 1;
          return b.submittedAt - a.submittedAt;
        });
      }
  );

  /**
   * Get the total count of non-deleted prompts for a terminal.
   */
  const getPromptCount = computed(
    () =>
      (terminalId: string): number => {
        return (promptsByTerminal.value.get(terminalId) || []).filter(
          (p) => p.status !== "deleted"
        ).length;
      }
  );

  /**
   * Get only the pinned prompts for a terminal.
   */
  const getPinnedPrompts = computed(
    () =>
      (terminalId: string): PromptEntry[] => {
        return (promptsByTerminal.value.get(terminalId) || []).filter(
          (p) => p.pinned
        );
      }
  );

  /**
   * Get the most recent non-deleted prompt for a terminal.
   */
  const getLatestPrompt = computed(
    () =>
      (terminalId: string): PromptEntry | null => {
        const prompts = promptsByTerminal.value.get(terminalId) || [];
        const active = prompts.filter((p) => p.status !== "deleted");
        if (active.length === 0) return null;
        return active.reduce((latest, p) =>
          p.submittedAt > latest.submittedAt ? p : latest
        );
      }
  );

  // ─── Actions ─────────────────────────────────────────────────────

  /**
   * Add a new prompt entry to a terminal's history.
   */
  function addPrompt(
    entry: Omit<PromptEntry, "id" | "createdAt">
  ): PromptEntry {
    const prompt: PromptEntry = {
      ...entry,
      id: `prompt_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      createdAt: Date.now(),
    };
    const existing = promptsByTerminal.value.get(prompt.terminalId) || [];
    existing.push(prompt);
    promptsByTerminal.value.set(prompt.terminalId, existing);
    return prompt;
  }

  /**
   * Mark a prompt as deleted (soft delete).
   */
  function deletePrompt(terminalId: string, promptId: string): void {
    const prompts = promptsByTerminal.value.get(terminalId) || [];
    const p = prompts.find((p) => p.id === promptId);
    if (p) p.status = "deleted";
  }

  /**
   * Toggle the pinned state of a prompt.
   */
  function pinPrompt(terminalId: string, promptId: string): void {
    const prompts = promptsByTerminal.value.get(terminalId) || [];
    const p = prompts.find((p) => p.id === promptId);
    if (p) p.pinned = !p.pinned;
  }

  /**
   * Resend a prompt's text to the terminal via IPC.
   */
  function resendPrompt(terminalId: string, promptId: string): void {
    const prompts = promptsByTerminal.value.get(terminalId) || [];
    const p = prompts.find((p) => p.id === promptId);
    if (p) {
      window.api.terminal.write(terminalId, p.text + "\r");
      p.status = "resent";
    }
  }

  /**
   * Remove all prompts for a given terminal (hard delete).
   */
  function clearForTerminal(terminalId: string): void {
    promptsByTerminal.value.delete(terminalId);
  }

  /**
   * Set which prompt is currently selected in the inspector.
   */
  function setSelected(id: string | null): void {
    selectedPromptId.value = id;
  }

  /**
   * Load all prompts from a workspace save.
   */
  function loadFromWorkspace(promptHistory: PromptEntry[]): void {
    const map = new Map<string, PromptEntry[]>();
    for (const prompt of promptHistory) {
      const existing = map.get(prompt.terminalId) || [];
      existing.push(prompt);
      map.set(prompt.terminalId, existing);
    }
    promptsByTerminal.value = map;
  }

  /**
   * Get all prompts across all terminals.
   */
  function getAllPrompts(): PromptEntry[] {
    const all: PromptEntry[] = [];
    for (const prompts of promptsByTerminal.value.values()) {
      all.push(...prompts);
    }
    return all;
  }

  /**
   * Set up IPC listeners for prompt events from the main process.
   */
  function setupListeners(): void {
    window.api.prompt.onAdd((entry) => {
      const existing = promptsByTerminal.value.get(entry.terminalId) || [];
      existing.push(entry);
      promptsByTerminal.value.set(entry.terminalId, existing);
    });
  }

  return {
    // State
    promptsByTerminal,
    selectedPromptId,
    // Getters
    getPromptsForTerminal,
    getPromptCount,
    getPinnedPrompts,
    getLatestPrompt,
    // Actions
    addPrompt,
    deletePrompt,
    pinPrompt,
    resendPrompt,
    clearForTerminal,
    setSelected,
    loadFromWorkspace,
    getAllPrompts,
    setupListeners,
  };
});
