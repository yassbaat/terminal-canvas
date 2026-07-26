<script setup lang="ts">
import { computed, ref, nextTick } from "vue";
import type { TerminalSession } from "@renderer/type/terminal";
import { useTerminalStore } from "@renderer/store/terminal";
import { useUIStore } from "@renderer/store/ui";
import { useWorkspaceStore } from "@renderer/store/workspace";
import { AGENT_META } from "@renderer/util/agents";
import { sessionDisplayName } from "@renderer/util/sessionName";
import { Bell, BellOff, X, Maximize2, PanelLeft } from "lucide-vue-next";

const props = withDefaults(
  defineProps<{
    session: TerminalSession;
    /** Show the "focus this terminal" button (canvas nodes only, not focus tiles). */
    canFocus?: boolean;
    /** Show the file-explorer toggle, and whether the drawer is currently open. */
    canToggleFiles?: boolean;
    filesOpen?: boolean;
    /**
     * Counter-scale the chrome against the canvas zoom. Off on the Focus stage,
     * which isn't inside the transformed canvas and would otherwise inherit a
     * zoom level that means nothing there.
     */
    scaleWithZoom?: boolean;
  }>(),
  { canFocus: false, canToggleFiles: false, filesOpen: false, scaleWithZoom: true }
);

const emit = defineEmits<{
  (e: "rename", name: string): void;
  (e: "kill"): void;
  (e: "restart"): void;
  (e: "clear"): void;
  (e: "focus-solo"): void;
  (e: "toggle-files"): void;
}>();

const terminalStore = useTerminalStore();
const uiStore = useUIStore();
const workspaceStore = useWorkspaceStore();

const displayName = computed(() => sessionDisplayName(props.session));

const agentMeta = computed(() =>
  props.session.activeAgent ? AGENT_META[props.session.activeAgent] : null
);

const statusColor = computed(() => {
  switch (props.session.status) {
    case "running":
      return "var(--tc-status-running)";
    case "starting":
      return "var(--tc-status-starting)";
    case "exited":
      return "var(--tc-status-exited)";
    case "crashed":
      return "var(--tc-status-crashed)";
    case "killed":
      return "var(--tc-status-killed)";
    default:
      return "var(--tc-text-muted)";
  }
});

/**
 * Chrome grows a little as the canvas zooms out, so the controls stay findable
 * on a shrunken node -- but only *partly*: a full 1/zoom counter-scale would
 * make the header balloon to cartoon proportions at 0.3x. Taking 45% of the
 * correction and capping at 1.5x keeps it subtle, and the header still shrinks
 * overall, just more slowly than the terminal body.
 */
const chromeScale = computed(() => {
  if (!props.scaleWithZoom) return 1;
  const zoom = workspaceStore.viewport.zoom || 1;
  if (zoom >= 1) return 1;
  return Math.min(1.5, 1 + (1 / zoom - 1) * 0.45);
});

const iconSize = computed(() => Math.round(13 * chromeScale.value));
const titleSize = computed(() => uiStore.terminalTitleSize * chromeScale.value);

const isRenaming = ref(false);
const renameValue = ref("");
const renameInputRef = ref<HTMLInputElement | null>(null);

function startRename() {
  isRenaming.value = true;
  renameValue.value = displayName.value;
  nextTick(() => {
    renameInputRef.value?.focus();
    renameInputRef.value?.select();
  });
}

/**
 * Clicking the name renames it -- but only when zoomed in enough to be
 * interacting with the terminal for real. When zoomed out, a click is about
 * selecting the node on the canvas, and a rename box no one can read would just
 * swallow it.
 */
function onNameClick() {
  if (props.scaleWithZoom && workspaceStore.viewport.zoom < 0.75) return;
  startRename();
}

function commitRename() {
  if (renameValue.value.trim()) {
    terminalStore.updateSessionName(props.session.id, renameValue.value.trim());
    emit("rename", renameValue.value.trim());
  }
  isRenaming.value = false;
}

function cancelRename() {
  isRenaming.value = false;
}

function toggleOffDuty() {
  terminalStore.setIdleDetectionEnabled(props.session.id, !props.session.idleDetectionEnabled);
}
</script>

<template>
  <div
    class="terminal-header"
    :style="{ '--chrome-scale': chromeScale }"
    :title="session.cwd"
  >
    <!-- Files first: it's the one control that opens a whole panel, so it sits
         apart from the utility icons on the right. -->
    <button
      v-if="canToggleFiles"
      class="header-btn header-btn-files"
      :class="{ 'header-btn-on': filesOpen }"
      :title="filesOpen ? 'Hide files' : 'Show files'"
      @click.stop="emit('toggle-files')"
    >
      <PanelLeft :size="iconSize" />
    </button>

    <div class="header-main">
      <div
        class="header-status-dot"
        :style="{ backgroundColor: statusColor }"
        :title="`Status: ${session.status}`"
      />
      <div
        v-if="agentMeta"
        class="header-agent-glyph"
        :style="{ color: agentMeta.color, borderColor: agentMeta.color }"
        :title="`${agentMeta.label} is running in this terminal`"
      >
        <component :is="agentMeta.icon" :size="Math.round(iconSize * 0.8)" />
      </div>
      <input
        v-if="isRenaming"
        ref="renameInputRef"
        v-model="renameValue"
        class="header-name-input"
        :style="{ fontSize: titleSize + 'px' }"
        @blur="commitRename"
        @keydown.enter="commitRename"
        @keydown.esc="cancelRename"
      />
      <span
        v-else
        class="header-name"
        :style="{ fontSize: titleSize + 'px' }"
        title="Click to rename"
        @click.stop="onNameClick"
      >
        {{ displayName }}
      </span>
    </div>

    <div class="header-actions">
      <button
        v-if="canFocus"
        class="header-btn header-btn-focus"
        title="Focus this terminal (open it full-screen)"
        @click.stop="emit('focus-solo')"
      >
        <Maximize2 :size="iconSize" />
      </button>
      <button
        class="header-btn"
        :class="{ 'header-btn-active': !session.idleDetectionEnabled }"
        :title="session.idleDetectionEnabled
          ? 'On duty — will flag when idle or it rings the bell'
          : 'Off duty — idle/bell attention is disabled for this terminal'"
        @click.stop="toggleOffDuty"
      >
        <Bell v-if="session.idleDetectionEnabled" :size="iconSize" />
        <BellOff v-else :size="iconSize" />
      </button>
      <button
        class="header-btn header-btn-close"
        title="Close"
        @click.stop="emit('kill')"
      >
        <X :size="Math.round(iconSize * 0.85)" />
      </button>
    </div>
  </div>
</template>

<style scoped>
/* One header, deliberately. There used to be three styles behind a setting;
   the compact/comfortable variants stacked a cwd line and a duplicate agent
   pill on top of information the name and glyph already carry, which made every
   node taller for no gain. What's adjustable now is the thing that actually
   varies by taste and screen: the title size (Settings → Appearance). */
.terminal-header {
  display: flex;
  align-items: center;
  gap: calc(4px * var(--chrome-scale, 1));
  padding: calc(3px * var(--chrome-scale, 1)) calc(6px * var(--chrome-scale, 1));
  background: var(--tc-bg-header);
  border-bottom: 1px solid color-mix(in srgb, var(--tc-border-color) 100%, black 8%);
  flex-shrink: 0;
  min-height: calc(26px * var(--chrome-scale, 1));
  cursor: grab;
}

.header-main {
  display: flex;
  align-items: center;
  gap: calc(6px * var(--chrome-scale, 1));
  flex: 1;
  min-width: 0;
}

.header-status-dot {
  width: calc(6px * var(--chrome-scale, 1));
  height: calc(6px * var(--chrome-scale, 1));
  border-radius: 50%;
  flex-shrink: 0;
  box-shadow: 0 0 4px currentColor;
}

.header-name {
  font-weight: 600;
  color: var(--tc-text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  cursor: text;
  line-height: 1.3;
}

.header-name:hover {
  text-decoration: underline;
  text-decoration-color: var(--tc-accent);
}

.header-name-input {
  font-weight: 600;
  background: var(--tc-bg-secondary);
  border: 1px solid var(--tc-accent);
  border-radius: var(--tc-border-radius-sm);
  color: var(--tc-text-primary);
  padding: 1px 5px;
  outline: none;
  min-width: 0;
  flex: 1;
}

.header-agent-glyph {
  width: calc(15px * var(--chrome-scale, 1));
  height: calc(15px * var(--chrome-scale, 1));
  flex-shrink: 0;
  border: 1px solid;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  line-height: 1;
  opacity: 0.9;
}

.header-actions {
  display: flex;
  align-items: center;
  gap: calc(1px * var(--chrome-scale, 1));
  flex-shrink: 0;
}

.header-btn {
  width: calc(20px * var(--chrome-scale, 1));
  height: calc(20px * var(--chrome-scale, 1));
  border: none;
  background: transparent;
  /* Secondary, not muted: the icons were previously so low-contrast against the
     header that they effectively disappeared -- especially once the canvas was
     zoomed out at all. */
  color: var(--tc-text-secondary);
  cursor: pointer;
  border-radius: var(--tc-border-radius-sm);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  transition: background var(--tc-transition-fast), color var(--tc-transition-fast);
}

.header-btn:hover {
  background: var(--tc-bg-hover);
  color: var(--tc-text-primary);
}

.header-btn-files {
  margin-right: calc(2px * var(--chrome-scale, 1));
}

.header-btn-on {
  color: var(--tc-accent);
  background: var(--tc-accent-soft);
}

/* The focus button is a primary affordance -- tint it toward the accent so it
   reads as "the way to zero in on this terminal", distinct from the utility
   icons beside it. */
.header-btn-focus {
  color: var(--tc-accent);
}

.header-btn-focus:hover {
  background: var(--tc-accent-soft);
  color: var(--tc-accent);
}

.header-btn-active {
  color: var(--tc-warning);
  opacity: 0.85;
}

.header-btn-close:hover {
  background: var(--tc-accent-soft);
  color: var(--tc-accent);
}
</style>
