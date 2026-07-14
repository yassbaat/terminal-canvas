<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch, nextTick } from "vue";
import { Terminal, type ITheme } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { useTerminalStore } from "@renderer/store/terminal";
import { useUIStore } from "@renderer/store/ui";
import { useWorkspaceStore } from "@renderer/store/workspace";

const props = defineProps<{
  terminalId: string;
  cols: number;
  rows: number;
}>();

const emit = defineEmits<{
  (e: "focus"): void;
  (e: "blur"): void;
}>();

const terminalContainer = ref<HTMLDivElement | null>(null);
const terminalStore = useTerminalStore();
const uiStore = useUIStore();
const workspaceStore = useWorkspaceStore();

// The terminal itself stays dark in both app themes (ANSI palettes are
// tuned for a dark ground, and every terminal app keeps this convention) --
// only the exact shade shifts a little so it still feels integrated with a
// light UI, matching --tc-terminal-bg in variables.css.
const DARK_XTERM_THEME: ITheme = {
  background: "#0d0d1a",
  foreground: "#e0e0e0",
  cursor: "#e94560",
  selectionBackground: "#4a4a6a",
  black: "#1a1a2e",
  red: "#e94560",
  green: "#4ecca3",
  yellow: "#f9a825",
  blue: "#64b5f6",
  magenta: "#e040fb",
  cyan: "#4dd0e1",
  white: "#e0e0e0",
  brightBlack: "#4a4a6a",
  brightRed: "#ff6b81",
  brightGreen: "#7ee8c7",
  brightYellow: "#ffd54f",
  brightBlue: "#90caf9",
  brightMagenta: "#ea80fc",
  brightCyan: "#80deea",
  brightWhite: "#ffffff",
};
const LIGHT_XTERM_THEME: ITheme = {
  ...DARK_XTERM_THEME,
  background: "#12121c",
  foreground: "#e4e2ee",
  cursor: "#d1264a",
  selectionBackground: "#3f3d58",
};
function xtermThemeFor(theme: "light" | "dark"): ITheme {
  return theme === "light" ? LIGHT_XTERM_THEME : DARK_XTERM_THEME;
}

function handleFocus() {
  if (xterm) {
    xterm.focus();
    terminalStore.setFocused(props.terminalId);
  }
}

/**
 * Normally stops propagation so a click into the terminal focuses it without
 * the gesture reaching Vue Flow's pane (which would otherwise treat it as a
 * node-drag/selection start). But while the user is holding the pan
 * modifier (Shift/Space), let the event bubble through untouched so the
 * pane's own pan-drag handling can take over -- otherwise panning is dead
 * the moment a drag starts over any terminal's text area.
 */
function handlePointerDown(event: MouseEvent): void {
  if (uiStore.isPanKeyPressed) return;
  event.stopPropagation();
  handleFocus();
}

let xterm: Terminal | null = null;
let fitAddon: FitAddon | null = null;
let dataUnsubscribe: (() => void) | null = null;
let resizeObserver: ResizeObserver | null = null;
let focusInHandler: (() => void) | null = null;
let focusOutHandler: (() => void) | null = null;
let wheelHandler: ((e: WheelEvent) => void) | null = null;
let selectionCorrectionHandler: ((e: MouseEvent) => void) | null = null;
let scrollPinHandler: (() => void) | null = null;
let scrollPinTargets: HTMLElement[] = [];

// Events xterm.js hit-tests against a click/drag position (selection start/
// extend/end, double-click word select, right-click, link clicks).
const POINTER_HITTEST_EVENTS = ["mousedown", "mousemove", "mouseup", "click", "dblclick", "contextmenu", "auxclick"] as const;

/**
 * xterm.js measures its character-cell size once via canvas text metrics or
 * a hidden DOM span's offsetWidth (see @xterm/xterm's CharSizeService) --
 * both are inherently zoom-invariant, since neither reads
 * getBoundingClientRect(). But turning a click into a column/row divides by
 * that fixed cell size using (event.clientX - rect.left), and THAT
 * numerator, being getBoundingClientRect()-based, DOES reflect Vue Flow's
 * current canvas zoom (a CSS transform: scale() on an ancestor pane).
 * Dividing a zoom-scaled pixel offset by a zoom-invariant cell width is
 * wrong by exactly the zoom factor -- e.g. at 50% zoom, every click
 * resolves to half the column it should, which is exactly "selection starts
 * far from where I pressed." Rewriting clientX/clientY here (capture
 * phase, so this runs before xterm's own listeners on its inner elements
 * see the event) to what they'd be at 100% zoom fixes this without
 * touching xterm's internals or its own (correct, stable) cols/rows.
 */
function correctPointerEventForZoom(event: MouseEvent): void {
  const zoom = workspaceStore.viewport.zoom;
  if (!zoom || zoom === 1 || !terminalContainer.value) return;
  const rect = terminalContainer.value.getBoundingClientRect();
  const correctedX = rect.left + (event.clientX - rect.left) / zoom;
  const correctedY = rect.top + (event.clientY - rect.top) / zoom;
  Object.defineProperty(event, "clientX", { value: correctedX, configurable: true });
  Object.defineProperty(event, "clientY", { value: correctedY, configurable: true });
}

onMounted(async () => {
  await nextTick();
  if (!terminalContainer.value) return;

  // Create xterm instance
  xterm = new Terminal({
    cols: props.cols,
    rows: props.rows,
    // Keep in sync with --tc-font-mono in variables.css -- xterm.js can't
    // read CSS custom properties, so the stack is duplicated here.
    fontFamily:
      "'JetBrains Mono', 'Fira Code', 'Cascadia Code', 'Cascadia Mono', Menlo, Consolas, 'DejaVu Sans Mono', 'Liberation Mono', 'Ubuntu Mono', Monaco, 'Courier New', monospace",
    fontSize: 15,
    fontWeight: 400,
    fontWeightBold: 600,
    lineHeight: 1.3,
    letterSpacing: 0,
    theme: xtermThemeFor(uiStore.resolvedTheme),
    cursorBlink: true,
    cursorStyle: "block",
    scrollback: 10000,
    allowProposedApi: true,
  });

  fitAddon = new FitAddon();
  xterm.loadAddon(fitAddon);

  // Only let the terminal consume a wheel gesture (scroll its own scrollback)
  // when it is the focused/active terminal. When it isn't focused, return
  // false so xterm ignores the wheel entirely -- the event then bubbles to the
  // canvas and pans it. This is what makes "scroll past / over a terminal I
  // haven't clicked into" move the canvas instead of hijacking the scroll into
  // the terminal's buffer. Pinch-zoom (ctrlKey) is always left to the canvas.
  xterm.attachCustomWheelEventHandler((e: WheelEvent) => {
    if (e.ctrlKey) return false;
    return terminalStore.focusedTerminalId === props.terminalId;
  });

  // Mount to DOM
  xterm.open(terminalContainer.value);

  // Initial fit — wait for Vue Flow to finish laying out the node
  // so the container has real dimensions before xterm measures cells.
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      if (fitAddon && xterm) {
        try {
          fitAddon.fit();
          const dims = xterm.cols + "x" + xterm.rows;
          if (dims !== "0x0") {
            window.api.terminal.resize(props.terminalId, xterm.cols, xterm.rows);
          }
        } catch {
          // Ignore
        }
      }
    });
  });

  // Handle user input
  xterm.onData((data) => {
    window.api.terminal.write(props.terminalId, data);
  });

  // Contain the scroll to this terminal's scrollback ONLY while it is the
  // focused/active terminal: then stopPropagation so the wheel can't also pan
  // the canvas (no chaining at the buffer's top/bottom, even on a fast flick).
  // When the terminal is NOT focused we deliberately do nothing here -- the
  // event bubbles on to Vue Flow's pane and pans the canvas, while the custom
  // wheel handler above stops xterm from scrolling its buffer. Pinch-zoom
  // (ctrlKey) is always left alone so the canvas can zoom.
  wheelHandler = (e: WheelEvent) => {
    if (e.ctrlKey) return;
    if (terminalStore.focusedTerminalId === props.terminalId) {
      e.stopPropagation();
    }
  };
  terminalContainer.value.addEventListener("wheel", wheelHandler, { passive: true });

  // Guard against the terminal "jumping to the top" when it gains focus or the
  // user first interacts with it. Focusing xterm's hidden helper textarea (or
  // certain re-layouts) makes the browser scroll an overflow ancestor to bring
  // that element into view, yanking the visible content. None of these wrapper
  // elements are meant to scroll -- only .xterm-viewport is -- so we pin their
  // scroll offset back to 0 whenever something nudges it. viewportEl is
  // deliberately excluded (it owns the real scrollback).
  scrollPinTargets = [
    terminalContainer.value,
    terminalContainer.value.closest<HTMLElement>(".terminal-area"),
    terminalContainer.value.closest<HTMLElement>(".terminal-node-body"),
    xterm.element?.querySelector<HTMLElement>(".xterm-screen") ?? null,
  ].filter((el): el is HTMLElement => el !== null);
  scrollPinHandler = () => {
    for (const el of scrollPinTargets) {
      if (el.scrollTop !== 0) el.scrollTop = 0;
      if (el.scrollLeft !== 0) el.scrollLeft = 0;
    }
  };
  // Reset on focus (the browser's focus-scroll is the main culprit) and on any
  // direct scroll of a wrapper element (scroll events don't bubble, so the
  // listener goes on each wrapper individually).
  terminalContainer.value.addEventListener("focusin", scrollPinHandler);
  for (const el of scrollPinTargets) {
    el.addEventListener("scroll", scrollPinHandler);
  }

  selectionCorrectionHandler = correctPointerEventForZoom;
  for (const evt of POINTER_HITTEST_EVENTS) {
    terminalContainer.value.addEventListener(evt, selectionCorrectionHandler as EventListener, { capture: true });
  }

  // Handle focus / blur via DOM events (xterm.js 5.x does not have onFocus/onBlur)
  const el = xterm.element || terminalContainer.value;
  if (el) {
    focusInHandler = () => {
      terminalStore.setFocused(props.terminalId);
      emit("focus");
    };
    focusOutHandler = () => {
      if (terminalStore.focusedTerminalId === props.terminalId) {
        emit("blur");
      }
    };
    el.addEventListener("focusin", focusInHandler);
    el.addEventListener("focusout", focusOutHandler);
  }

  // Listen for PTY output from main process. To keep a terminal's on-screen
  // content when its xterm remounts (moving between the canvas and the Focus
  // stage), we first fetch the main-process replay buffer and write it, THEN go
  // live. We subscribe *before* fetching and queue anything that streams in
  // during the fetch, so no output is ever dropped (at worst a sub-millisecond
  // sliver is written twice -- never lost).
  let replayDone = false;
  const pendingChunks: string[] = [];
  dataUnsubscribe = window.api.terminal.onData(({ terminalId, data }) => {
    if (terminalId !== props.terminalId || !xterm) return;
    if (!replayDone) {
      pendingChunks.push(data);
      return;
    }
    try {
      xterm.write(data);
    } catch (err) {
      console.error("[XtermView] write failed:", err);
    }
  });

  const finishReplay = (buffer: string) => {
    if (!xterm) return;
    try {
      if (buffer) xterm.write(buffer);
      for (const chunk of pendingChunks) xterm.write(chunk);
    } catch (err) {
      console.error("[XtermView] replay write failed:", err);
    }
    pendingChunks.length = 0;
    replayDone = true;
  };

  window.api.terminal
    .getBuffer(props.terminalId)
    .then(finishReplay)
    .catch(() => finishReplay(""));

  // Resize observer — debounced so rapid Vue Flow resizes don't thrash
  let resizeTimer: ReturnType<typeof setTimeout> | null = null;
  resizeObserver = new ResizeObserver((entries) => {
    if (!fitAddon || !xterm) return;
    const entry = entries[0];
    if (!entry) return;
    // Only refit when the size has actually changed by at least 2px
    const { width, height } = entry.contentRect;
    if (width < 10 || height < 10) return;

    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (!fitAddon || !xterm) return;
      try {
        const prevCols = xterm.cols;
        const prevRows = xterm.rows;
        fitAddon.fit();
        if (xterm.cols !== prevCols || xterm.rows !== prevRows) {
          window.api.terminal.resize(props.terminalId, xterm.cols, xterm.rows);
        }
      } catch {
        // Ignore resize errors
      }
    }, 80);
  });

  if (terminalContainer.value) {
    resizeObserver.observe(terminalContainer.value);
  }

  // Focus on mount
  xterm.focus();
});

onUnmounted(() => {
  if (resizeObserver) {
    resizeObserver.disconnect();
  }
  if (dataUnsubscribe) {
    dataUnsubscribe();
  }
  const el = xterm?.element || terminalContainer.value;
  if (el) {
    if (focusInHandler) el.removeEventListener("focusin", focusInHandler);
    if (focusOutHandler) el.removeEventListener("focusout", focusOutHandler);
  }
  if (wheelHandler && terminalContainer.value) {
    terminalContainer.value.removeEventListener("wheel", wheelHandler);
  }
  if (scrollPinHandler) {
    if (terminalContainer.value) {
      terminalContainer.value.removeEventListener("focusin", scrollPinHandler);
    }
    for (const el of scrollPinTargets) {
      el.removeEventListener("scroll", scrollPinHandler);
    }
    scrollPinTargets = [];
  }
  if (selectionCorrectionHandler && terminalContainer.value) {
    for (const evt of POINTER_HITTEST_EVENTS) {
      terminalContainer.value.removeEventListener(evt, selectionCorrectionHandler as EventListener, { capture: true });
    }
  }
  if (xterm) {
    xterm.dispose();
    xterm = null;
  }
});

// Watch for focus changes
watch(
  () => terminalStore.focusedTerminalId,
  (newId) => {
    if (newId === props.terminalId && xterm) {
      xterm.focus();
    }
  }
);

// Live-update the terminal's colors when the app theme changes.
watch(
  () => uiStore.resolvedTheme,
  (theme) => {
    if (xterm) {
      xterm.options.theme = xtermThemeFor(theme);
    }
  }
);
</script>

<template>
  <div
    ref="terminalContainer"
    class="xterm-view"
    @mousedown="handlePointerDown"
    @pointerdown="handlePointerDown"
  />
</template>

<style scoped>
.xterm-view {
  width: 100%;
  height: 100%;
  overflow: hidden;
  /* xterm's DOM renderer draws real text, so standard font-smoothing hints
     apply and make a visible difference on macOS in particular. */
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeSpeed;
}

/* Ensure xterm.js canvas is never squished by parent transforms */
.xterm-view :deep(.xterm) {
  width: 100% !important;
  height: 100% !important;
  padding: 0 !important;
}

.xterm-view :deep(.xterm-screen) {
  width: 100% !important;
  height: 100% !important;
}

.xterm-view :deep(.xterm-viewport) {
  width: 100% !important;
  /* Scroll the buffer while there's room to; once maxed out, don't chain
     the scroll into the canvas pane's pan-on-scroll (would feel like the
     canvas "grabbing" the gesture mid-scrollback). */
  overscroll-behavior: contain;
}
</style>
