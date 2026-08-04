import { acceptHMRUpdate, defineStore } from "pinia";
import { useUIStore } from "@renderer/store/ui";
import { ref, computed } from "vue";
import type { OpenFileState } from "@renderer/type/file";
import { getBasename } from "@renderer/util/path";
import { useTerminalStore } from "@renderer/store/terminal";

/**
 * Open-file state: content, dirty tracking, watchers and conflict handling.
 *
 * Files are keyed by absolute path and shared across every surface that shows
 * them -- a file open as a tab in two terminals, or as a tab and a detached
 * canvas node, is one buffer with one watcher. That's what makes "the agent
 * rewrote this file" update everywhere at once, and it's why the entry is
 * refcounted rather than owned by whichever component opened it first.
 *
 * Node geometry for detached file nodes lives in the workspace store alongside
 * notes and groups; this store deliberately holds nothing persistent.
 */
export const useFileStore = defineStore("file", () => {
  const files = ref<Map<string, OpenFileState>>(new Map());
  /** How many surfaces currently show each path. Drops to 0 -> close and unwatch. */
  const refCounts = ref<Map<string, number>>(new Map());

  /** Per-terminal tab order. The terminal itself is always tab 0 and isn't listed. */
  const tabsByTerminal = ref<Map<string, string[]>>(new Map());
  /** Which tab each terminal is showing; null means the terminal itself. */
  const activeTabByTerminal = ref<Map<string, string | null>>(new Map());
  /**
   * Tabs the user has marked, per terminal. Distinct from the *active* tab:
   * marking is a multi-select that says "these files, specifically" to whatever
   * acts on the terminal next -- today that's Option-drag duplication, which
   * carries the marked tabs into the copy and nothing else.
   */
  const markedTabsByTerminal = ref<Map<string, Set<string>>>(new Map());

  let disposeWatchListener: (() => void) | null = null;

  const getFile = computed(() => (path: string) => files.value.get(path));

  const isDirty = computed(() => (path: string) => {
    const f = files.value.get(path);
    return !!f && !f.binary && f.draft !== f.content;
  });

  const getTabs = computed(() => (terminalId: string) => tabsByTerminal.value.get(terminalId) ?? []);

  const getActiveTab = computed(
    () => (terminalId: string) => activeTabByTerminal.value.get(terminalId) ?? null
  );

  const isTabMarked = computed(
    () => (terminalId: string, path: string) =>
      markedTabsByTerminal.value.get(terminalId)?.has(path) ?? false
  );

  /** Marked tabs in tab order, so a copy opens them the way they were arranged. */
  const getMarkedTabs = computed(() => (terminalId: string) => {
    const marked = markedTabsByTerminal.value.get(terminalId);
    if (!marked || marked.size === 0) return [];
    return (tabsByTerminal.value.get(terminalId) ?? []).filter((p) => marked.has(p));
  });

  function toggleTabMark(terminalId: string, path: string): void {
    const next = new Map(markedTabsByTerminal.value);
    const marked = new Set(next.get(terminalId) ?? []);
    if (marked.has(path)) marked.delete(path);
    else marked.add(path);
    if (marked.size === 0) next.delete(terminalId);
    else next.set(terminalId, marked);
    markedTabsByTerminal.value = next;
  }

  function clearTabMarks(terminalId: string): void {
    if (!markedTabsByTerminal.value.has(terminalId)) return;
    const next = new Map(markedTabsByTerminal.value);
    next.delete(terminalId);
    markedTabsByTerminal.value = next;
  }

  const dirtyPaths = computed(() =>
    [...files.value.values()].filter((f) => !f.binary && f.draft !== f.content).map((f) => f.path)
  );

  function touch(): void {
    // Map mutations aren't reactive on their own; reassigning the ref is the
    // pattern the terminal store already uses for its session Map.
    files.value = new Map(files.value);
  }

  // ─── Loading ─────────────────────────────────────────────────────

  async function loadContent(path: string, preserveDraft: boolean): Promise<void> {
    const entry = files.value.get(path);
    if (!entry) return;
    entry.loading = true;
    entry.error = null;
    touch();

    try {
      const result = await window.api.file.read(path);
      const current = files.value.get(path);
      if (!current) return; // closed while we were reading
      current.content = result.content;
      current.mtimeMs = result.mtimeMs;
      current.truncated = result.truncated;
      current.binary = result.binary;
      current.loading = false;
      current.error = null;
      // A reload triggered by an external change while the buffer was clean
      // should move the editor with it; a reload the user asked for after a
      // conflict should replace their draft too. Only a still-dirty buffer
      // keeps its draft, and that path sets externalChange instead.
      if (!preserveDraft) {
        current.draft = result.content;
        current.externalChange = false;
      }
    } catch (error) {
      const current = files.value.get(path);
      if (!current) return;
      current.loading = false;
      current.error = error instanceof Error ? error.message : String(error);
    }
    touch();
  }

  /**
   * Open (or re-attach to) a file. Safe to call repeatedly for the same path --
   * each call takes a reference that a matching `close` releases.
   */
  async function open(path: string): Promise<void> {
    refCounts.value.set(path, (refCounts.value.get(path) ?? 0) + 1);

    if (files.value.has(path)) return;

    files.value.set(path, {
      path,
      content: "",
      draft: "",
      mtimeMs: 0,
      truncated: false,
      binary: false,
      loading: true,
      error: null,
      externalChange: false,
      watchId: null,
    });
    touch();

    await loadContent(path, false);

    const entry = files.value.get(path);
    if (!entry) return;
    try {
      entry.watchId = await window.api.file.watch(path, "file");
    } catch {
      // Watching is best-effort: without it the file simply doesn't live-reload.
    }
  }

  function close(path: string): void {
    const count = (refCounts.value.get(path) ?? 1) - 1;
    if (count > 0) {
      refCounts.value.set(path, count);
      return;
    }
    refCounts.value.delete(path);

    const entry = files.value.get(path);
    if (entry?.watchId) void window.api.file.unwatch(entry.watchId);
    files.value.delete(path);
    touch();
  }

  // ─── Editing ─────────────────────────────────────────────────────

  function setDraft(path: string, draft: string): void {
    const entry = files.value.get(path);
    if (!entry || entry.draft === draft) return;
    entry.draft = draft;
    touch();
  }

  /**
   * Write the draft back to disk.
   *
   * `expectedMtimeMs` is what makes this safe to use next to a coding agent:
   * if the file changed underneath us the write is refused and reported as a
   * conflict rather than silently discarding the agent's edit. Passing
   * `force` skips the check, which is the "Keep mine" branch of the conflict UI.
   */
  async function save(path: string, force = false): Promise<{ ok: boolean; conflict: boolean }> {
    const entry = files.value.get(path);
    if (!entry || entry.binary) return { ok: false, conflict: false };
    if (entry.truncated) {
      entry.error = "This file was too large to load fully and can't be saved from here.";
      touch();
      return { ok: false, conflict: false };
    }

    // Snapshot what we're actually writing. The write is a full IPC round trip
    // (stat + write + rename + stat), so anything typed while it is in flight
    // lands in `draft` afterwards. Marking the buffer clean against the *new*
    // draft claimed those keystrokes were saved when they never left the
    // renderer -- and cleared the "Unsaved" marker, the tab-close confirm and
    // the quit guard along with them.
    const pending = entry.draft;

    try {
      const result = await window.api.file.write(
        path,
        pending,
        force ? undefined : entry.mtimeMs
      );
      const current = files.value.get(path);
      if (!current) return { ok: result.ok, conflict: false };

      if (result.conflict) {
        current.externalChange = true;
        touch();
        return { ok: false, conflict: true };
      }

      // Compared against the snapshot, so a buffer that moved on mid-write
      // correctly stays dirty.
      current.content = pending;
      current.mtimeMs = result.mtimeMs;
      current.externalChange = false;
      current.error = null;
      touch();
      return { ok: true, conflict: false };
    } catch (error) {
      const current = files.value.get(path);
      if (current) {
        current.error = error instanceof Error ? error.message : String(error);
        touch();
      }
      return { ok: false, conflict: false };
    }
  }

  /** Conflict resolution: throw away local edits and take what's on disk. */
  async function revert(path: string): Promise<void> {
    await loadContent(path, false);
  }

  // ─── Tabs ────────────────────────────────────────────────────────

  async function openInTerminal(terminalId: string, path: string): Promise<void> {
    const tabs = [...(tabsByTerminal.value.get(terminalId) ?? [])];
    if (!tabs.includes(path)) {
      tabs.push(path);
      tabsByTerminal.value.set(terminalId, tabs);
      tabsByTerminal.value = new Map(tabsByTerminal.value);
      await open(path);
    }
    setActiveTab(terminalId, path);
  }

  function closeInTerminal(terminalId: string, path: string): void {
    const tabs = tabsByTerminal.value.get(terminalId);
    if (!tabs || !tabs.includes(path)) return;

    const index = tabs.indexOf(path);
    const next = tabs.filter((p) => p !== path);
    tabsByTerminal.value.set(terminalId, next);
    tabsByTerminal.value = new Map(tabsByTerminal.value);

    if (activeTabByTerminal.value.get(terminalId) === path) {
      // Fall back to the neighbour that took this tab's place, then the one
      // before it, then the terminal itself -- same as every tabbed editor.
      setActiveTab(terminalId, next[index] ?? next[index - 1] ?? null);
    }
    // A mark on a tab that no longer exists would silently ride along into the
    // next duplicate.
    if (markedTabsByTerminal.value.get(terminalId)?.has(path)) {
      toggleTabMark(terminalId, path);
    }
    close(path);
    persistTabs(terminalId);
  }

  function setActiveTab(terminalId: string, path: string | null): void {
    activeTabByTerminal.value.set(terminalId, path);
    activeTabByTerminal.value = new Map(activeTabByTerminal.value);
    persistTabs(terminalId);
  }

  function moveTab(terminalId: string, from: number, to: number): void {
    const tabs = [...(tabsByTerminal.value.get(terminalId) ?? [])];
    if (from < 0 || from >= tabs.length || to < 0 || to >= tabs.length) return;
    const [moved] = tabs.splice(from, 1);
    tabs.splice(to, 0, moved);
    tabsByTerminal.value.set(terminalId, tabs);
    tabsByTerminal.value = new Map(tabsByTerminal.value);
    persistTabs(terminalId);
  }

  /**
   * Mirror tab state onto the session. Workspace saves serialize the renderer's
   * sessions verbatim, so writing it here is all it takes for tabs to persist --
   * no IPC round-trip, and no second source of truth to keep in sync.
   */
  function persistTabs(terminalId: string): void {
    useTerminalStore().updateSession(terminalId, {
      openFiles: tabsByTerminal.value.get(terminalId) ?? [],
      activeFile: activeTabByTerminal.value.get(terminalId) ?? null,
    });
  }

  /** Re-open the tabs a saved workspace recorded for a terminal. */
  async function restoreTabs(
    terminalId: string,
    paths: string[],
    activePath: string | null
  ): Promise<void> {
    if (paths.length === 0) return;
    const opened: string[] = [];
    for (const path of paths) {
      try {
        const stat = await window.api.file.stat(path);
        // Files move and get deleted between sessions; a stale tab should just
        // not come back rather than restoring as an error card.
        if (!stat.exists || stat.isDirectory) continue;
        await open(path);
        opened.push(path);
      } catch {
        // Outside the allowlist now (its terminal points elsewhere) -- skip it.
      }
    }
    if (opened.length === 0) return;
    tabsByTerminal.value.set(terminalId, opened);
    tabsByTerminal.value = new Map(tabsByTerminal.value);
    activeTabByTerminal.value.set(
      terminalId,
      activePath && opened.includes(activePath) ? activePath : null
    );
    activeTabByTerminal.value = new Map(activeTabByTerminal.value);
  }

  /** Drop every tab for a terminal that's going away. */
  /** Paths with unsaved edits among a single terminal's open tabs. */
  function dirtyPathsForTerminal(terminalId: string): string[] {
    const tabs = tabsByTerminal.value.get(terminalId) ?? [];
    return tabs.filter((p) => isDirty.value(p));
  }

  /**
   * Ask before throwing away unsaved edits. Returns false if the caller should
   * abandon whatever it was about to do.
   *
   * Every path that tears a terminal down eventually calls clearForTerminal,
   * which drops buffers unconditionally -- so the guard has to sit in front of
   * those calls, not inside the store's own bookkeeping. A save can come back
   * with `conflict` when the file changed on disk underneath us (routine when
   * an agent is editing the same file); closing anyway after promising to save
   * would discard exactly what the prompt offered to keep.
   */
  async function confirmDiscard(paths: string[]): Promise<boolean> {
    if (paths.length === 0) return true;

    const { response } = await window.api.dialog.showMessageBox({
      type: "question",
      message:
        paths.length === 1
          ? "You have 1 file with unsaved changes."
          : `You have ${paths.length} files with unsaved changes.`,
      detail: paths.map((p) => p.split(/[\\/]/).pop()).join(", "),
      buttons: ["Save All", "Discard Changes", "Cancel"],
      defaultId: 0,
      cancelId: 2,
    });

    if (response === 2) return false;
    if (response === 1) return true;

    const results = await Promise.all(paths.map((p) => save(p)));
    const failed = results.filter((r) => !r.ok).length;
    if (failed > 0) {
      useUIStore().showToast(
        failed === 1
          ? "A file changed on disk and couldn't be saved — resolve it first"
          : `${failed} files changed on disk and couldn't be saved — resolve them first`
      );
      return false;
    }
    return true;
  }

  function clearForTerminal(terminalId: string): void {
    const tabs = tabsByTerminal.value.get(terminalId) ?? [];
    for (const path of tabs) close(path);
    tabsByTerminal.value.delete(terminalId);
    tabsByTerminal.value = new Map(tabsByTerminal.value);
    activeTabByTerminal.value.delete(terminalId);
    activeTabByTerminal.value = new Map(activeTabByTerminal.value);
    clearTabMarks(terminalId);
  }

  // ─── Watching ────────────────────────────────────────────────────

  function setupListeners(): void {
    if (disposeWatchListener) return;
    disposeWatchListener = window.api.file.onChanged(async (event) => {
      if (event.kind !== "file") return;
      const entry = files.value.get(event.path);
      if (!entry) return;

      // Our own save fires this watcher. Without this check, saving and then
      // continuing to type inside the 120ms watcher debounce would find the
      // buffer dirty again and raise a "changed on disk" conflict banner for
      // the user's own write. Comparing against the mtime `file:write` handed
      // back also swallows spurious watcher fires with no real change.
      try {
        const stat = await window.api.file.stat(event.path);
        if (stat.exists && stat.mtimeMs === entry.mtimeMs) return;
      } catch {
        // Can't stat it -- fall through and let the reload path report why.
      }

      const dirty = entry.draft !== entry.content;
      if (dirty) {
        // Never clobber unsaved edits. The editor shows a banner and the user
        // picks; this is the case that happens constantly when an agent is
        // working in a file you also have open.
        entry.externalChange = true;
        touch();
        return;
      }
      // Clean buffer: follow the file. This is the point of the whole feature --
      // watching an agent rewrite a file live.
      await loadContent(event.path, false);
    });
  }

  function displayName(path: string): string {
    return getBasename(path);
  }

  return {
    files,
    getFile,
    isDirty,
    dirtyPaths,
    getTabs,
    getActiveTab,
    isTabMarked,
    getMarkedTabs,
    toggleTabMark,
    clearTabMarks,
    open,
    close,
    setDraft,
    save,
    revert,
    reload: (path: string) => loadContent(path, false),
    openInTerminal,
    closeInTerminal,
    setActiveTab,
    moveTab,
    restoreTabs,
    clearForTerminal,
    dirtyPathsForTerminal,
    confirmDiscard,
    setupListeners,
    displayName,
  };
});

// Pinia caches store instances by id, so a hot-swapped store module would
// otherwise leave every component bound to the instance built from the *old*
// code -- newly added state and getters simply wouldn't exist on it, and the
// symptom is a component rendering as if half its data vanished. This patches
// the live instance instead. Dev only: `import.meta.hot` is undefined in a
// production build, so the block drops out.
if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useFileStore, import.meta.hot));
}
