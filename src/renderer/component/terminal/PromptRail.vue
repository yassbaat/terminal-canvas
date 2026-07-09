<script setup lang="ts">
import { computed, ref } from "vue";
import { usePromptStore } from "@renderer/store/prompt";
import type { PromptEntry } from "@renderer/type/prompt";
import PromptItem from "./PromptItem.vue";
import { NotebookPen, ChevronRight } from "lucide-vue-next";

const props = defineProps<{
  terminalId: string;
}>();

const promptStore = usePromptStore();
const isCollapsed = ref(false);
const searchQuery = ref("");

const prompts = computed(() => {
  let list = promptStore.getPromptsForTerminal(props.terminalId);
  if (searchQuery.value) {
    const q = searchQuery.value.toLowerCase();
    list = list.filter((p: PromptEntry) => p.text.toLowerCase().includes(q));
  }
  return list;
});

const promptCount = computed(() => prompts.value.length);

function handleResend(promptId: string) {
  promptStore.resendPrompt(props.terminalId, promptId);
}

function handleDelete(promptId: string) {
  promptStore.deletePrompt(props.terminalId, promptId);
}

function handlePin(promptId: string) {
  promptStore.pinPrompt(props.terminalId, promptId);
}

function handleCopy(_text: string) {
  // Copy is handled internally by PromptItem
  // This emit can be used for toast notifications if needed
}

// Only stop the wheel event from reaching the canvas pane (which would pan)
// while this list can still absorb the scroll itself -- otherwise scrolling
// through memory entries and panning the canvas would both happen at once.
function onListWheel(e: WheelEvent): void {
  const el = e.currentTarget as HTMLElement;
  const atTop = el.scrollTop <= 0;
  const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 1;
  const canAbsorb = (e.deltaY < 0 && !atTop) || (e.deltaY > 0 && !atBottom);
  if (canAbsorb) e.stopPropagation();
}
</script>

<template>
  <div class="prompt-rail" :class="{ collapsed: isCollapsed }">
    <!-- Collapsed strip -->
    <div v-if="isCollapsed" class="rail-collapsed" @click="isCollapsed = false">
      <NotebookPen class="rail-collapsed-icon" :size="14" />
      <div class="rail-collapsed-count">{{ promptCount }}</div>
    </div>

    <!-- Expanded panel -->
    <template v-else>
      <div class="rail-header">
        <span class="rail-title">Agent Memory</span>
        <button class="rail-close-btn" title="Collapse" @click="isCollapsed = true">
          <ChevronRight :size="13" />
        </button>
      </div>

      <div class="rail-search">
        <input
          v-model="searchQuery"
          class="rail-search-input"
          placeholder="Search memory..."
          type="text"
        />
      </div>

      <div class="rail-list" @wheel="onListWheel">
        <div v-if="prompts.length === 0" class="rail-empty">
          No prompts yet.
          <br />
          <span class="rail-empty-hint">Commands you type will appear here.</span>
        </div>
        <PromptItem
          v-for="prompt in prompts"
          :key="prompt.id"
          :prompt="prompt"
          @resend="handleResend"
          @delete="handleDelete"
          @pin="handlePin"
          @copy="handleCopy"
        />
      </div>
    </template>
  </div>
</template>

<style scoped>
.prompt-rail {
  display: flex;
  flex-direction: column;
  background: var(--tc-memory-bg);
  height: 100%;
  overflow: hidden;
  border-left: 1px solid var(--tc-memory-border);
  transition: width var(--tc-transition-normal);
  width: var(--memory-rail-width, 220px);
  flex-shrink: 0;
}

.prompt-rail.collapsed {
  width: 32px;
  min-width: 32px;
  cursor: pointer;
}

.rail-collapsed {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 8px 0;
  height: 100%;
  gap: 4px;
}

.rail-collapsed:hover {
  background: var(--tc-memory-item-hover);
}

.rail-collapsed-icon {
  font-size: 14px;
  opacity: 0.6;
}

.rail-collapsed-count {
  font-size: var(--tc-font-size-xs);
  color: var(--tc-accent);
  font-weight: 600;
}

.rail-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 8px;
  border-bottom: 1px solid var(--tc-memory-border);
  flex-shrink: 0;
}

.rail-title {
  font-size: var(--tc-font-size-xs);
  font-weight: 600;
  color: var(--tc-text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.rail-close-btn {
  width: 18px;
  height: 18px;
  border: none;
  background: transparent;
  color: var(--tc-text-muted);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  border-radius: var(--tc-border-radius-sm);
}

.rail-close-btn:hover {
  background: var(--tc-memory-item-hover);
  color: var(--tc-text-primary);
}

.rail-search {
  padding: 6px 8px;
  border-bottom: 1px solid var(--tc-memory-border);
  flex-shrink: 0;
}

.rail-search-input {
  width: 100%;
  padding: 4px 8px;
  border: 1px solid var(--tc-memory-border);
  border-radius: var(--tc-border-radius-sm);
  background: var(--tc-bg-secondary);
  color: var(--tc-text-primary);
  font-size: var(--tc-font-size-xs);
  outline: none;
}

.rail-search-input:focus {
  border-color: var(--tc-accent);
}

.rail-search-input::placeholder {
  color: var(--tc-text-muted);
}

.rail-list {
  flex: 1;
  overflow-y: auto;
  padding: 4px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  overscroll-behavior: contain;
}

.rail-empty {
  padding: 20px 8px;
  text-align: center;
  font-size: var(--tc-font-size-xs);
  color: var(--tc-text-muted);
  line-height: var(--tc-line-height-normal);
}

.rail-empty-hint {
  opacity: 0.6;
}
</style>
