<script setup lang="ts">
import { ref, computed } from "vue";
import type { PromptEntry } from "@renderer/type/prompt";
import { formatTime, getFirstLine } from "@renderer/util/format";
import { Copy, Repeat, Pin, PinOff, X } from "lucide-vue-next";

const props = defineProps<{
  prompt: PromptEntry;
  /** The most-recently-submitted entry -- rendered larger/bolder to stand out. */
  isLatest?: boolean;
}>();

const emit = defineEmits<{
  (e: "resend", promptId: string): void;
  (e: "delete", promptId: string): void;
  (e: "pin", promptId: string): void;
  (e: "copy", text: string): void;
}>();

const expanded = ref(false);

const kindBadge = computed(() => {
  switch (props.prompt.kind) {
    case "shell-command":
      return "CMD";
    case "agent-prompt":
      return "AI";
    case "multiline":
      return "ML";
    default:
      return "?";
  }
});

const kindColor = computed(() => {
  switch (props.prompt.kind) {
    case "shell-command":
      return "var(--tc-info)";
    case "agent-prompt":
      return "var(--tc-accent)";
    case "multiline":
      return "var(--tc-warning)";
    default:
      return "var(--tc-text-muted)";
  }
});

const displayText = computed(() => {
  if (expanded.value) return props.prompt.text;
  return getFirstLine(props.prompt.text, 80);
});

async function copyToClipboard() {
  await navigator.clipboard.writeText(props.prompt.text);
  emit("copy", props.prompt.text);
}
</script>

<template>
  <div
    class="prompt-item"
    :class="{
      pinned: prompt.pinned,
      expanded,
      deleted: prompt.status === 'deleted',
      latest: isLatest,
    }"
  >
    <div class="prompt-main" @click="expanded = !expanded">
      <div class="prompt-top">
        <span
          class="prompt-badge"
          :style="{
            backgroundColor: kindColor + '20',
            color: kindColor,
          }"
        >
          {{ kindBadge }}
        </span>
        <span class="prompt-time">{{ formatTime(prompt.submittedAt) }}</span>
        <Pin v-if="prompt.pinned" class="prompt-pinned" :size="11" />
      </div>
      <div class="prompt-text">{{ displayText }}</div>
    </div>

    <div class="prompt-actions">
      <button
        class="prompt-action-btn"
        title="Copy"
        @click.stop="copyToClipboard"
      >
        <Copy :size="12" />
      </button>
      <button
        class="prompt-action-btn"
        title="Resend"
        @click.stop="emit('resend', prompt.id)"
      >
        <Repeat :size="12" />
      </button>
      <button
        class="prompt-action-btn"
        :title="prompt.pinned ? 'Unpin' : 'Pin'"
        @click.stop="emit('pin', prompt.id)"
      >
        <PinOff v-if="prompt.pinned" :size="12" />
        <Pin v-else :size="12" />
      </button>
      <button
        class="prompt-action-btn"
        title="Delete"
        @click.stop="emit('delete', prompt.id)"
      >
        <X :size="12" />
      </button>
    </div>
  </div>
</template>

<style scoped>
.prompt-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 5px 6px;
  border-radius: var(--tc-border-radius-sm);
  background: var(--tc-memory-item-bg);
  border: 1px solid transparent;
  transition: all var(--tc-transition-fast);
  font-size: var(--tc-font-size-xs);
}

.prompt-item:hover {
  background: var(--tc-memory-item-hover);
  border-color: var(--tc-memory-border);
}

.prompt-item.pinned {
  background: var(--tc-memory-pinned-bg);
  border-color: var(--tc-memory-pinned-border);
}

.prompt-item.deleted {
  opacity: 0.3;
}

/* The most recent prompt is the "what's happening now" line -- make it bigger,
   bolder and accent-marked so it reads at a glance in the memory list. */
.prompt-item.latest {
  border-color: var(--tc-memory-border);
  box-shadow: inset 3px 0 0 var(--tc-accent);
}

.prompt-item.latest .prompt-text {
  font-size: var(--tc-font-size-sm);
  font-weight: 600;
  color: var(--tc-text-primary);
  max-height: 5.6em;
}

.prompt-main {
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.prompt-top {
  display: flex;
  align-items: center;
  gap: 5px;
}

.prompt-badge {
  font-size: 9px;
  font-weight: 700;
  padding: 1px 4px;
  border-radius: 3px;
  flex-shrink: 0;
}

.prompt-time {
  color: var(--tc-text-muted);
  font-size: 10px;
  flex-shrink: 0;
}

.prompt-pinned {
  font-size: 10px;
  margin-left: auto;
}

.prompt-text {
  color: var(--tc-text-primary);
  line-height: var(--tc-line-height-tight);
  white-space: pre-wrap;
  word-break: break-word;
  font-family: var(--tc-font-mono);
  font-size: var(--tc-font-size-xs);
  max-height: 3.9em;
  overflow: hidden;
  text-overflow: ellipsis;
}

.prompt-item.expanded .prompt-text {
  max-height: none;
}

.prompt-actions {
  display: flex;
  align-items: center;
  gap: 2px;
  opacity: 0;
  transition: opacity var(--tc-transition-fast);
  padding-top: 2px;
}

.prompt-item:hover .prompt-actions {
  opacity: 1;
}

.prompt-action-btn {
  width: 18px;
  height: 18px;
  border: none;
  background: var(--tc-bg-secondary);
  color: var(--tc-text-muted);
  cursor: pointer;
  border-radius: 3px;
  font-size: 9px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all var(--tc-transition-fast);
}

.prompt-action-btn:hover {
  background: var(--tc-accent);
  color: white;
}
</style>
