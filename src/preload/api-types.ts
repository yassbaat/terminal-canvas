import type {
  TerminalSession,
  ShellInfo,
  CreateTerminalOptions,
  TerminalDataEvent,
  TerminalExitEvent,
  TerminalCwdEvent,
  TerminalRenamedEvent,
  TerminalAttentionEvent,
  TerminalReadyEvent,
} from "@renderer/type/terminal";
import type { PromptEntry, CreatePromptOptions } from "@renderer/type/prompt";
import type { Workspace, WorkspaceSummary, SaveWorkspaceOptions } from "@renderer/type/workspace";
import type { GeneratedName, GroqSettings, NamingContext, GroupNamingContext } from "@renderer/type/groq";

export interface TerminalAPI {
  create(options: CreateTerminalOptions): Promise<TerminalSession>;
  write(terminalId: string, data: string): Promise<void>;
  resize(terminalId: string, cols: number, rows: number): Promise<void>;
  kill(terminalId: string): Promise<void>;
  restart(terminalId: string): Promise<TerminalSession>;
  clear(terminalId: string): Promise<void>;
  listShells(): Promise<ShellInfo[]>;
  openCwdInExplorer(terminalId: string): Promise<void>;
  setIdleThreshold(ms: number): Promise<void>;
  setIdleDetectionEnabled(terminalId: string, enabled: boolean): Promise<void>;
  onData(callback: (event: TerminalDataEvent) => void): () => void;
  onExit(callback: (event: TerminalExitEvent) => void): () => void;
  onCwdChanged(callback: (event: TerminalCwdEvent) => void): () => void;
  onRenamed(callback: (event: TerminalRenamedEvent) => void): () => void;
  onAttention(callback: (event: TerminalAttentionEvent) => void): () => void;
  onReady(callback: (event: TerminalReadyEvent) => void): () => void;
}

export interface PromptAPI {
  add(options: CreatePromptOptions): Promise<PromptEntry>;
  list(terminalId: string): Promise<PromptEntry[]>;
  delete(promptId: string): Promise<void>;
  pin(promptId: string): Promise<PromptEntry>;
  resend(promptId: string, targetTerminalId?: string): Promise<void>;
  clearForTerminal(terminalId: string): Promise<void>;
  onAdd(callback: (entry: PromptEntry) => void): () => void;
}

export interface WorkspaceAPI {
  save(options: SaveWorkspaceOptions): Promise<void>;
  load(workspaceId: string): Promise<Workspace>;
  list(): Promise<WorkspaceSummary[]>;
  delete(workspaceId: string): Promise<void>;
  rename(workspaceId: string, name: string): Promise<void>;
  updateViewport(x: number, y: number, zoom: number): Promise<void>;
}

export interface GroqAPI {
  generateTerminalName(terminalId: string, context: NamingContext): Promise<GeneratedName>;
  generateGroupName(context: GroupNamingContext): Promise<GeneratedName>;
  renameTerminal(terminalId: string): Promise<void>;
  getSettings(): Promise<GroqSettings>;
  updateSettings(settings: GroqSettings): Promise<void>;
  testConnection(): Promise<{ success: boolean; message: string }>;
}

export interface ShellAPI {
  registerContextMenu(): Promise<{ success: boolean; error?: string }>;
  unregisterContextMenu(): Promise<{ success: boolean; error?: string }>;
  isContextMenuRegistered(): Promise<boolean>;
  onOpenDir(callback: (dir: string) => void): () => void;
  rendererReady(): void;
}

export interface DialogAPI {
  showOpenDialog(options: {
    title?: string;
    defaultPath?: string;
    buttonLabel?: string;
    properties?: Array<"openFile" | "openDirectory" | "multiSelections">;
  }): Promise<{ canceled: boolean; filePaths: string[] }>;
}

export interface PreloadAPI {
  platform: NodeJS.Platform;
  terminal: TerminalAPI;
  prompt: PromptAPI;
  workspace: WorkspaceAPI;
  groq: GroqAPI;
  shell: ShellAPI;
  dialog: DialogAPI;
}

declare global {
  interface Window {
    api: PreloadAPI;
  }
}
