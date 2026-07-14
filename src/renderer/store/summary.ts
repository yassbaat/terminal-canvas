import { defineStore } from "pinia";
import { ref } from "vue";

/**
 * Threshold above which a command/prompt is considered "too long" to read
 * verbatim in a compact tooltip and is worth summarizing via AI. Kept in sync
 * with the main-process summarizeCommand short-circuit (which also returns
 * short text as-is), so we never fire a request for something already legible.
 */
export const SUMMARY_LONG_THRESHOLD = 120;

/**
 * Lazily-fetched, cached AI summaries of long terminal commands/prompts, keyed
 * by the exact source text. Used by the canvas hover preview (zoomed out) and
 * the zoomed-in info popup so a wall-of-text prompt reads as a short line.
 *
 * Caching by text (not terminal id) means identical prompts across terminals
 * share a single request, and a terminal's summary is reused as long as its
 * last command is unchanged. Requests are de-duplicated while in flight.
 */
export const useSummaryStore = defineStore("summary", () => {
  const summaries = ref<Map<string, string>>(new Map());
  const inflight = new Set<string>();

  function isLong(text: string | null | undefined): boolean {
    return !!text && text.length > SUMMARY_LONG_THRESHOLD;
  }

  /** Current cached summary for `text`, or null if not fetched yet. */
  function get(text: string): string | null {
    return summaries.value.get(text) ?? null;
  }

  /**
   * Ensure a summary for `text` is being (or has been) fetched. Safe to call
   * repeatedly (e.g. on every hover) -- it no-ops once cached or in flight.
   * Only long text is sent; short text is its own summary.
   */
  function request(text: string): void {
    if (!isLong(text)) return;
    if (summaries.value.has(text) || inflight.has(text)) return;
    if (typeof window.api === "undefined") return;

    inflight.add(text);
    window.api.groq
      .summarizeCommand(text)
      .then((summary) => {
        const next = new Map(summaries.value);
        next.set(text, summary || text);
        summaries.value = next;
      })
      .catch(() => {
        // Fall back to a plain truncation so the UI still shows something.
        const next = new Map(summaries.value);
        next.set(text, text.slice(0, SUMMARY_LONG_THRESHOLD - 1) + "…");
        summaries.value = next;
      })
      .finally(() => {
        inflight.delete(text);
      });
  }

  /**
   * The best available display text for a command: the AI summary if the text
   * is long and one has arrived, a plain truncation while it's still loading,
   * or the text itself when it's already short.
   */
  function display(text: string): string {
    if (!isLong(text)) return text;
    return get(text) ?? text.slice(0, SUMMARY_LONG_THRESHOLD - 1) + "…";
  }

  return { summaries, isLong, get, request, display };
});
