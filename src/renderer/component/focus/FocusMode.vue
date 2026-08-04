<script setup lang="ts">
import { computed, ref, watch, onMounted, onUnmounted } from "vue";
import type { TerminalSession } from "@renderer/type/terminal";
import { useTerminalStore } from "@renderer/store/terminal";
import { useWorkspaceStore } from "@renderer/store/workspace";
import { useUIStore } from "@renderer/store/ui";
import { useFileStore } from "@renderer/store/file";
import FocusTile from "./FocusTile.vue";
import PromptRail from "@renderer/component/terminal/PromptRail.vue";
import FileDrawer from "@renderer/component/file/FileDrawer.vue";
import CodeView from "@renderer/component/file/CodeView.vue";
import { sessionDisplayName } from "@renderer/util/sessionName";
import { getBasename } from "@renderer/util/path";
import { AGENT_META } from "@renderer/util/agents";
import {
  X,
  Plus,
  Minus,
  ChevronLeft,
  ChevronRight,
  Bell,
  ArrowLeft,
  ArrowLeftRight,
  Grid2x2,
  PanelLeft,
} from "lucide-vue-next";

const terminalStore = useTerminalStore();
const workspaceStore = useWorkspaceStore();
const uiStore = useUIStore();
const fileStore = useFileStore();

// The live sessions currently staged (order preserved, dead ones dropped).
const stagedSessions = computed(
  () =>
    uiStore.focusSet
      .map((id) => terminalStore.sessions.get(id))
      .filter(Boolean) as TerminalSession[]
);

// Prune ids whose terminal was killed elsewhere (e.g. from the Layers panel);
// if nothing's left, leave focus mode entirely.
watch(stagedSessions, (list) => {
  if (!uiStore.focusModeActive) return;
  if (list.length !== uiStore.focusSet.length) {
    const alive = new Set(list.map((s) => s.id));
    for (const id of [...uiStore.focusSet]) {
      if (!alive.has(id)) uiStore.removeFromFocus(id);
    }
  }
  if (list.length === 0) uiStore.exitFocus();
});

// Keep the page in range as the set/size changes.
watch(
  () => [uiStore.focusSet.length, uiStore.focusPerScreen, uiStore.focusPageCount],
  () => {
    if (uiStore.focusPage > uiStore.focusPageCount - 1) {
      uiStore.setFocusPage(uiStore.focusPageCount - 1);
    }
  }
);

const start = computed(() => uiStore.focusPage * uiStore.focusPerScreen);
const pageTiles = computed(() =>
  stagedSessions.value.slice(start.value, start.value + uiStore.focusPerScreen)
);

// Auto-grid: columns grow with the tile count; a single leftover cell is
// filled by letting the first tile take double height (your "uneven → one
// bigger" ask).
const cols = computed(() => {
  const t = pageTiles.value.length;
  if (t <= 1) return 1;
  if (t <= 2) return 2;
  if (t <= 4) return 2;
  return 3;
});
const rows = computed(() => Math.max(1, Math.ceil(pageTiles.value.length / cols.value)));
const emptyCells = computed(() => cols.value * rows.value - pageTiles.value.length);

// ─── Adjustable grid tracks (resize handles) ─────────────────────
// Each column/row starts at an equal fraction (1fr); dragging a gutter
// transfers fractions between two adjacent tracks, clamped so no tile shrinks
// below MIN_FR of the row/column space -- they always stay visible.
const gridRef = ref<HTMLElement | null>(null);
const colFr = ref<number[]>([]);
const rowFr = ref<number[]>([]);
const MIN_FR = 0.4;

function resetTracks(): void {
  colFr.value = Array(cols.value).fill(1);
  rowFr.value = Array(rows.value).fill(1);
}
// Re-even the layout whenever the grid shape or the visible page changes.
watch([cols, rows, () => uiStore.focusPage], resetTracks, { immediate: true });

const gridStyle = computed(() => {
  const c = colFr.value.length === cols.value ? colFr.value : Array(cols.value).fill(1);
  const r = rowFr.value.length === rows.value ? rowFr.value : Array(rows.value).fill(1);
  return {
    gridTemplateColumns: c.map((f) => `${f}fr`).join(" "),
    gridTemplateRows: r.map((f) => `${f}fr`).join(" "),
  };
});

function tileStyle(index: number): Record<string, string> {
  if (emptyCells.value === 1 && index === 0) return { gridRow: "span 2" };
  return {};
}

// Gutter positions as a percentage across the grid (cumulative fractions).
const colGutters = computed(() => {
  const c = colFr.value;
  if (c.length !== cols.value || c.length < 2) return [];
  const total = c.reduce((a, b) => a + b, 0);
  const out: { index: number; pct: number }[] = [];
  let acc = 0;
  for (let i = 0; i < c.length - 1; i++) {
    acc += c[i];
    out.push({ index: i, pct: (acc / total) * 100 });
  }
  return out;
});
const rowGutters = computed(() => {
  const r = rowFr.value;
  if (r.length !== rows.value || r.length < 2) return [];
  const total = r.reduce((a, b) => a + b, 0);
  const out: { index: number; pct: number }[] = [];
  let acc = 0;
  for (let i = 0; i < r.length - 1; i++) {
    acc += r[i];
    out.push({ index: i, pct: (acc / total) * 100 });
  }
  return out;
});

let gutterDrag:
  | { axis: "col" | "row"; index: number; start: number; a: number; b: number; size: number; total: number }
  | null = null;

function beginGutterDrag(axis: "col" | "row", index: number, e: PointerEvent): void {
  const grid = gridRef.value;
  if (!grid) return;
  e.preventDefault();
  const arr = axis === "col" ? colFr.value : rowFr.value;
  gutterDrag = {
    axis,
    index,
    start: axis === "col" ? e.clientX : e.clientY,
    a: arr[index],
    b: arr[index + 1],
    size: axis === "col" ? grid.clientWidth : grid.clientHeight,
    total: arr.reduce((x, y) => x + y, 0),
  };
  window.addEventListener("pointermove", onGutterMove);
  window.addEventListener("pointerup", onGutterUp);
}

function onGutterMove(e: PointerEvent): void {
  if (!gutterDrag) return;
  const { axis, index, start, a, b, size, total } = gutterDrag;
  const delta = (axis === "col" ? e.clientX : e.clientY) - start;
  const frPerPx = size > 0 ? total / size : 0;
  let dFr = delta * frPerPx;
  // Clamp so neither adjacent track falls below MIN_FR.
  dFr = Math.max(MIN_FR - a, Math.min(b - MIN_FR, dFr));
  const arr = axis === "col" ? [...colFr.value] : [...rowFr.value];
  arr[index] = a + dFr;
  arr[index + 1] = b - dFr;
  if (axis === "col") colFr.value = arr;
  else rowFr.value = arr;
}

function onGutterUp(): void {
  window.removeEventListener("pointermove", onGutterMove);
  window.removeEventListener("pointerup", onGutterUp);
  gutterDrag = null;
}

// ─── Drag-to-swap tiles ──────────────────────────────────────────
const draggingId = ref<string | null>(null);
const dropTargetId = ref<string | null>(null);
const ghostPos = ref({ x: 0, y: 0 });
const ghostName = computed(() => {
  const s = draggingId.value ? terminalStore.sessions.get(draggingId.value) : null;
  return s ? sessionDisplayName(s) : "";
});

let dragPending: { id: string; startX: number; startY: number } | null = null;
const DRAG_THRESHOLD = 6;

function onTileDragStart(id: string, e: PointerEvent): void {
  dragPending = { id, startX: e.clientX, startY: e.clientY };
  ghostPos.value = { x: e.clientX, y: e.clientY };
  window.addEventListener("pointermove", onSwapMove);
  window.addEventListener("pointerup", onSwapEnd);
}

function tileIdAtPoint(x: number, y: number): string | null {
  const el = document.elementFromPoint(x, y) as HTMLElement | null;
  const tile = el?.closest<HTMLElement>("[data-focus-tile]");
  return tile?.dataset.focusTile ?? null;
}

function onSwapMove(e: PointerEvent): void {
  if (!dragPending) return;
  ghostPos.value = { x: e.clientX, y: e.clientY };
  if (!draggingId.value) {
    const dx = e.clientX - dragPending.startX;
    const dy = e.clientY - dragPending.startY;
    if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
    draggingId.value = dragPending.id;
    document.body.classList.add("focus-swap-dragging");
  }
  const over = tileIdAtPoint(e.clientX, e.clientY);
  dropTargetId.value = over && over !== draggingId.value ? over : null;
}

function onSwapEnd(): void {
  window.removeEventListener("pointermove", onSwapMove);
  window.removeEventListener("pointerup", onSwapEnd);
  if (draggingId.value && dropTargetId.value) {
    uiStore.swapFocus(draggingId.value, dropTargetId.value);
  }
  draggingId.value = null;
  dropTargetId.value = null;
  dragPending = null;
  document.body.classList.remove("focus-swap-dragging");
}

// Off-stage terminals that need attention -> surfaced as a banner (notify +
// one-click bring-in), never auto-pulled.
const offStageAttention = computed(() =>
  terminalStore.attentionSessions.filter((s) => !uiStore.focusSet.includes(s.id))
);
const offStageAlert = computed(() => offStageAttention.value[0] ?? null);

const memorySession = computed(() =>
  uiStore.focusMemoryTerminalId
    ? terminalStore.sessions.get(uiStore.focusMemoryTerminalId) ?? null
    : null
);

const perScreenLabel = computed(() => `${uiStore.focusPerScreen} per screen`);

// ─── Files panel (stage-level, pinned left) ──────────────────────
//
// One tree + one editor for the whole stage rather than one per tile: the
// point of Focus Mode is watching several terminals at once, and a tree inside
// every tile would spend that space four times over. The tree follows the
// focused terminal's project, so clicking into a different terminal re-roots
// it -- which is only comprehensible if it's obvious which terminal has focus,
// hence the name in this panel's header and the ring on the tile itself.

/** Whose project the tree is showing: the focused tile, else the first staged. */
const filesSession = computed(() => {
  const focused = uiStore.focusSet.includes(terminalStore.focusedTerminalId ?? "")
    ? terminalStore.sessions.get(terminalStore.focusedTerminalId as string)
    : undefined;
  return focused ?? stagedSessions.value[0] ?? null;
});

const filesRoot = computed(() => filesSession.value?.fileRoot ?? "");
const filesAgentColor = computed(() =>
  filesSession.value?.activeAgent ? AGENT_META[filesSession.value.activeAgent].color : null
);

const focusFileName = computed(() =>
  uiStore.focusFilePath ? getBasename(uiStore.focusFilePath) : null
);

function openFocusFile(path: string): void {
  uiStore.openFocusFile(path);
}

function setFilesRoot(dir: string): void {
  const session = filesSession.value;
  if (!session) return;
  terminalStore.updateSession(session.id, { fileRoot: dir, fileRootPinned: true });
  void window.api.terminal.setFileRoot(session.id, dir);
}

// Width: dragged, not fixed -- a tree is fine at 260px and a file being read
// is not. Session-scoped like the rest of the Focus layout state.
const filesWidth = ref(340);
let filesResize: { startX: number; startWidth: number } | null = null;

function beginFilesResize(e: PointerEvent): void {
  e.preventDefault();
  filesResize = { startX: e.clientX, startWidth: filesWidth.value };
  window.addEventListener("pointermove", onFilesResize);
  window.addEventListener("pointerup", endFilesResize);
}

function onFilesResize(e: PointerEvent): void {
  if (!filesResize) return;
  const next = filesResize.startWidth + (e.clientX - filesResize.startX);
  filesWidth.value = Math.min(720, Math.max(220, next));
}

function endFilesResize(): void {
  window.removeEventListener("pointermove", onFilesResize);
  window.removeEventListener("pointerup", endFilesResize);
  filesResize = null;
}

function exit(): void {
  uiStore.exitFocus();
}

function bringInAlert(): void {
  if (!offStageAlert.value) return;
  const id = offStageAlert.value.id;
  uiStore.addToFocus(id);
  terminalStore.setFocused(id);
  // Jump to the page that now contains it.
  const idx = uiStore.focusSet.indexOf(id);
  if (idx >= 0) uiStore.setFocusPage(Math.floor(idx / uiStore.focusPerScreen));
}

function jumpToAlertOnCanvas(): void {
  if (offStageAlert.value) terminalStore.setFocused(offStageAlert.value.id);
  exit();
}

async function addTerminal(): Promise<void> {
  const shellId =
    terminalStore.sessionDefaultShellId || workspaceStore.settings.defaultShellId;
  const shell = terminalStore.shells.find((s) => s.id === shellId);
  if (!shell) return;
  const session = await terminalStore.createSession({ shellId: shell.id, cols: 80, rows: 24 });
  uiStore.addToFocus(session.id);
}

function onKeyDown(e: KeyboardEvent): void {
  if (!uiStore.focusModeActive) return;
  if (e.key === "Escape") {
    // First Escape drops keyboard focus out of a terminal; a second exits.
    if (terminalStore.focusedTerminalId) {
      terminalStore.setFocused(null);
    } else {
      exit();
    }
  }
}

onMounted(() => {
  window.addEventListener("keydown", onKeyDown);

  // Come up with the Files panel already open when the terminals being staged
  // had files open on the canvas -- their per-tile tabs don't exist here, and
  // entering Focus Mode shouldn't look like the files were dropped. If the
  // focused terminal had one showing, show that one. Otherwise the panel stays
  // closed and the Files button in the bar opens it.
  if (uiStore.focusFilesOpen) return;
  const owner = filesSession.value;
  if (!owner) return;
  const active = fileStore.getActiveTab(owner.id);
  const anyOpen = stagedSessions.value.some((s) => fileStore.getTabs(s.id).length > 0);
  if (active) uiStore.openFocusFile(active);
  else if (anyOpen) uiStore.toggleFocusFiles();
});
onUnmounted(() => {
  window.removeEventListener("keydown", onKeyDown);
  // Tear down any in-flight drag listeners so nothing leaks if we exit
  // Focus mode mid-gesture.
  window.removeEventListener("pointermove", onSwapMove);
  window.removeEventListener("pointerup", onSwapEnd);
  window.removeEventListener("pointermove", onGutterMove);
  window.removeEventListener("pointerup", onGutterUp);
  window.removeEventListener("pointermove", onFilesResize);
  window.removeEventListener("pointerup", endFilesResize);
  document.body.classList.remove("focus-swap-dragging");
});
</script>

<template>
  <div class="focus-mode">
    <!-- Immersive vignette for maximum focus/vibe -->
    <div class="focus-vignette" />

    <!-- Top control bar -->
    <div class="focus-bar">
      <div class="focus-bar-left">
        <button class="focus-exit" title="Exit focus (Esc)" @click="exit">
          <ArrowLeft :size="15" />
          <span>Back to canvas</span>
        </button>
        <button
          class="focus-exit focus-files-toggle"
          :class="{ active: uiStore.focusFilesOpen }"
          title="Show files beside the stage"
          @click="uiStore.toggleFocusFiles()"
        >
          <PanelLeft :size="15" />
          <span>Files</span>
        </button>
        <span class="focus-title">
          <Grid2x2 :size="14" />
          Focus &middot; {{ stagedSessions.length }} terminal(s)
        </span>
      </div>

      <div class="focus-bar-right">
        <div class="focus-stepper" :title="perScreenLabel">
          <button
            class="focus-step-btn"
            :disabled="uiStore.focusPerScreen <= 1"
            title="Fewer per screen"
            @click="uiStore.setFocusPerScreen(uiStore.focusPerScreen - 1)"
          >
            <Minus :size="14" />
          </button>
          <span class="focus-step-value">{{ uiStore.focusPerScreen }}</span>
          <button
            class="focus-step-btn"
            :disabled="uiStore.focusPerScreen >= 6"
            title="More per screen"
            @click="uiStore.setFocusPerScreen(uiStore.focusPerScreen + 1)"
          >
            <Plus :size="14" />
          </button>
        </div>

        <div v-if="uiStore.focusPageCount > 1" class="focus-pager">
          <button
            class="focus-step-btn"
            :disabled="uiStore.focusPage <= 0"
            title="Previous page"
            @click="uiStore.setFocusPage(uiStore.focusPage - 1)"
          >
            <ChevronLeft :size="15" />
          </button>
          <span class="focus-step-value">{{ uiStore.focusPage + 1 }}/{{ uiStore.focusPageCount }}</span>
          <button
            class="focus-step-btn"
            :disabled="uiStore.focusPage >= uiStore.focusPageCount - 1"
            title="Next page"
            @click="uiStore.setFocusPage(uiStore.focusPage + 1)"
          >
            <ChevronRight :size="15" />
          </button>
        </div>

        <button class="focus-exit focus-exit-icon" title="Exit focus (Esc)" @click="exit">
          <X :size="16" />
        </button>
      </div>
    </div>

    <!-- Stage -->
    <div class="focus-stage">
      <!-- Files: one tree + one editor for the whole stage, rooted at the
           focused terminal's project (named in the header so a re-root is
           never a surprise). -->
      <div
        v-if="uiStore.focusFilesOpen && filesSession"
        class="focus-files"
        :style="{ width: filesWidth + 'px' }"
      >
        <div class="focus-files-header">
          <span class="focus-files-label">Files</span>
          <span class="focus-files-owner" :title="filesSession.cwd">
            <span
              class="focus-files-dot"
              :style="{ background: filesAgentColor ?? 'var(--tc-accent)' }"
            />
            {{ sessionDisplayName(filesSession) }}
          </span>
          <button class="focus-files-close" title="Hide files" @click="uiStore.toggleFocusFiles()">
            <X :size="13" />
          </button>
        </div>

        <div class="focus-files-tree">
          <FileDrawer
            :terminal-id="filesSession.id"
            :root="filesRoot"
            :active-path="uiStore.focusFilePath"
            @open="openFocusFile"
            @root-change="setFilesRoot"
          />
        </div>

        <div v-if="uiStore.focusFilePath" class="focus-files-editor">
          <div class="focus-files-editor-bar">
            <span class="focus-files-editor-name">{{ focusFileName }}</span>
            <button class="focus-files-close" title="Close file" @click="uiStore.clearFocusFile()">
              <X :size="13" />
            </button>
          </div>
          <CodeView :key="uiStore.focusFilePath" :path="uiStore.focusFilePath" :active="true" />
        </div>
      </div>

      <div
        v-if="uiStore.focusFilesOpen && filesSession"
        class="focus-files-resizer"
        title="Drag to resize"
        @pointerdown="beginFilesResize"
      />

      <div v-if="pageTiles.length === 0" class="focus-empty">
        <p>No terminals on the stage.</p>
        <button class="focus-add-btn" @click="addTerminal">
          <Plus :size="15" /> Add a terminal
        </button>
      </div>

      <div v-else ref="gridRef" class="focus-grid" :style="gridStyle">
        <FocusTile
          v-for="(session, i) in pageTiles"
          :key="session.id"
          :session="session"
          :style="tileStyle(i)"
          :dragging-id="draggingId"
          :drop-target-id="dropTargetId"
          @drag-start="onTileDragStart"
        />

        <!-- Resize gutters: drag to reallocate space between tiles. -->
        <div
          v-for="g in colGutters"
          :key="'col-' + g.index"
          class="focus-gutter focus-gutter-col"
          :style="{ left: g.pct + '%' }"
          title="Drag to resize columns"
          @pointerdown="beginGutterDrag('col', g.index, $event)"
        />
        <div
          v-for="g in rowGutters"
          :key="'row-' + g.index"
          class="focus-gutter focus-gutter-row"
          :style="{ top: g.pct + '%' }"
          title="Drag to resize rows"
          @pointerdown="beginGutterDrag('row', g.index, $event)"
        />
      </div>

      <!-- Memory side-panel (opens on demand, hidden by default) -->
      <div v-if="memorySession" class="focus-memory">
        <PromptRail :terminal-id="memorySession.id" />
      </div>
    </div>

    <!-- Floating label that follows the pointer while swapping tiles. -->
    <div
      v-if="draggingId"
      class="focus-drag-ghost"
      :style="{ left: ghostPos.x + 'px', top: ghostPos.y + 'px' }"
    >
      <ArrowLeftRight :size="14" />
      <span>{{ ghostName }}</span>
    </div>

    <!-- Off-stage attention banner -->
    <Transition name="focus-alert">
      <div v-if="offStageAlert" class="focus-alert">
        <Bell :size="14" class="focus-alert-icon" />
        <span class="focus-alert-text">
          <strong>{{ sessionDisplayName(offStageAlert) }}</strong>
          {{ offStageAlert.attentionReason === 'input' ? 'needs your input' : 'needs attention' }}
        </span>
        <button class="focus-alert-btn" @click="bringInAlert">Bring it in</button>
        <button class="focus-alert-btn focus-alert-btn-ghost" @click="jumpToAlertOnCanvas">Go to it</button>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.focus-mode {
  position: fixed;
  inset: 0;
  z-index: var(--tc-z-modal);
  display: flex;
  flex-direction: column;
  background: var(--tc-bg-primary);
}

/* Radial vignette overlay -- subtle darkening toward the edges. */
.focus-vignette {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 1;
  background: radial-gradient(
    ellipse at center,
    transparent 45%,
    color-mix(in srgb, var(--tc-bg-primary) 60%, black) 100%
  );
}

.focus-bar {
  position: relative;
  z-index: 2;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 16px;
  flex-shrink: 0;
}

.focus-bar-left,
.focus-bar-right {
  display: flex;
  align-items: center;
  gap: 10px;
}

.focus-exit {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border: 1px solid var(--tc-border-color);
  background: var(--tc-bg-card);
  color: var(--tc-text-secondary);
  border-radius: var(--tc-border-radius-sm);
  cursor: pointer;
  font-size: var(--tc-font-size-sm);
  font-family: var(--tc-font-sans);
  transition: all var(--tc-transition-fast);
}

.focus-exit:hover {
  background: var(--tc-bg-hover);
  color: var(--tc-text-primary);
  border-color: var(--tc-accent);
}

.focus-exit-icon {
  padding: 6px;
}

.focus-title {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: var(--tc-font-size-sm);
  color: var(--tc-text-muted);
}

.focus-stepper,
.focus-pager {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 2px;
  background: var(--tc-bg-card);
  border: 1px solid var(--tc-border-color);
  border-radius: var(--tc-border-radius-sm);
}

.focus-step-btn {
  width: 26px;
  height: 26px;
  border: none;
  background: transparent;
  color: var(--tc-text-secondary);
  cursor: pointer;
  border-radius: var(--tc-border-radius-sm);
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all var(--tc-transition-fast);
}

.focus-step-btn:hover:not(:disabled) {
  background: var(--tc-bg-hover);
  color: var(--tc-text-primary);
}

.focus-step-btn:disabled {
  opacity: 0.35;
  cursor: default;
}

.focus-step-value {
  font-size: var(--tc-font-size-xs);
  color: var(--tc-text-secondary);
  min-width: 34px;
  text-align: center;
  font-variant-numeric: tabular-nums;
}

.focus-stage {
  position: relative;
  z-index: 2;
  flex: 1;
  min-height: 0;
  display: flex;
  gap: 12px;
  padding: 0 16px 16px;
}

.focus-grid {
  position: relative;
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: grid;
  gap: 12px;
}

/* ─── Resize gutters ─── */
.focus-gutter {
  position: absolute;
  z-index: 4;
}

.focus-gutter-col {
  top: 0;
  bottom: 0;
  width: 10px;
  transform: translateX(-50%);
  cursor: col-resize;
}

.focus-gutter-row {
  left: 0;
  right: 0;
  height: 10px;
  transform: translateY(-50%);
  cursor: row-resize;
}

/* Thin bar that lights up on hover/drag so the handle is discoverable but
   invisible at rest. */
.focus-gutter::before {
  content: "";
  position: absolute;
  border-radius: 2px;
  background: transparent;
  transition: background var(--tc-transition-fast);
}

.focus-gutter-col::before {
  top: 10px;
  bottom: 10px;
  left: 50%;
  width: 3px;
  transform: translateX(-50%);
}

.focus-gutter-row::before {
  left: 10px;
  right: 10px;
  top: 50%;
  height: 3px;
  transform: translateY(-50%);
}

.focus-gutter:hover::before,
.focus-gutter:active::before {
  background: var(--tc-accent);
}

/* ─── Swap drag ghost ─── */
.focus-drag-ghost {
  position: fixed;
  z-index: 40;
  transform: translate(14px, 14px);
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 10px;
  background: var(--tc-accent);
  color: #fff;
  border-radius: var(--tc-border-radius-sm);
  font-size: var(--tc-font-size-xs);
  font-weight: 600;
  box-shadow: var(--tc-shadow-lg);
  pointer-events: none;
  max-width: 220px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* While swapping, don't let the terminal bodies or gutters intercept the
   pointer -- elementFromPoint needs to resolve to the tile under the cursor,
   and terminals shouldn't grab focus mid-drag. (Global: these targets live in
   child components / on <body>.) */
:global(.focus-swap-dragging) {
  cursor: grabbing;
  user-select: none;
}

:global(.focus-swap-dragging .focus-tile-body),
:global(.focus-swap-dragging .focus-gutter) {
  pointer-events: none;
}

/* ─── Files panel ─── */
.focus-files {
  display: flex;
  flex-direction: column;
  min-width: 0;
  flex-shrink: 0;
  border: 1px solid var(--tc-border-color);
  border-radius: var(--tc-border-radius);
  overflow: hidden;
  background: var(--tc-bg-card);
}

.focus-files-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 6px 6px 10px;
  background: var(--tc-bg-header);
  border-bottom: 1px solid var(--tc-border-color);
  flex-shrink: 0;
}

.focus-files-label {
  font-size: var(--tc-font-size-xs);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.3px;
  color: var(--tc-text-muted);
  flex-shrink: 0;
}

/* Names the terminal the tree is rooted at. Without it, clicking into another
   terminal silently swaps the whole tree out from under you. */
.focus-files-owner {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  flex: 1;
  min-width: 0;
  font-size: var(--tc-font-size-xs);
  color: var(--tc-text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.focus-files-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex-shrink: 0;
}

.focus-files-close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border: none;
  background: none;
  border-radius: var(--tc-border-radius-sm);
  color: var(--tc-text-muted);
  cursor: pointer;
  flex-shrink: 0;
}

.focus-files-close:hover {
  background: var(--tc-bg-hover);
  color: var(--tc-text-primary);
}

/* Tree shrinks to make room once a file is open, but never disappears -- the
   whole point is browsing to the next file without leaving the stage. */
.focus-files-tree {
  flex: 1 1 auto;
  min-height: 90px;
  overflow: hidden;
  display: flex;
}

.focus-files-tree :deep(.file-drawer) {
  flex: 1;
  border-right: none;
}

.focus-files-editor {
  flex: 2 1 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  border-top: 1px solid var(--tc-border-color);
}

.focus-files-editor-bar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 3px 4px 3px 10px;
  background: var(--tc-bg-header);
  border-bottom: 1px solid color-mix(in srgb, var(--tc-info) 30%, var(--tc-border-color));
  flex-shrink: 0;
}

.focus-files-editor-name {
  flex: 1;
  min-width: 0;
  font-size: 12px;
  font-weight: 600;
  color: var(--tc-text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.focus-files-resizer {
  width: 6px;
  margin: 0 -6px 0 -2px;
  flex-shrink: 0;
  cursor: col-resize;
  border-radius: 3px;
  transition: background var(--tc-transition-fast);
}

.focus-files-resizer:hover,
.focus-files-resizer:active {
  background: var(--tc-accent);
}

.focus-files-toggle.active {
  border-color: var(--tc-accent);
  color: var(--tc-accent);
}

.focus-memory {
  width: 300px;
  flex-shrink: 0;
  border: 1px solid var(--tc-border-color);
  border-radius: var(--tc-border-radius);
  overflow: hidden;
  background: var(--tc-memory-bg);
}

.focus-empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  color: var(--tc-text-muted);
}

.focus-add-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 16px;
  border: 1px solid var(--tc-accent);
  background: var(--tc-accent);
  color: #fff;
  border-radius: var(--tc-border-radius-sm);
  cursor: pointer;
  font-size: var(--tc-font-size-sm);
}

.focus-add-btn:hover {
  background: var(--tc-accent-hover);
}

.focus-alert {
  position: absolute;
  bottom: 24px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 5;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  background: var(--tc-bg-card);
  border: 1px solid var(--tc-attention);
  border-radius: var(--tc-border-radius);
  box-shadow: var(--tc-shadow-lg);
}

.focus-alert-icon {
  color: var(--tc-attention);
  flex-shrink: 0;
}

.focus-alert-text {
  font-size: var(--tc-font-size-sm);
  color: var(--tc-text-secondary);
}

.focus-alert-text strong {
  color: var(--tc-text-primary);
}

.focus-alert-btn {
  padding: 4px 10px;
  border: 1px solid var(--tc-accent);
  background: var(--tc-accent);
  color: #fff;
  border-radius: var(--tc-border-radius-sm);
  cursor: pointer;
  font-size: var(--tc-font-size-xs);
  white-space: nowrap;
}

.focus-alert-btn:hover {
  background: var(--tc-accent-hover);
}

.focus-alert-btn-ghost {
  background: transparent;
  color: var(--tc-text-secondary);
  border-color: var(--tc-border-color);
}

.focus-alert-btn-ghost:hover {
  background: var(--tc-bg-hover);
  color: var(--tc-text-primary);
}

.focus-alert-enter-active,
.focus-alert-leave-active {
  transition: opacity 200ms ease, transform 200ms ease;
}

.focus-alert-enter-from,
.focus-alert-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(12px);
}
</style>
