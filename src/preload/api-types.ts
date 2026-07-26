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
  TerminalTitleEvent,
} from "@renderer/type/terminal";
import type { PromptEntry, CreatePromptOptions } from "@renderer/type/prompt";
import type { Workspace, WorkspaceSummary, SaveWorkspaceOptions } from "@renderer/type/workspace";
import type { GeneratedName, GroqSettings, NamingContext, GroupNamingContext } from "@renderer/type/groq";
import type {
  DirEntry,
  ReadFileResult,
  WriteFileResult,
  FileStatResult,
  FileChangedEvent,
  WatchKind,
} from "@renderer/type/file";

export interface TerminalAPI {
  create(options: CreateTerminalOptions): Promise<TerminalSession>;
  write(terminalId: string, data: string): Promise<void>;
  resize(terminalId: string, cols: number, rows: number): Promise<void>;
  kill(terminalId: string): Promise<void>;
  restart(terminalId: string): Promise<TerminalSession>;
  clear(terminalId: string): Promise<void>;
  listShells(): Promise<ShellInfo[]>;
  openCwdInExplorer(terminalId: string): Promise<void>;
  /** Recent raw output for this terminal, for replaying into a fresh xterm. */
  getBuffer(terminalId: string): Promise<string>;
  setIdleThreshold(ms: number): Promise<void>;
  setIdleDetectionEnabled(terminalId: string, enabled: boolean): Promise<void>;
  /** Pin the file explorer to a folder, and grant the renderer access to that tree. */
  setFileRoot(terminalId: string, dir: string): Promise<void>;
  onData(callback: (event: TerminalDataEvent) => void): () => void;
  onExit(callback: (event: TerminalExitEvent) => void): () => void;
  onCwdChanged(callback: (event: TerminalCwdEvent) => void): () => void;
  onRenamed(callback: (event: TerminalRenamedEvent) => void): () => void;
  onAttention(callback: (event: TerminalAttentionEvent) => void): () => void;
  onReady(callback: (event: TerminalReadyEvent) => void): () => void;
  /** The running program set a new window title (OSC 0/1/2). */
  onTitle(callback: (event: TerminalTitleEvent) => void): () => void;
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
  /** Condense a long command/prompt into a short one-line summary for tooltips. */
  summarizeCommand(text: string): Promise<string>;
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

/**
 * Filesystem access. Every path here is checked against an allowlist in main
 * (util/path-guard) built from live terminals' project folders plus anything the
 * user picked in a native dialog -- the renderer cannot reach outside it, and
 * cannot widen it except via `addRoot` with a path a dialog just returned.
 */
export interface FileAPI {
  listDir(path: string, showHidden?: boolean): Promise<DirEntry[]>;
  read(path: string): Promise<ReadFileResult>;
  /**
   * Write `content`, but only if the file's mtime still matches
   * `expectedMtimeMs`. A mismatch resolves with `{ conflict: true }` and writes
   * nothing -- an agent rewriting the file mid-edit is the normal case here.
   */
  write(path: string, content: string, expectedMtimeMs?: number): Promise<WriteFileResult>;
  stat(path: string): Promise<FileStatResult>;
  /** Returns a watch id, or null if the path couldn't be watched. */
  watch(path: string, kind: WatchKind): Promise<string | null>;
  unwatch(watchId: string): Promise<void>;
  createFile(path: string): Promise<string>;
  createDirectory(path: string): Promise<string>;
  rename(from: string, to: string): Promise<string>;
  /** Moves to the OS trash, never an unlink. */
  trash(path: string): Promise<void>;
  reveal(path: string): Promise<void>;
  /** Grant access to a folder the user just picked. Returns the granted directory. */
  addRoot(path: string): Promise<string>;
  listRoots(): Promise<string[]>;
  homeDir(): Promise<string>;
  onChanged(callback: (event: FileChangedEvent) => void): () => void;
}

export interface PreloadAPI {
  platform: NodeJS.Platform;
  terminal: TerminalAPI;
  prompt: PromptAPI;
  workspace: WorkspaceAPI;
  groq: GroqAPI;
  shell: ShellAPI;
  dialog: DialogAPI;
  file: FileAPI;
}

declare global {
  interface Window {
    api: PreloadAPI;
  }
}
