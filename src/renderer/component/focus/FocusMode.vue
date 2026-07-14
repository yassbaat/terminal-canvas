<script setup lang="ts">
import { computed, watch, onMounted, onUnmounted } from "vue";
import type { TerminalSession } from "@renderer/type/terminal";
import { useTerminalStore } from "@renderer/store/terminal";
import { useWorkspaceStore } from "@renderer/store/workspace";
import { useUIStore } from "@renderer/store/ui";
import FocusTile from "./FocusTile.vue";
import PromptRail from "@renderer/component/terminal/PromptRail.vue";
import {
  X,
  Plus,
  Minus,
  ChevronLeft,
  ChevronRight,
  Bell,
  ArrowLeft,
  Grid2x2,
} from "lucide-vue-next";

const terminalStore = useTerminalStore();
const workspaceStore = useWorkspaceStore();
const uiStore = useUIStore();

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

const gridStyle = computed(() => ({
  gridTemplateColumns: `repeat(${cols.value}, 1fr)`,
  gridTemplateRows: `repeat(${rows.value}, 1fr)`,
}));

function tileStyle(index: number): Record<string, string> {
  if (emptyCells.value === 1 && index === 0) return { gridRow: "span 2" };
  return {};
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

onMounted(() => window.addEventListener("keydown", onKeyDown));
onUnmounted(() => window.removeEventListener("keydown", onKeyDown));
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
      <div v-if="pageTiles.length === 0" class="focus-empty">
        <p>No terminals on the stage.</p>
        <button class="focus-add-btn" @click="addTerminal">
          <Plus :size="15" /> Add a terminal
        </button>
      </div>

      <div v-else class="focus-grid" :style="gridStyle">
        <FocusTile
          v-for="(session, i) in pageTiles"
          :key="session.id"
          :session="session"
          :style="tileStyle(i)"
        />
      </div>

      <!-- Memory side-panel (opens on demand, hidden by default) -->
      <div v-if="memorySession" class="focus-memory">
        <PromptRail :terminal-id="memorySession.id" />
      </div>
    </div>

    <!-- Off-stage attention banner -->
    <Transition name="focus-alert">
      <div v-if="offStageAlert" class="focus-alert">
        <Bell :size="14" class="focus-alert-icon" />
        <span class="focus-alert-text">
          <strong>{{ offStageAlert.manualName || offStageAlert.autoName || offStageAlert.name }}</strong>
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
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: grid;
  gap: 12px;
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
  border: 1px solid var(--tc-warning);
  border-radius: var(--tc-border-radius);
  box-shadow: var(--tc-shadow-lg);
}

.focus-alert-icon {
  color: var(--tc-warning);
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
