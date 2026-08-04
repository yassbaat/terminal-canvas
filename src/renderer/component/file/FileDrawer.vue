<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount } from "vue";
import {
  FolderOpen,
  RefreshCw,
  Eye,
  EyeOff,
  FilePlus,
  FolderPlus,
  Trash2,
  ExternalLink,
} from "lucide-vue-next";
import type { DirEntry } from "@renderer/type/file";
import { getBasename } from "@renderer/util/path";
import FileTreeNode from "./FileTreeNode.vue";

/**
 * Per-terminal file explorer, rooted at that terminal's project folder
 * (session.fileRoot -- the enclosing git repo when there is one, otherwise the
 * cwd). Clicking a file opens it as a tab in the terminal; dragging one onto
 * empty canvas detaches it into its own node.
 */
const props = defineProps<{
  terminalId: string;
  root: string;
  activePath: string | null;
}>();

const emit = defineEmits<{
  (e: "open", path: string): void;
  (e: "root-change", dir: string): void;
  (e: "drag-file", payload: { path: string; event: DragEvent }): void;
}>();

const entries = ref<DirEntry[]>([]);
const loading = ref(false);
const error = ref<string | null>(null);
const showHidden = ref(false);
const treeKey = ref(0);

const menu = ref<{ entry: DirEntry | null; x: number; y: number } | null>(null);
const renaming = ref<{ path: string; value: string } | null>(null);
const creating = ref<{ dir: string; kind: "file" | "directory"; value: string } | null>(null);

const rootLabel = computed(() => getBasename(props.root) || props.root);

let disposeWatcher: (() => void) | null = null;
let rootWatchId: string | null = null;

async function loadRoot(): Promise<void> {
  loading.value = true;
  error.value = null;
  try {
    entries.value = await window.api.file.listDir(props.root, showHidden.value);
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
    entries.value = [];
  }
  loading.value = false;
}

/**
 * Remounting the whole tree is the honest way to refresh it: expansion state
 * lives in each FileTreeNode, and a targeted refresh would only cover the one
 * directory that changed while leaving stale grandchildren behind.
 */
function refreshTree(): void {
  treeKey.value++;
  void loadRoot();
}

async function watchRoot(): Promise<void> {
  if (rootWatchId) {
    void window.api.file.unwatch(rootWatchId);
    rootWatchId = null;
  }
  try {
    rootWatchId = await window.api.file.watch(props.root, "directory");
  } catch {
    // Best effort -- the tree still works, it just won't self-refresh.
  }
}

async function pickRoot(): Promise<void> {
  const result = await window.api.dialog.showOpenDialog({
    title: "Choose a folder for this terminal's file explorer",
    defaultPath: props.root,
    properties: ["openDirectory"],
  });
  if (result.canceled || result.filePaths.length === 0) return;
  const dir = result.filePaths[0];
  // Grant access before anything tries to read it -- the guard's allowlist is
  // built from terminal roots and explicitly-picked folders only.
  await window.api.file.addRoot(dir);
  emit("root-change", dir);
}

function openContext(payload: { entry: DirEntry; x: number; y: number }): void {
  menu.value = { entry: payload.entry, x: payload.x, y: payload.y };
}

function openRootContext(event: MouseEvent): void {
  menu.value = { entry: null, x: event.clientX, y: event.clientY };
}

function closeMenu(): void {
  menu.value = null;
}

/** Directory a new item should land in: the clicked folder, else its parent, else the root. */
function targetDir(): string {
  const entry = menu.value?.entry;
  if (!entry) return props.root;
  if (entry.isDirectory) return entry.path;
  return entry.path.slice(0, entry.path.lastIndexOf("/"));
}

function startCreate(kind: "file" | "directory"): void {
  creating.value = { dir: targetDir(), kind, value: "" };
  closeMenu();
}

async function commitCreate(): Promise<void> {
  const pending = creating.value;
  creating.value = null;
  if (!pending || !pending.value.trim()) return;
  const path = `${pending.dir}/${pending.value.trim()}`;
  try {
    if (pending.kind === "file") {
      await window.api.file.createFile(path);
      emit("open", path);
    } else {
      await window.api.file.createDirectory(path);
    }
    refreshTree();
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  }
}

function startRename(): void {
  const entry = menu.value?.entry;
  if (!entry) return;
  renaming.value = { path: entry.path, value: entry.name };
  closeMenu();
}

async function commitRename(): Promise<void> {
  const pending = renaming.value;
  renaming.value = null;
  if (!pending || !pending.value.trim()) return;
  const dir = pending.path.slice(0, pending.path.lastIndexOf("/"));
  try {
    await window.api.file.rename(pending.path, `${dir}/${pending.value.trim()}`);
    refreshTree();
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  }
}

async function trashEntry(): Promise<void> {
  const entry = menu.value?.entry;
  closeMenu();
  if (!entry) return;
  try {
    await window.api.file.trash(entry.path);
    refreshTree();
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  }
}

async function revealEntry(): Promise<void> {
  const entry = menu.value?.entry;
  closeMenu();
  await window.api.file.reveal(entry ? entry.path : props.root);
}

watch(
  () => props.root,
  () => {
    refreshTree();
    void watchRoot();
  }
);

watch(showHidden, () => refreshTree());

onMounted(async () => {
  await loadRoot();
  await watchRoot();
  // Only the root listing self-refreshes; expanded subdirectories refresh when
  // reopened. Watching every expanded directory would mean an OS handle per
  // folder the user happens to have clicked, for very little gain.
  disposeWatcher = window.api.file.onChanged((event) => {
    if (event.kind === "directory" && event.path === props.root) void loadRoot();
  });
  window.addEventListener("click", closeMenu);
});

onBeforeUnmount(() => {
  disposeWatcher?.();
  if (rootWatchId) void window.api.file.unwatch(rootWatchId);
  window.removeEventListener("click", closeMenu);
});
</script>

<template>
  <div class="file-drawer nodrag nowheel" @contextmenu.prevent="openRootContext">
    <div class="drawer-header">
      <button class="drawer-root" :title="root" @click="pickRoot">
        <FolderOpen :size="13" />
        <span class="drawer-root-name">{{ rootLabel }}</span>
      </button>
      <div class="drawer-actions">
        <button
          class="drawer-btn"
          :title="showHidden ? 'Hide ignored folders' : 'Show ignored folders (.git, node_modules…)'"
          @click.stop="showHidden = !showHidden"
        >
          <component :is="showHidden ? Eye : EyeOff" :size="13" />
        </button>
        <button class="drawer-btn" title="Refresh" @click.stop="refreshTree">
          <RefreshCw :size="13" />
        </button>
      </div>
    </div>

    <div class="drawer-body">
      <div v-if="loading" class="drawer-hint">Loading…</div>
      <div v-else-if="error" class="drawer-hint drawer-hint-error">{{ error }}</div>
      <div v-else-if="entries.length === 0" class="drawer-hint">Empty folder</div>

      <FileTreeNode
        v-for="entry in entries"
        :key="`${treeKey}-${entry.path}`"
        :entry="entry"
        :depth="0"
        :active-path="activePath"
        :show-hidden="showHidden"
        @open="emit('open', $event)"
        @context="openContext"
        @drag-file="emit('drag-file', $event)"
      />

      <div v-if="creating" class="drawer-input-row">
        <input
          v-model="creating.value"
          class="drawer-input"
          :placeholder="creating.kind === 'file' ? 'new-file.ts' : 'new-folder'"
          autofocus
          @keydown.enter="commitCreate"
          @keydown.esc="creating = null"
          @blur="commitCreate"
        />
      </div>

      <div v-if="renaming" class="drawer-input-row">
        <input
          v-model="renaming.value"
          class="drawer-input"
          autofocus
          @keydown.enter="commitRename"
          @keydown.esc="renaming = null"
          @blur="commitRename"
        />
      </div>
    </div>

    <!-- Positioned in viewport coordinates and teleported to <body> so the
         canvas transform doesn't scale or clip it. -->
    <Teleport to="body">
      <div
        v-if="menu"
        class="drawer-menu"
        :style="{ left: `${menu.x}px`, top: `${menu.y}px` }"
        @click.stop
      >
        <button class="menu-item" @click="startCreate('file')">
          <FilePlus :size="13" /> New file
        </button>
        <button class="menu-item" @click="startCreate('directory')">
          <FolderPlus :size="13" /> New folder
        </button>
        <template v-if="menu.entry">
          <div class="menu-divider" />
          <button class="menu-item" @click="startRename">Rename…</button>
          <button class="menu-item menu-item-danger" @click="trashEntry">
            <Trash2 :size="13" /> Move to Trash
          </button>
        </template>
        <div class="menu-divider" />
        <button class="menu-item" @click="revealEntry">
          <ExternalLink :size="13" /> Reveal in file manager
        </button>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.file-drawer {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-width: 0;
  background: var(--tc-memory-bg);
  border-right: 1px solid var(--tc-border-color);
  overflow: hidden;
}

.drawer-header {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 4px 4px 6px;
  border-bottom: 1px solid var(--tc-border-color);
  background: var(--tc-bg-header);
}

.drawer-root {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 1;
  min-width: 0;
  padding: 3px 4px;
  background: none;
  border: none;
  border-radius: var(--tc-border-radius-sm);
  /* Full contrast, not secondary -- this is the file explorer's own title and
     should read as clearly as the terminal name does in the header above it. */
  color: var(--tc-text-primary);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}

.drawer-root:hover {
  background: var(--tc-bg-hover);
  color: var(--tc-text-primary);
}

.drawer-root-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.drawer-actions {
  display: flex;
  gap: 1px;
}

.drawer-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  background: none;
  border: none;
  border-radius: var(--tc-border-radius-sm);
  color: var(--tc-text-muted);
  cursor: pointer;
}

.drawer-btn:hover {
  background: var(--tc-bg-hover);
  color: var(--tc-text-primary);
}

.drawer-body {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 4px 0;
}

.drawer-hint {
  padding: 6px 8px;
  font-size: 11px;
  font-style: italic;
  color: var(--tc-text-muted);
}

.drawer-hint-error {
  color: var(--tc-error);
  font-style: normal;
}

.drawer-input-row {
  padding: 2px 6px;
}

.drawer-input {
  width: 100%;
  padding: 2px 4px;
  background: var(--tc-bg-card);
  border: 1px solid var(--tc-accent);
  border-radius: var(--tc-border-radius-sm);
  color: var(--tc-text-primary);
  font-size: 11.5px;
  font-family: var(--tc-font-mono);
  outline: none;
}

.drawer-menu {
  position: fixed;
  z-index: var(--tc-z-modal, 1000);
  min-width: 180px;
  padding: 4px;
  background: var(--tc-bg-card);
  border: 1px solid var(--tc-border-color);
  border-radius: var(--tc-border-radius);
  box-shadow: var(--tc-shadow-lg);
}

.menu-item {
  display: flex;
  align-items: center;
  gap: 7px;
  width: 100%;
  padding: 5px 8px;
  background: none;
  border: none;
  border-radius: var(--tc-border-radius-sm);
  color: var(--tc-text-secondary);
  font-size: 12px;
  text-align: left;
  cursor: pointer;
}

.menu-item:hover {
  background: var(--tc-bg-hover);
  color: var(--tc-text-primary);
}

.menu-item-danger:hover {
  background: var(--tc-accent-soft);
  color: var(--tc-accent);
}

.menu-divider {
  height: 1px;
  margin: 4px 2px;
  background: var(--tc-border-color);
}
</style>
