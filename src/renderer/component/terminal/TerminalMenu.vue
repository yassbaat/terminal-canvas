<script setup lang="ts">
import { ref } from "vue";
import type { TerminalSession } from "@renderer/type/terminal";

const props = defineProps<{
  session: TerminalSession;
}>();

const emit = defineEmits<{
  (e: "kill"): void;
  (e: "restart"): void;
  (e: "clear"): void;
  (e: "rename"): void;
  (e: "openCwd"): void;
  (e: "newFromCwd"): void;
}>();

const showMenu = ref(false);

function toggleMenu() {
  showMenu.value = !showMenu.value;
}

function closeMenu() {
  showMenu.value = false;
}

function onMenuItemClick(action: () => void) {
  action();
  closeMenu();
}
</script>

<template>
  <div class="terminal-menu" ref="menuRef">
    <button class="menu-trigger" @click="toggleMenu">
      <span class="menu-dots">&#8942;</span>
    </button>
    <div v-if="showMenu" class="menu-dropdown">
      <button
        class="menu-item"
        @click="onMenuItemClick(() => emit('rename'))"
      >
        Rename
      </button>
      <button
        class="menu-item"
        @click="onMenuItemClick(() => emit('openCwd'))"
      >
        Open Folder
      </button>
      <button
        class="menu-item"
        @click="onMenuItemClick(() => emit('newFromCwd'))"
      >
        New Terminal Here
      </button>
      <div class="menu-separator" />
      <button
        class="menu-item"
        @click="onMenuItemClick(() => emit('clear'))"
      >
        Clear
      </button>
      <button
        class="menu-item"
        @click="onMenuItemClick(() => emit('restart'))"
      >
        Restart
      </button>
      <div class="menu-separator" />
      <button
        class="menu-item menu-item-danger"
        @click="onMenuItemClick(() => emit('kill'))"
      >
        Kill
      </button>
    </div>
  </div>
</template>

<style scoped>
.terminal-menu {
  position: relative;
}

.menu-trigger {
  width: 22px;
  height: 22px;
  border: none;
  background: transparent;
  color: var(--tc-text-muted);
  cursor: pointer;
  border-radius: var(--tc-border-radius-sm);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  line-height: 1;
}

.menu-trigger:hover {
  background: var(--tc-bg-hover);
  color: var(--tc-text-primary);
}

.menu-dropdown {
  position: absolute;
  top: 100%;
  right: 0;
  min-width: 160px;
  background: var(--tc-bg-card);
  border: 1px solid var(--tc-border-color);
  border-radius: var(--tc-border-radius-sm);
  box-shadow: var(--tc-shadow-lg);
  z-index: var(--tc-z-modal);
  padding: 4px;
  margin-top: 2px;
}

.menu-item {
  display: block;
  width: 100%;
  text-align: left;
  padding: 6px 10px;
  border: none;
  background: transparent;
  color: var(--tc-text-secondary);
  font-size: var(--tc-font-size-sm);
  cursor: pointer;
  border-radius: var(--tc-border-radius-sm);
  font-family: var(--tc-font-sans);
}

.menu-item:hover {
  background: var(--tc-bg-hover);
  color: var(--tc-text-primary);
}

.menu-item-danger {
  color: var(--tc-error);
}

.menu-item-danger:hover {
  background: var(--tc-accent-soft);
}

.menu-separator {
  height: 1px;
  background: var(--tc-border-color);
  margin: 4px 0;
}
</style>
