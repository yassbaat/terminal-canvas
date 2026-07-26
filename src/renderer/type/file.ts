/**
 * Shared filesystem types. Lives under renderer/type/ like the other domain
 * types -- the preload imports from here too (see preload/api-types.ts), so this
 * is the single definition both sides agree on.
 */

export interface DirEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  isSymlink: boolean;
  size: number;
  mtimeMs: number;
}

export interface ReadFileResult {
  path: string;
  content: string;
  size: number;
  mtimeMs: number;
  /** True when the file exceeded the read cap; `content` holds the leading slice. */
  truncated: boolean;
  /** True when the file looks like binary; `content` is empty in that case. */
  binary: boolean;
}

export interface WriteFileResult {
  ok: boolean;
  mtimeMs: number;
  /**
   * True when the file on disk had changed since the mtime the caller expected,
   * so nothing was written. `actualMtimeMs` is what's currently on disk. The
   * caller decides whether to reload, force, or diff.
   */
  conflict?: boolean;
  actualMtimeMs?: number;
}

export interface FileStatResult {
  path: string;
  exists: boolean;
  isDirectory: boolean;
  size: number;
  mtimeMs: number;
}

export type WatchKind = "file" | "directory";

export interface FileChangedEvent {
  watchId: string;
  path: string;
  kind: WatchKind;
}

/** A file open as a tab inside a terminal node, or as a detached canvas node. */
export interface OpenFileState {
  path: string;
  /** Last content read from (or written to) disk. */
  content: string;
  /** Current editor content; differs from `content` while dirty. */
  draft: string;
  mtimeMs: number;
  truncated: boolean;
  binary: boolean;
  loading: boolean;
  error: string | null;
  /**
   * Set when the file changed on disk while the buffer was dirty. The editor
   * shows a banner rather than clobbering either side.
   */
  externalChange: boolean;
  watchId: string | null;
}
