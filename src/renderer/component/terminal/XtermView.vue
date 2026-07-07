<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch, nextTick } from "vue";
import { Terminal, type ITheme } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { useTerminalStore } from "@renderer/store/terminal";
import { useUIStore } from "@renderer/store/ui";

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

let xterm: Terminal | null = null;
let fitAddon: FitAddon | null = null;
let dataUnsubscribe: (() => void) | null = null;
let resizeObserver: ResizeObserver | null = null;
let focusInHandler: (() => void) | null = null;
let focusOutHandler: (() => void) | null = null;

onMounted(async () => {
  await nextTick();
  if (!terminalContainer.value) return;

  // Create xterm instance
  xterm = new Terminal({
    cols: props.cols,
    rows: props.rows,
    fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', Consolas, Monaco, 'Courier New', monospace",
    fontSize: 14,
    fontWeight: 400,
    fontWeightBold: 600,
    lineHeight: 1.25,
    letterSpacing: 0,
    theme: xtermThemeFor(uiStore.resolvedTheme),
    cursorBlink: true,
    cursorStyle: "block",
    scrollback: 10000,
    allowProposedApi: true,
  });

  fitAddon = new FitAddon();
  xterm.loadAddon(fitAddon);

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

  // Listen for PTY output from main process
  dataUnsubscribe = window.api.terminal.onData(({ terminalId, data }) => {
    if (terminalId === props.terminalId && xterm) {
      try {
        xterm.write(data);
      } catch (err) {
        console.error("[XtermView] write failed:", err);
      }
    }
  });

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
    @mousedown.stop="handleFocus"
    @pointerdown.stop="handleFocus"
  />
</template>

<style scoped>
.xterm-view {
  width: 100%;
  height: 100%;
  overflow: hidden;
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
}
</style>
