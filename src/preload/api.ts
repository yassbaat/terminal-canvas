import { contextBridge, ipcRenderer } from "electron";
import type {
  TerminalAPI,
  PromptAPI,
  WorkspaceAPI,
  GroqAPI,
  ShellAPI,
  DialogAPI,
} from "./api-types";
import type {
  TerminalDataEvent,
  TerminalExitEvent,
  TerminalCwdEvent,
  TerminalRenamedEvent,
  TerminalAttentionEvent,
  TerminalReadyEvent,
} from "@renderer/type/terminal";
import type { PromptEntry } from "@renderer/type/prompt";

const terminal: TerminalAPI = {
  create: (options) => ipcRenderer.invoke("terminal:create", options),
  write: (terminalId, data) => ipcRenderer.invoke("terminal:write", { terminalId, data }),
  resize: (terminalId, cols, rows) => ipcRenderer.invoke("terminal:resize", { terminalId, cols, rows }),
  kill: (terminalId) => ipcRenderer.invoke("terminal:kill", { terminalId }),
  restart: (terminalId) => ipcRenderer.invoke("terminal:restart", { terminalId }),
  clear: (terminalId) => ipcRenderer.invoke("terminal:clear", { terminalId }),
  listShells: () => ipcRenderer.invoke("terminal:listShells"),
  openCwdInExplorer: (terminalId) => ipcRenderer.invoke("terminal:openCwdInExplorer", { terminalId }),
  getBuffer: (terminalId) => ipcRenderer.invoke("terminal:getBuffer", { terminalId }),
  setIdleThreshold: (ms) => ipcRenderer.invoke("terminal:setIdleThreshold", { ms }),
  setIdleDetectionEnabled: (terminalId, enabled) =>
    ipcRenderer.invoke("terminal:setIdleDetectionEnabled", { terminalId, enabled }),

  onData: (callback: (event: TerminalDataEvent) => void) => {
    const handler = (_: unknown, data: TerminalDataEvent) => callback(data);
    ipcRenderer.on("terminal:data", handler);
    return () => ipcRenderer.removeListener("terminal:data", handler);
  },

  onExit: (callback: (event: TerminalExitEvent) => void) => {
    const handler = (_: unknown, data: TerminalExitEvent) => callback(data);
    ipcRenderer.on("terminal:exit", handler);
    return () => ipcRenderer.removeListener("terminal:exit", handler);
  },

  onCwdChanged: (callback: (event: TerminalCwdEvent) => void) => {
    const handler = (_: unknown, data: TerminalCwdEvent) => callback(data);
    ipcRenderer.on("terminal:cwdChanged", handler);
    return () => ipcRenderer.removeListener("terminal:cwdChanged", handler);
  },

  onRenamed: (callback: (event: TerminalRenamedEvent) => void) => {
    const handler = (_: unknown, data: TerminalRenamedEvent) => callback(data);
    ipcRenderer.on("terminal:renamed", handler);
    return () => ipcRenderer.removeListener("terminal:renamed", handler);
  },

  onAttention: (callback: (event: TerminalAttentionEvent) => void) => {
    const handler = (_: unknown, data: TerminalAttentionEvent) => callback(data);
    ipcRenderer.on("terminal:attention", handler);
    return () => ipcRenderer.removeListener("terminal:attention", handler);
  },

  onReady: (callback: (event: TerminalReadyEvent) => void) => {
    const handler = (_: unknown, data: TerminalReadyEvent) => callback(data);
    ipcRenderer.on("terminal:ready", handler);
    return () => ipcRenderer.removeListener("terminal:ready", handler);
  },
};

const prompt: PromptAPI = {
  add: (options) => ipcRenderer.invoke("prompt:add", options),
  list: (terminalId) => ipcRenderer.invoke("prompt:list", { terminalId }),
  delete: (promptId) => ipcRenderer.invoke("prompt:delete", { promptId }),
  pin: (promptId) => ipcRenderer.invoke("prompt:pin", { promptId }),
  resend: (promptId, targetTerminalId?) => ipcRenderer.invoke("prompt:resend", { promptId, targetTerminalId }),
  clearForTerminal: (terminalId) => ipcRenderer.invoke("prompt:clearForTerminal", { terminalId }),
  onAdd: (callback: (entry: PromptEntry) => void) => {
    const handler = (_: unknown, entry: PromptEntry) => callback(entry);
    ipcRenderer.on("prompt:add", handler);
    return () => ipcRenderer.removeListener("prompt:add", handler);
  },
};

const workspace: WorkspaceAPI = {
  save: (options) => ipcRenderer.invoke("workspace:save", options),
  load: (workspaceId) => ipcRenderer.invoke("workspace:load", { workspaceId }),
  list: () => ipcRenderer.invoke("workspace:list"),
  delete: (workspaceId) => ipcRenderer.invoke("workspace:delete", { workspaceId }),
  rename: (workspaceId, name) => ipcRenderer.invoke("workspace:rename", { workspaceId, name }),
  updateViewport: (x, y, zoom) => ipcRenderer.invoke("workspace:updateViewport", { x, y, zoom }),
};

const groq: GroqAPI = {
  generateTerminalName: (terminalId, context) =>
    ipcRenderer.invoke("groq:generateTerminalName", { terminalId, context }),
  generateGroupName: (context) =>
    ipcRenderer.invoke("groq:generateGroupName", { context }),
  renameTerminal: (terminalId) => ipcRenderer.invoke("groq:renameTerminal", { terminalId }),
  summarizeCommand: (text) => ipcRenderer.invoke("groq:summarizeCommand", { text }),
  getSettings: () => ipcRenderer.invoke("groq:getSettings"),
  updateSettings: (settings) => ipcRenderer.invoke("groq:updateSettings", { settings }),
  testConnection: () => ipcRenderer.invoke("groq:testConnection"),
};

const shell: ShellAPI = {
  registerContextMenu: () => ipcRenderer.invoke("shell:registerContextMenu"),
  unregisterContextMenu: () => ipcRenderer.invoke("shell:unregisterContextMenu"),
  isContextMenuRegistered: () => ipcRenderer.invoke("shell:isContextMenuRegistered"),
  onOpenDir: (callback: (dir: string) => void) => {
    const handler = (_: unknown, dir: string) => callback(dir);
    ipcRenderer.on("shell:openDir", handler);
    return () => ipcRenderer.removeListener("shell:openDir", handler);
  },
  rendererReady: () => ipcRenderer.send("shell:rendererReady"),
};

const dialog: DialogAPI = {
  showOpenDialog: (options) => ipcRenderer.invoke("dialog:showOpenDialog", options),
};

export function exposeAPI(): void {
  contextBridge.exposeInMainWorld("api", {
    platform: process.platform,
    terminal,
    prompt,
    workspace,
    groq,
    shell,
    dialog,
  });
}
