<script setup lang="ts">
import { ref, computed, watch, nextTick } from "vue";
import { useTerminalStore } from "@renderer/store/terminal";
import { useWorkspaceStore } from "@renderer/store/workspace";
import { useUIStore } from "@renderer/store/ui";

const props = defineProps<{
  open: boolean;
}>();

const emit = defineEmits<{
  (e: "update:open", value: boolean): void;
}>();

const terminalStore = useTerminalStore();
const workspaceStore = useWorkspaceStore();
const uiStore = useUIStore();

const query = ref("");
const selectedIndex = ref(0);
const inputRef = ref<HTMLInputElement | null>(null);

interface Command {
  id: string;
  label: string;
  shortcut?: string;
  action: () => void | Promise<void>;
}

const commands = computed<Command[]>(() => {
  const list: Command[] = [
    {
      id: "new-terminal",
      label: "New Terminal",
      shortcut: "Ctrl+N",
      action: async () => {
        const shellId = terminalStore.sessionDefaultShellId || workspaceStore.settings.defaultShellId;
        const shell = terminalStore.shells.find((s) => s.id === shellId);
        if (shell) {
          await terminalStore.createSession({ shellId: shell.id, cols: 80, rows: 24 });
        } else {
          uiStore.newTerminalDialogOpen = true;
        }
      },
    },
    { id: "save-workspace", label: "Save Workspace", shortcut: "Ctrl+S", action: async () => { await workspaceStore.saveCurrentWorkspace(); uiStore.showToast("Saved"); } },
    { id: "new-workspace", label: "New Workspace", action: () => { workspaceStore.createNewWorkspace(); } },
    { id: "toggle-sidebar", label: "Toggle Sidebar", action: () => { uiStore.sidebarVisible = !uiStore.sidebarVisible; } },
    { id: "toggle-inspector", label: "Toggle Inspector", action: () => { uiStore.inspectorVisible = !uiStore.inspectorVisible; } },
    { id: "open-settings", label: "Groq Settings", action: () => { uiStore.groqSettingsOpen = true; } },
  ];
  
  // Add kill actions for each session
  for (const session of terminalStore.allSessions) {
    list.push({
      id: `kill-${session.id}`,
      label: `Kill: ${session.name}`,
      action: async () => {
        await terminalStore.killSession(session.id);
        terminalStore.removeSession(session.id);
      },
    });
  }
  
  return list;
});

const filtered = computed(() => {
  if (!query.value) return commands.value;
  const q = query.value.toLowerCase();
  return commands.value.filter(c => c.label.toLowerCase().includes(q));
});

watch(() => props.open, (open) => {
  if (open) {
    query.value = "";
    selectedIndex.value = 0;
    nextTick(() => {
      inputRef.value?.focus();
    });
  }
});

watch(filtered, () => {
  selectedIndex.value = 0;
});

function execute(cmd: Command) {
  cmd.action();
  emit("update:open", false);
}

function handleKeydown(e: KeyboardEvent) {
  if (e.key === "ArrowDown") {
    selectedIndex.value = (selectedIndex.value + 1) % filtered.value.length;
    e.preventDefault();
  } else if (e.key === "ArrowUp") {
    selectedIndex.value = (selectedIndex.value - 1 + filtered.value.length) % filtered.value.length;
    e.preventDefault();
  } else if (e.key === "Enter") {
    const cmd = filtered.value[selectedIndex.value];
    if (cmd) execute(cmd);
  } else if (e.key === "Escape") {
    emit("update:open", false);
  }
}
</script>

<template>
  <div v-if="open" class="palette-overlay" @click="emit('update:open', false)">
    <div class="palette" @click.stop>
      <input
        ref="inputRef"
        v-model="query"
        class="palette-input"
        placeholder="Type a command..."
        @keydown="handleKeydown"
        autofocus
      />
      <div class="palette-list">
        <div
          v-for="(cmd, i) in filtered"
          :key="cmd.id"
          class="palette-item"
          :class="{ selected: i === selectedIndex }"
          @click="execute(cmd)"
          @mouseenter="selectedIndex = i"
        >
          <span class="palette-label">{{ cmd.label }}</span>
          <span v-if="cmd.shortcut" class="palette-shortcut">{{ cmd.shortcut }}</span>
        </div>
        <div v-if="filtered.length === 0" class="palette-empty">
          No commands found.
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.palette-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  justify-content: center;
  align-items: flex-start;
  padding-top: 15vh;
  z-index: var(--tc-z-modal);
}

.palette {
  width: 560px;
  max-width: 90vw;
  background: var(--tc-bg-card);
  border: 1px solid var(--tc-border-color);
  border-radius: var(--tc-border-radius);
  box-shadow: var(--tc-shadow-lg);
  overflow: hidden;
}

.palette-input {
  width: 100%;
  padding: 14px 18px;
  border: none;
  border-bottom: 1px solid var(--tc-border-color);
  background: var(--tc-bg-card);
  color: var(--tc-text-primary);
  font-size: var(--tc-font-size-md);
  outline: none;
  font-family: var(--tc-font-sans);
}

.palette-input::placeholder {
  color: var(--tc-text-muted);
}

.palette-list {
  max-height: 400px;
  overflow-y: auto;
}

.palette-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 18px;
  cursor: pointer;
  font-size: var(--tc-font-size-sm);
  color: var(--tc-text-secondary);
  transition: background var(--tc-transition-fast);
}

.palette-item:hover,
.palette-item.selected {
  background: var(--tc-bg-hover);
  color: var(--tc-text-primary);
}

.palette-label {
  flex: 1;
}

.palette-shortcut {
  font-size: var(--tc-font-size-xs);
  color: var(--tc-text-muted);
  font-family: var(--tc-font-mono);
  background: var(--tc-bg-secondary);
  padding: 2px 6px;
  border-radius: var(--tc-border-radius-sm);
}

.palette-empty {
  padding: 24px;
  text-align: center;
  color: var(--tc-text-muted);
  font-size: var(--tc-font-size-sm);
}
</style>
