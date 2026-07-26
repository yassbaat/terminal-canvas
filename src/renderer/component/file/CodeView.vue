<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount, shallowRef, nextTick } from "vue";
import { EditorState, Compartment, type Extension } from "@codemirror/state";
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  drawSelection,
  rectangularSelection,
  crosshairCursor,
  dropCursor,
} from "@codemirror/view";
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from "@codemirror/commands";
import {
  syntaxHighlighting,
  indentOnInput,
  bracketMatching,
  foldGutter,
  foldKeymap,
} from "@codemirror/language";
import { searchKeymap, highlightSelectionMatches } from "@codemirror/search";
import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
import { RotateCcw, Save, TriangleAlert, FileWarning } from "lucide-vue-next";
import { useFileStore } from "@renderer/store/file";
import { cateEditorTheme, cateHighlighter, languageFor, languageLabel } from "@renderer/util/editor";

const props = withDefaults(
  defineProps<{
    path: string;
    /**
     * Canvas zoom, when this view is inside a transformed node. Below
     * HYDRATE_ZOOM the live editor isn't mounted -- see the comment on
     * `hydrated`. Omit (or pass 1) for untransformed surfaces.
     */
    zoom?: number;
    /** Force the live editor regardless of zoom (the node is focused). */
    active?: boolean;
  }>(),
  { zoom: 1, active: false }
);

const fileStore = useFileStore();

/**
 * Below this zoom the text is too small to read, let alone edit, so mounting a
 * real CodeMirror instance per node buys nothing and costs a lot once there are
 * several file nodes on the canvas. Under the threshold we render a plain <pre>
 * -- no parser, no view, no measurement -- and swap in the editor when the node
 * is focused or the user zooms in. This mirrors how TerminalNode already avoids
 * running an xterm it isn't showing.
 */
const HYDRATE_ZOOM = 0.6;

const host = ref<HTMLDivElement | null>(null);
const view = shallowRef<EditorView | null>(null);
const languageCompartment = new Compartment();
const saving = ref(false);
const savedFlash = ref(false);

const entry = computed(() => fileStore.getFile(props.path));
const dirty = computed(() => fileStore.isDirty(props.path));
const conflicted = computed(() => !!entry.value?.externalChange);
const hydrated = computed(() => props.active || props.zoom >= HYDRATE_ZOOM);

const staticLines = computed(() => {
  const text = entry.value?.draft ?? "";
  // The unhydrated view is a reading aid at small sizes; rendering a 20k-line
  // file into the DOM to be shown at 40% scale is pure waste.
  return text.split("\n").slice(0, 500);
});

async function handleSave(force = false): Promise<void> {
  if (saving.value) return;
  saving.value = true;
  const result = await fileStore.save(props.path, force);
  saving.value = false;
  if (result.ok) {
    savedFlash.value = true;
    setTimeout(() => (savedFlash.value = false), 1200);
  }
}

function baseExtensions(): Extension[] {
  return [
    lineNumbers(),
    foldGutter(),
    highlightSpecialChars(),
    history(),
    drawSelection(),
    dropCursor(),
    EditorState.allowMultipleSelections.of(true),
    indentOnInput(),
    bracketMatching(),
    closeBrackets(),
    rectangularSelection(),
    crosshairCursor(),
    highlightActiveLine(),
    highlightActiveLineGutter(),
    highlightSelectionMatches(),
    syntaxHighlighting(cateHighlighter),
    cateEditorTheme,
    EditorView.lineWrapping,
    languageCompartment.of([]),
    keymap.of([
      // Save must come first so it wins over any default binding.
      {
        key: "Mod-s",
        preventDefault: true,
        run: () => {
          void handleSave();
          return true;
        },
      },
      ...closeBracketsKeymap,
      ...defaultKeymap,
      ...searchKeymap,
      ...historyKeymap,
      ...foldKeymap,
      indentWithTab,
    ]),
    EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        fileStore.setDraft(props.path, update.state.doc.toString());
      }
    }),
    EditorState.readOnly.of(!!entry.value?.truncated),
    // The canvas swallows wheel events for panning; inside the editor the wheel
    // has to scroll the document instead, so stop it before it reaches Vue Flow.
    EditorView.domEventHandlers({
      wheel: (event) => {
        event.stopPropagation();
        return false;
      },
      mousedown: (event) => {
        // Keep node-drag from stealing the press that starts a text selection.
        event.stopPropagation();
        return false;
      },
    }),
  ];
}

async function mountEditor(): Promise<void> {
  if (view.value || !host.value || !entry.value || entry.value.binary) return;

  const state = EditorState.create({
    doc: entry.value.draft,
    extensions: baseExtensions(),
  });
  view.value = new EditorView({ state, parent: host.value });

  const language = await languageFor(props.path);
  if (language && view.value) {
    view.value.dispatch({
      effects: languageCompartment.reconfigure(language),
    });
  }
}

function destroyEditor(): void {
  view.value?.destroy();
  view.value = null;
}

/**
 * Replace the document without going through the update listener's dirty
 * tracking -- used when the file changed on disk and we're following it.
 * Cursor and scroll are preserved so a live-reloading file doesn't yank the
 * reader back to line 1 every time the agent saves.
 */
function syncDocFromStore(): void {
  const v = view.value;
  const text = entry.value?.draft ?? "";
  if (!v || v.state.doc.toString() === text) return;

  const scrollTop = v.scrollDOM.scrollTop;
  const anchor = Math.min(v.state.selection.main.anchor, text.length);
  v.dispatch({
    changes: { from: 0, to: v.state.doc.length, insert: text },
    selection: { anchor },
  });
  v.scrollDOM.scrollTop = scrollTop;
}

watch(hydrated, async (on) => {
  if (on) {
    await nextTick();
    await mountEditor();
  } else {
    destroyEditor();
  }
});

watch(
  () => props.path,
  async () => {
    destroyEditor();
    if (hydrated.value) {
      await nextTick();
      await mountEditor();
    }
  }
);

// External reloads land in the store first; push them into a live editor.
watch(
  () => entry.value?.content,
  () => syncDocFromStore()
);

/**
 * The editor can't exist before the first read resolves, and the entry itself
 * may not exist yet either -- a canvas file node calls open() from its own
 * onMounted, which runs *after* this child's. Watching "is there a loaded
 * entry" rather than a loading -> loaded transition covers both orders: the
 * file arriving late, and it already being open on another surface.
 */
watch(
  () => !!entry.value && !entry.value.loading,
  async (ready) => {
    if (ready && hydrated.value && !view.value) {
      await nextTick();
      await mountEditor();
    }
  }
);

onMounted(async () => {
  if (hydrated.value && entry.value && !entry.value.loading) {
    await nextTick();
    await mountEditor();
  }
});

onBeforeUnmount(destroyEditor);

defineExpose({ save: handleSave });
</script>

<template>
  <div class="code-view">
    <div v-if="entry?.loading" class="code-state">Loading…</div>

    <div v-else-if="entry?.error" class="code-state code-state-error">
      <TriangleAlert :size="15" />
      <span>{{ entry.error }}</span>
    </div>

    <div v-else-if="entry?.binary" class="code-state">
      <FileWarning :size="15" />
      <span>Binary file — nothing to show here.</span>
    </div>

    <template v-else>
      <div v-if="conflicted" class="code-conflict">
        <TriangleAlert :size="14" />
        <span class="conflict-text">Changed on disk while you were editing.</span>
        <button class="conflict-btn" @click="fileStore.revert(path)">
          <RotateCcw :size="12" /> Use theirs
        </button>
        <button class="conflict-btn conflict-btn-primary" @click="handleSave(true)">
          <Save :size="12" /> Keep mine
        </button>
      </div>

      <div v-if="entry?.truncated" class="code-notice">
        Showing the first part of a large file. Read-only.
      </div>

      <!-- Live editor above the hydration threshold, a cheap static render below
           it. Both are always in the tree so the swap doesn't reflow the node. -->
      <div v-show="hydrated" ref="host" class="code-host nodrag nowheel" />
      <pre v-if="!hydrated" class="code-static">{{ staticLines.join("\n") }}</pre>

      <div class="code-status">
        <span class="status-lang">{{ languageLabel(path) }}</span>
        <span v-if="dirty" class="status-dirty">Unsaved</span>
        <span v-else-if="savedFlash" class="status-saved">Saved</span>
      </div>
    </template>
  </div>
</template>

<style scoped>
.code-view {
  position: relative;
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  min-height: 0;
  background: var(--tc-editor-bg);
  overflow: hidden;
}

.code-host {
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.code-static {
  flex: 1;
  min-height: 0;
  margin: 0;
  padding: 6px 10px;
  overflow: hidden;
  font-family: var(--tc-font-mono);
  font-size: 12px;
  line-height: 1.5;
  color: var(--tc-editor-fg);
  white-space: pre;
  opacity: 0.75;
}

.code-state {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  flex: 1;
  padding: 16px;
  font-size: 12px;
  color: var(--tc-text-muted);
  text-align: center;
}

.code-state-error {
  color: var(--tc-error);
}

.code-conflict {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  background: var(--tc-warning-soft);
  border-bottom: 1px solid var(--tc-border-color);
  color: var(--tc-warning);
  font-size: 11px;
}

.conflict-text {
  flex: 1;
  min-width: 0;
}

.conflict-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 7px;
  background: var(--tc-bg-card);
  border: 1px solid var(--tc-border-color);
  border-radius: var(--tc-border-radius-sm);
  color: var(--tc-text-secondary);
  font-size: 11px;
  cursor: pointer;
}

.conflict-btn:hover {
  background: var(--tc-bg-hover);
  color: var(--tc-text-primary);
}

.conflict-btn-primary {
  border-color: var(--tc-accent);
  color: var(--tc-accent);
}

.code-notice {
  padding: 4px 10px;
  background: var(--tc-bg-header);
  border-bottom: 1px solid var(--tc-border-color);
  color: var(--tc-text-muted);
  font-size: 11px;
}

.code-status {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 3px 10px;
  background: var(--tc-bg-header);
  border-top: 1px solid var(--tc-border-color);
  font-size: 10px;
  color: var(--tc-text-muted);
}

.status-dirty {
  color: var(--tc-warning);
}

.status-saved {
  color: var(--tc-success);
}
</style>

<!-- Not scoped: CodeMirror builds its own DOM outside the component's style
     scope, so the token classes emitted by cateHighlighter have to be global. -->
<style>
.tok-comment { color: var(--tc-syn-comment); font-style: italic; }
.tok-keyword { color: var(--tc-syn-keyword); }
.tok-string { color: var(--tc-syn-string); }
.tok-number { color: var(--tc-syn-number); }
.tok-function { color: var(--tc-syn-function); }
.tok-variable { color: var(--tc-syn-variable); }
.tok-property { color: var(--tc-syn-property); }
.tok-type { color: var(--tc-syn-type); }
.tok-constant { color: var(--tc-syn-constant); }
.tok-operator { color: var(--tc-syn-operator); }
.tok-punctuation { color: var(--tc-syn-punctuation); }
.tok-tag { color: var(--tc-syn-tag); }
.tok-attribute { color: var(--tc-syn-attribute); }
.tok-heading { color: var(--tc-syn-heading); font-weight: 600; }
.tok-link { color: var(--tc-syn-link); text-decoration: underline; }
.tok-emphasis { font-style: italic; }
.tok-strong { font-weight: 700; }
.tok-strikethrough { text-decoration: line-through; }
.tok-invalid { color: var(--tc-syn-invalid); }
</style>
