<script setup lang="ts">
import { computed, nextTick, ref } from "vue";
import { useTerminalStore } from "@renderer/store/terminal";
import { useWorkspaceStore } from "@renderer/store/workspace";
import { NodeResizer } from "@vue-flow/node-resizer";
import { Pin, PinOff, Palette, X } from "lucide-vue-next";

const NOTE_COLORS = [
  { bg: "#fef3c7", border: "#f59e0b", text: "#92400e" }, // amber
  { bg: "#dcfce7", border: "#22c55e", text: "#166534" }, // green
  { bg: "#dbeafe", border: "#3b82f6", text: "#1e40af" }, // blue
  { bg: "#fce7f3", border: "#ec4899", text: "#9d174d" }, // pink
  { bg: "#f3e8ff", border: "#a855f7", text: "#6b21a8" }, // purple
];

const props = defineProps<{
  id: string;
  data: { note: { id: string; text: string; colorIndex?: number; pinnedToTerminalId?: string | null } };
  selected?: boolean;
  dragging?: boolean;
}>();

const terminalStore = useTerminalStore();
const workspaceStore = useWorkspaceStore();

const isEditing = ref(false);
const editText = ref("");
const textareaRef = ref<HTMLTextAreaElement | null>(null);

const note = computed(() => props.data.note);

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
  workspaceStore.updateStickyNote(note.value.id, { text: editText.value });
  isEditing.value = false;
}

function deleteNote() {
  workspaceStore.removeStickyNote(note.value.id);
}

function cycleColor() {
  const idx = (note.value.colorIndex ?? 0) + 1;
  workspaceStore.updateStickyNote(note.value.id, { colorIndex: idx % NOTE_COLORS.length });
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
</script>

<template>
  <div
    class="sticky-note"
    :class="{ selected, dragging }"
    :style="{
      backgroundColor: color.bg,
      borderColor: color.border,
      color: color.text,
    }"
  >
    <NodeResizer :min-width="140" :min-height="100" :line-style="{ borderColor: color.border }" :handle-style="{ backgroundColor: color.border }" />
    <div class="note-header">
      <Pin v-if="pinnedTerminal" class="note-pin" :size="12" :title="`Pinned to ${pinnedTerminal.name}`" />
      <span v-else class="note-pin-placeholder" />
      <div class="note-actions">
        <button class="note-btn" title="Change color" @click.stop="cycleColor">
          <Palette :size="13" />
        </button>
        <button class="note-btn" :title="note.pinnedToTerminalId ? 'Unpin' : 'Pin to focused terminal'" @click.stop="togglePin">
          <PinOff v-if="note.pinnedToTerminalId" :size="13" />
          <Pin v-else :size="13" />
        </button>
        <button class="note-btn" title="Delete note" @click.stop="deleteNote">
          <X :size="13" />
        </button>
      </div>
    </div>

    <div v-if="isEditing" class="note-body">
      <textarea
        ref="textareaRef"
        v-model="editText"
        class="note-textarea"
        :style="{ color: color.text }"
        @blur="saveEdit"
        @keydown.enter.ctrl.stop="saveEdit"
        @click.stop
      />
    </div>
    <div v-else class="note-body" @click.stop="startEdit">
      <div v-if="!note.text" class="note-text note-placeholder">Click to add text...</div>
      <div v-else class="note-text">
        <div v-for="(line, i) in displayLines" :key="i" class="note-line">
          <label v-if="line.isTodo" class="todo-line">
            <input
              type="checkbox"
              :checked="line.checked"
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
