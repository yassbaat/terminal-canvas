<script setup lang="ts">
import { computed, nextTick, ref, watch, onMounted, onBeforeUnmount } from "vue";
import { useTerminalStore } from "@renderer/store/terminal";
import { useWorkspaceStore } from "@renderer/store/workspace";
import type { StickyNote } from "@renderer/type/workspace";
import { NodeResizer } from "@vue-flow/node-resizer";
import { Pin, PinOff, Palette, X, Type, Plus, Minus } from "lucide-vue-next";

const NOTE_COLORS = [
  { bg: "#fef3c7", border: "#f59e0b", text: "#92400e" }, // amber
  { bg: "#dcfce7", border: "#22c55e", text: "#166534" }, // green
  { bg: "#dbeafe", border: "#3b82f6", text: "#1e40af" }, // blue
  { bg: "#fce7f3", border: "#ec4899", text: "#9d174d" }, // pink
  { bg: "#f3e8ff", border: "#a855f7", text: "#6b21a8" }, // purple
];

// A title is a short canvas label, not a place to write paragraphs -- cap it
// so it stays a glanceable heading (and so the giant font can't overflow).
const TITLE_MAX_LENGTH = 40;

const props = defineProps<{
  id: string;
  data: { note: StickyNote };
  selected?: boolean;
  dragging?: boolean;
}>();

const terminalStore = useTerminalStore();
const workspaceStore = useWorkspaceStore();

const isEditing = ref(false);
const editText = ref("");
const textareaRef = ref<HTMLTextAreaElement | HTMLInputElement | null>(null);

const note = computed(() => props.data.note);
const isTitle = computed(() => note.value.isTitle === true);

// ─── Normal-note body font size (+/- controls) ───────────────────
const DEFAULT_NOTE_FONT = 13;
const MIN_NOTE_FONT = 10;
const MAX_NOTE_FONT = 30;
const fontSize = computed(() => note.value.fontSize ?? DEFAULT_NOTE_FONT);
// Todo checkboxes scale with the text so they stay visually matched.
const checkboxSize = computed(() => Math.round(fontSize.value * 0.95));

function changeFontSize(delta: number): void {
  const next = Math.max(MIN_NOTE_FONT, Math.min(MAX_NOTE_FONT, fontSize.value + delta));
  if (next !== fontSize.value) {
    workspaceStore.updateStickyNote(note.value.id, { fontSize: next });
  }
}

const color = computed(() => {
  const idx = note.value.colorIndex ?? 0;
  return NOTE_COLORS[idx % NOTE_COLORS.length];
});

const pinnedTerminal = computed(() => {
  if (!note.value.pinnedToTerminalId) return null;
  return terminalStore.sessions.get(note.value.pinnedToTerminalId) || null;
});

/**
 * Parse note text into lines for display.
 * Lines starting with "- " become unchecked todos.
 * Lines starting with "+ " become checked todos.
 */
const displayLines = computed(() => {
  const raw = note.value.text || "";
  const lines = raw.split(/\r?\n/);
  return lines.map((line) => {
    if (line.startsWith("-")) {
      return { isTodo: true, checked: false, text: line.slice(1) };
    }
    if (line.startsWith("+")) {
      return { isTodo: true, checked: true, text: line.slice(1) };
    }
    return { isTodo: false, checked: false, text: line };
  });
});

function startEdit() {
  editText.value = note.value.text;
  isEditing.value = true;
  nextTick(() => {
    textareaRef.value?.focus();
  });
}

function saveEdit() {
  let text = editText.value;
  // A title collapses to a single glanceable line and is length-capped.
  if (isTitle.value) {
    text = text.replace(/\s*\n\s*/g, " ").slice(0, TITLE_MAX_LENGTH);
  }
  workspaceStore.updateStickyNote(note.value.id, { text });
  isEditing.value = false;
}

function deleteNote() {
  workspaceStore.removeStickyNote(note.value.id);
}

function cycleColor() {
  const idx = (note.value.colorIndex ?? 0) + 1;
  workspaceStore.updateStickyNote(note.value.id, { colorIndex: idx % NOTE_COLORS.length });
}

/**
 * Flip between a normal note and a big canvas title. Switching to title mode
 * flattens any multi-line text to one capped line so it renders cleanly at
 * the large heading size.
 */
function toggleTitle() {
  const next = !isTitle.value;
  const patch: { isTitle: boolean; text?: string } = { isTitle: next };
  if (next) {
    patch.text = (note.value.text || "").replace(/\s*\n\s*/g, " ").slice(0, TITLE_MAX_LENGTH);
  }
  workspaceStore.updateStickyNote(note.value.id, patch);
}

function togglePin() {
  if (note.value.pinnedToTerminalId) {
    workspaceStore.updateStickyNote(note.value.id, { pinnedToTerminalId: null });
  } else if (terminalStore.focusedTerminalId) {
    workspaceStore.updateStickyNote(note.value.id, { pinnedToTerminalId: terminalStore.focusedTerminalId });
  }
}

/**
 * Toggle a todo line between checked (+ ) and unchecked (- ).
 */
function toggleTodo(index: number) {
  const lines = (note.value.text || "").split(/\r?\n/);
  const line = lines[index];
  if (line.startsWith("-")) {
    lines[index] = "+" + line.slice(1);
  } else if (line.startsWith("+")) {
    lines[index] = "-" + line.slice(1);
  }
  workspaceStore.updateStickyNote(note.value.id, { text: lines.join("\n") });
}

// ─── Title auto-width ─────────────────────────────────────────────
// Grow a title note to fit its full text so it's never clipped to "Car…".
// Width is measured off a hidden, unconstrained span that lives inside the
// same container-query context as the visible title, so it reflects the exact
// rendered font (which itself scales with the note's height).
const rootRef = ref<HTMLElement | null>(null);
const measureRef = ref<HTMLElement | null>(null);
let titleResizeObserver: ResizeObserver | null = null;

// Measure the live text while editing, the saved text otherwise, so the note
// grows as you type the title.
const measuredTitle = computed(() =>
  isEditing.value ? editText.value || "Title" : note.value.text || "Title"
);

function fitTitleWidth(): void {
  if (!isTitle.value) return;
  const el = measureRef.value;
  if (!el) return;
  const needed = el.offsetWidth;
  if (needed <= 0) return;
  const target = Math.max(180, Math.ceil(needed) + 28); // padding + a little slack
  const cur = note.value.width ?? 0;
  if (Math.abs(cur - target) > 2) {
    workspaceStore.updateStickyNote(note.value.id, { width: target });
  }
}

function scheduleFit(): void {
  nextTick(fitTitleWidth);
}

watch(measuredTitle, scheduleFit);
watch(isTitle, (v) => {
  if (v) scheduleFit();
});

onMounted(() => {
  if (isTitle.value) scheduleFit();
  // The title font scales with the note's height (44cqh), so a taller note has
  // bigger text and needs a refit -- observe the node box for that.
  if (rootRef.value && typeof ResizeObserver !== "undefined") {
    titleResizeObserver = new ResizeObserver(() => {
      if (isTitle.value) fitTitleWidth();
    });
    titleResizeObserver.observe(rootRef.value);
  }
});

onBeforeUnmount(() => {
  titleResizeObserver?.disconnect();
  titleResizeObserver = null;
});
</script>

<template>
  <div
    ref="rootRef"
    class="sticky-note"
    :class="{ selected, dragging, 'is-title': isTitle }"
    :style="isTitle
      ? { color: color.border }
      : { backgroundColor: color.bg, borderColor: color.border, color: color.text }"
  >
    <NodeResizer :min-width="isTitle ? 180 : 140" :min-height="isTitle ? 60 : 100" :line-style="{ borderColor: color.border }" :handle-style="{ backgroundColor: color.border }" />
    <div class="note-header">
      <Pin v-if="pinnedTerminal" class="note-pin" :size="12" :title="`Pinned to ${pinnedTerminal.name}`" />
      <span v-else class="note-pin-placeholder" />
      <div class="note-actions">
        <button
          class="note-btn"
          :class="{ 'note-btn-active': isTitle }"
          :title="isTitle ? 'Turn back into a note' : 'Turn into a canvas title'"
          @click.stop="toggleTitle"
        >
          <Type :size="13" />
        </button>
        <button
          v-if="!isTitle"
          class="note-btn"
          title="Smaller text"
          :disabled="fontSize <= MIN_NOTE_FONT"
          @click.stop="changeFontSize(-1)"
        >
          <Minus :size="13" />
        </button>
        <button
          v-if="!isTitle"
          class="note-btn"
          title="Bigger text"
          :disabled="fontSize >= MAX_NOTE_FONT"
          @click.stop="changeFontSize(1)"
        >
          <Plus :size="13" />
        </button>
        <button v-if="!isTitle" class="note-btn" title="Change color" @click.stop="cycleColor">
          <Palette :size="13" />
        </button>
        <button v-if="!isTitle" class="note-btn" :title="note.pinnedToTerminalId ? 'Unpin' : 'Pin to focused terminal'" @click.stop="togglePin">
          <PinOff v-if="note.pinnedToTerminalId" :size="13" />
          <Pin v-else :size="13" />
        </button>
        <button class="note-btn" title="Delete note" @click.stop="deleteNote">
          <X :size="13" />
        </button>
      </div>
    </div>

    <!-- Title mode: single big line, minimal chrome -->
    <div v-if="isTitle" class="note-title-body" @click.stop="startEdit">
      <!-- Hidden, unconstrained twin used only to measure the title's true
           width so the node can grow to fit it (never truncates to "Car…"). -->
      <span ref="measureRef" class="note-title-measure" aria-hidden="true">{{ measuredTitle }}</span>
      <input
        v-if="isEditing"
        ref="textareaRef"
        v-model="editText"
        class="note-title-input"
        :maxlength="40"
        :style="{ color: color.border }"
        @blur="saveEdit"
        @keydown.enter="saveEdit"
        @keydown.esc="saveEdit"
        @click.stop
      />
      <span v-else class="note-title-text">{{ note.text || "Title" }}</span>
    </div>

    <!-- Normal note mode -->
    <div v-else-if="isEditing" class="note-body">
      <textarea
        ref="textareaRef"
        v-model="editText"
        class="note-textarea"
        :style="{ color: color.text, fontSize: fontSize + 'px' }"
        @blur="saveEdit"
        @keydown.enter.ctrl.stop="saveEdit"
        @click.stop
      />
    </div>
    <div v-else class="note-body" @click.stop="startEdit">
      <div v-if="!note.text" class="note-text note-placeholder" :style="{ fontSize: fontSize + 'px' }">Click to add text...</div>
      <div v-else class="note-text" :style="{ fontSize: fontSize + 'px' }">
        <div v-for="(line, i) in displayLines" :key="i" class="note-line">
          <label v-if="line.isTodo" class="todo-line">
            <input
              type="checkbox"
              :checked="line.checked"
              :style="{ width: checkboxSize + 'px', height: checkboxSize + 'px' }"
              @click.stop
              @change="toggleTodo(i)"
            />
            <span>{{ line.text }}</span>
          </label>
          <span v-else>{{ line.text }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.sticky-note {
  width: 100%;
  height: 100%;
  border-radius: var(--tc-border-radius);
  border: 1px solid;
  box-shadow: var(--tc-shadow-md);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  font-family: var(--tc-font-sans);
  cursor: grab;
  transition: box-shadow var(--tc-transition-fast);
}

.sticky-note.selected {
  box-shadow: 0 0 0 2px var(--tc-accent), var(--tc-shadow-lg);
}

/* Title mode: no card chrome, just big text that stays legible zoomed out.
   container-type: size lets the font scale with the node's own height, so
   resizing the title bigger makes the text bigger -- which is the whole
   point: a title you can still read when the canvas is zoomed way out. */
.sticky-note.is-title {
  background: transparent;
  border: none;
  box-shadow: none;
  container-type: size;
}

.sticky-note.is-title.selected {
  box-shadow: 0 0 0 2px var(--tc-accent);
  border-radius: var(--tc-border-radius);
}

.note-title-body {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: flex-start;
  padding: 0 8px;
  min-height: 0;
  cursor: text;
}

.note-title-text {
  font-size: clamp(20px, 44cqh, 160px);
  font-weight: 800;
  line-height: 1.05;
  letter-spacing: -0.01em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  width: 100%;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.15);
}

/* Off-screen twin of the title used purely for width measurement: same font
   metrics as .note-title-text but unconstrained, so its offsetWidth is the
   text's true natural width. */
.note-title-measure {
  position: absolute;
  visibility: hidden;
  pointer-events: none;
  white-space: nowrap;
  left: 0;
  top: 0;
  font-size: clamp(20px, 44cqh, 160px);
  font-weight: 800;
  line-height: 1.05;
  letter-spacing: -0.01em;
}

.note-title-input {
  font-size: clamp(20px, 44cqh, 160px);
  font-weight: 800;
  line-height: 1.05;
  letter-spacing: -0.01em;
  width: 100%;
  border: none;
  background: transparent;
  outline: none;
  font-family: var(--tc-font-sans);
}

.note-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 6px;
  min-height: 24px;
  flex-shrink: 0;
  opacity: 0;
  transition: opacity var(--tc-transition-fast);
}

.sticky-note:hover .note-header,
.sticky-note.selected .note-header {
  opacity: 1;
}

.note-pin {
  font-size: 10px;
}

.note-pin-placeholder {
  width: 10px;
}

.note-actions {
  display: flex;
  gap: 2px;
}

.note-btn {
  width: 22px;
  height: 22px;
  border: none;
  background: rgba(255, 255, 255, 0.4);
  border-radius: var(--tc-border-radius-sm);
  cursor: pointer;
  font-size: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  line-height: 1;
  padding: 0;
  transition: background var(--tc-transition-fast);
}

.note-btn:hover {
  background: rgba(255, 255, 255, 0.8);
}

.note-btn-active {
  background: rgba(0, 0, 0, 0.12);
}

/* In title mode the header sits over the transparent canvas, so give the
   action buttons a solid backing so they stay tappable/visible. */
.is-title .note-btn {
  background: var(--tc-bg-card);
  border: 1px solid var(--tc-border-color);
}

.is-title .note-btn:hover {
  background: var(--tc-bg-hover);
}

.note-body {
  flex: 1;
  padding: 6px 8px;
  min-height: 0;
  overflow: hidden;
}

.note-text {
  font-size: var(--tc-font-size-sm);
  line-height: var(--tc-line-height-normal);
  white-space: pre-wrap;
  word-break: break-word;
  width: 100%;
  height: 100%;
  overflow-y: auto;
}

.note-placeholder {
  opacity: 0.5;
}

.note-line {
  min-height: 1.2em;
}

.todo-line {
  display: flex;
  align-items: center;
  gap: 4px;
  cursor: default;
}

.todo-line input[type="checkbox"] {
  margin: 0;
  flex-shrink: 0;
  cursor: pointer;
  /* Sized inline (checkboxSize) so it tracks the note's text size; tint it to
     match the note's own color scheme. */
  accent-color: currentColor;
}

.note-btn:disabled {
  opacity: 0.35;
  cursor: default;
}

.todo-line span {
  user-select: text;
}

.note-textarea {
  width: 100%;
  height: 100%;
  border: none;
  background: transparent;
  resize: none;
  outline: none;
  font-family: var(--tc-font-sans);
  font-size: var(--tc-font-size-sm);
  line-height: var(--tc-line-height-normal);
}
</style>
