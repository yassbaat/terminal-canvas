<script setup lang="ts">
import { ref, computed, watch, nextTick, onUnmounted } from "vue";
import { useUIStore } from "@renderer/store/ui";
import { getBasename, getDirname } from "@renderer/util/path";
import { openPathInWorkspace } from "@renderer/util/openPath";
import type { FileSearchHit, FileSearchMode } from "@renderer/type/file";
import { FileText, Search, Code2, CornerDownLeft } from "lucide-vue-next";

/**
 * Project-wide search: find a file by name, or a line of code by its text,
 * across every project folder the workspace currently has open.
 *
 * Both modes hit the same main-process walker (see main/file/file-search.ts),
 * which is capped and cancellable -- so holding a key down can't pile up walks
 * behind the terminals' own output.
 */
const uiStore = useUIStore();

const query = ref("");
const hits = ref<FileSearchHit[]>([]);
const selectedIndex = ref(0);
const searching = ref(false);
const truncated = ref(false);
const rootCount = ref(0);
const inputRef = ref<HTMLInputElement | null>(null);
const listRef = ref<HTMLElement | null>(null);

const mode = computed<FileSearchMode>(() => uiStore.searchMode);

/**
 * Only the newest request may write to the list. The main process abandons
 * superseded walks, but a slower earlier one can still resolve after a faster
 * later one -- without this, its stale (or empty) results would land last.
 */
let requestId = 0;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;

async function runSearch(): Promise<void> {
  const text = query.value.trim();
  const id = ++requestId;

  if (text.length < (mode.value === "content" ? 2 : 1)) {
    hits.value = [];
    truncated.value = false;
    searching.value = false;
    return;
  }

  searching.value = true;
  try {
    const result = await window.api.file.search(text, mode.value, 200);
    if (id !== requestId) return;
    // A superseded walk reports no hits by design; rendering them would blank
    // the list mid-typing.
    if (result.superseded) return;
    hits.value = result.hits;
    truncated.value = result.truncated;
    rootCount.value = result.rootCount;
    selectedIndex.value = 0;
  } catch (err) {
    if (id !== requestId) return;
    console.error("[Search] failed", err);
    hits.value = [];
  } finally {
    if (id === requestId) searching.value = false;
  }
}

function scheduleSearch(): void {
  if (debounceTimer) clearTimeout(debounceTimer);
  // Content search reads files, so it waits for a real pause in typing; name
  // search is cheap enough to feel live.
  debounceTimer = setTimeout(runSearch, mode.value === "content" ? 220 : 110);
}

watch(query, scheduleSearch);
watch(mode, () => {
  hits.value = [];
  void runSearch();
});

watch(
  () => uiStore.searchOpen,
  (open) => {
    if (!open) return;
    void nextTick(() => {
      inputRef.value?.focus();
      // Keep the previous query but pre-select it, so typing replaces it and
      // Enter re-runs it -- the same feel as a browser's find bar.
      inputRef.value?.select();
    });
    if (query.value.trim()) void runSearch();
  }
);

onUnmounted(() => {
  if (debounceTimer) clearTimeout(debounceTimer);
});

function setMode(next: FileSearchMode): void {
  uiStore.searchMode = next;
  inputRef.value?.focus();
}

async function openHit(hit: FileSearchHit): Promise<void> {
  uiStore.closeSearch();
  await openPathInWorkspace(hit.path);
}

function move(delta: number): void {
  if (hits.value.length === 0) return;
  selectedIndex.value =
    (selectedIndex.value + delta + hits.value.length) % hits.value.length;
  void nextTick(() => {
    listRef.value
      ?.querySelector(".search-row.selected")
      ?.scrollIntoView({ block: "nearest" });
  });
}

function handleKeydown(e: KeyboardEvent): void {
  if (e.key === "ArrowDown") {
    move(1);
    e.preventDefault();
  } else if (e.key === "ArrowUp") {
    move(-1);
    e.preventDefault();
  } else if (e.key === "Enter") {
    const hit = hits.value[selectedIndex.value];
    if (hit) void openHit(hit);
    e.preventDefault();
  } else if (e.key === "Escape") {
    uiStore.closeSearch();
    e.preventDefault();
  } else if (e.key === "Tab") {
    setMode(mode.value === "name" ? "content" : "name");
    e.preventDefault();
  }
}

const emptyMessage = computed(() => {
  if (rootCount.value === 0) {
    return "No project folders are open yet — start a terminal in a project first.";
  }
  if (query.value.trim().length < (mode.value === "content" ? 2 : 1)) {
    return mode.value === "content"
      ? "Type at least two characters to search file contents."
      : "Type to find a file by name.";
  }
  return searching.value ? "Searching…" : "No matches.";
});
</script>

<template>
  <div v-if="uiStore.searchOpen" class="search-overlay" @click="uiStore.closeSearch()">
    <div class="search-dialog" @click.stop>
      <div class="search-head">
        <Search :size="15" class="search-icon" />
        <input
          ref="inputRef"
          v-model="query"
          class="search-input"
          :placeholder="mode === 'name' ? 'Find a file by name…' : 'Find text in files…'"
          spellcheck="false"
          @keydown="handleKeydown"
        />
        <div class="search-modes">
          <button
            type="button"
            class="search-mode-btn"
            :class="{ active: mode === 'name' }"
            title="Match file names (Tab to switch)"
            @click="setMode('name')"
          >
            <FileText :size="13" />
            Files
          </button>
          <button
            type="button"
            class="search-mode-btn"
            :class="{ active: mode === 'content' }"
            title="Match text inside files (Tab to switch)"
            @click="setMode('content')"
          >
            <Code2 :size="13" />
            Code
          </button>
        </div>
      </div>

      <div v-if="hits.length > 0" ref="listRef" class="search-list">
        <button
          v-for="(hit, i) in hits"
          :key="`${hit.path}:${hit.line ?? 0}:${i}`"
          class="search-row"
          :class="{ selected: i === selectedIndex }"
          @click="openHit(hit)"
          @mouseenter="selectedIndex = i"
        >
          <span class="search-row-main">
            <span class="search-name">
              {{ getBasename(hit.path) }}
              <span v-if="hit.line" class="search-line">:{{ hit.line }}</span>
            </span>
            <span class="search-dir">{{ getDirname(hit.relativePath) === '.' ? '' : getDirname(hit.relativePath) }}</span>
          </span>
          <span v-if="hit.preview" class="search-preview">
            <span>{{ hit.preview.slice(0, hit.matchStart) }}</span>
            <mark class="search-mark">{{ hit.preview.slice(hit.matchStart, hit.matchEnd) }}</mark>
            <span>{{ hit.preview.slice(hit.matchEnd) }}</span>
          </span>
        </button>
      </div>

      <div v-else class="search-empty">{{ emptyMessage }}</div>

      <div class="search-foot">
        <span class="search-hint">
          <CornerDownLeft :size="12" /> open
          <span class="search-sep">·</span> ↑↓ move
          <span class="search-sep">·</span> Tab switches Files / Code
        </span>
        <span v-if="truncated" class="search-capped">Showing the first matches only</span>
        <span v-else-if="hits.length > 0" class="search-count">{{ hits.length }} result(s)</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.search-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  justify-content: center;
  align-items: flex-start;
  padding-top: 12vh;
  z-index: var(--tc-z-modal);
}

.search-dialog {
  width: 680px;
  max-width: 92vw;
  background: var(--tc-bg-card);
  border: 1px solid var(--tc-border-color);
  border-radius: var(--tc-border-radius);
  box-shadow: var(--tc-shadow-lg);
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.search-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--tc-border-color);
}

.search-icon {
  color: var(--tc-text-muted);
  flex-shrink: 0;
}

.search-input {
  flex: 1;
  min-width: 0;
  border: none;
  background: transparent;
  color: var(--tc-text-primary);
  font-size: var(--tc-font-size-md);
  font-family: var(--tc-font-sans);
  outline: none;
}

.search-input::placeholder {
  color: var(--tc-text-muted);
}

.search-modes {
  display: flex;
  gap: 2px;
  padding: 2px;
  background: var(--tc-bg-secondary);
  border-radius: var(--tc-border-radius-sm);
  flex-shrink: 0;
}

.search-mode-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 4px 9px;
  border: none;
  background: transparent;
  color: var(--tc-text-muted);
  border-radius: var(--tc-border-radius-sm);
  cursor: pointer;
  font-size: var(--tc-font-size-xs);
  font-family: var(--tc-font-sans);
  transition: all var(--tc-transition-fast);
}

.search-mode-btn:hover {
  color: var(--tc-text-primary);
}

.search-mode-btn.active {
  background: var(--tc-bg-card);
  color: var(--tc-accent);
  box-shadow: var(--tc-shadow-sm);
}

.search-list {
  max-height: 52vh;
  overflow-y: auto;
  padding: 4px 0;
}

.search-row {
  display: flex;
  flex-direction: column;
  gap: 2px;
  width: 100%;
  padding: 7px 14px;
  border: none;
  border-left: 2px solid transparent;
  background: transparent;
  text-align: left;
  cursor: pointer;
  font-family: var(--tc-font-sans);
}

.search-row.selected {
  background: var(--tc-bg-hover);
  border-left-color: var(--tc-accent);
}

.search-row-main {
  display: flex;
  align-items: baseline;
  gap: 8px;
  min-width: 0;
}

.search-name {
  font-size: var(--tc-font-size-sm);
  color: var(--tc-text-primary);
  font-weight: 500;
  white-space: nowrap;
}

.search-line {
  color: var(--tc-text-muted);
  font-weight: 400;
  font-family: var(--tc-font-mono);
}

.search-dir {
  flex: 1;
  min-width: 0;
  font-size: var(--tc-font-size-xs);
  color: var(--tc-text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  direction: rtl;
  text-align: left;
}

.search-preview {
  font-family: var(--tc-font-mono);
  font-size: var(--tc-font-size-xs);
  color: var(--tc-text-secondary);
  white-space: pre;
  overflow: hidden;
  text-overflow: ellipsis;
}

.search-mark {
  background: color-mix(in srgb, var(--tc-accent) 32%, transparent);
  color: var(--tc-text-primary);
  border-radius: 2px;
}

.search-empty {
  padding: 26px 18px;
  text-align: center;
  color: var(--tc-text-muted);
  font-size: var(--tc-font-size-sm);
}

.search-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 7px 12px;
  border-top: 1px solid var(--tc-border-color);
  background: var(--tc-bg-header);
  font-size: var(--tc-font-size-xs);
  color: var(--tc-text-muted);
}

.search-hint {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}

.search-sep {
  opacity: 0.5;
}

.search-capped {
  color: var(--tc-attention);
}
</style>
