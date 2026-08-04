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

/**
 * Project search. "name" matches path fragments (a quick-open), "content"
 * matches the text inside files (a grep). Both walk the same allowlisted
 * project roots -- see main/file/file-search.ts.
 */
export type FileSearchMode = "name" | "content";

export interface FileSearchHit {
  /** Absolute path of the matching file. */
  path: string;
  /** Path relative to the project root it was found under, for display. */
  relativePath: string;
  /** The project root this hit came from. */
  root: string;
  /** 1-based line number of the match. Content mode only. */
  line?: number;
  /** The matching line, trimmed and clipped around the match. Content mode only. */
  preview?: string;
  /** Start/end offsets of the match inside `preview`, for highlighting. */
  matchStart?: number;
  matchEnd?: number;
}

export interface FileSearchResult {
  hits: FileSearchHit[];
  /** True when the search stopped at a cap (result limit, file budget, deadline). */
  truncated: boolean;
  /** Number of project roots that were searched -- 0 means nothing is open. */
  rootCount: number;
  /**
   * Set when a newer search superseded this one. The caller should ignore the
   * result entirely rather than rendering an empty list.
   */
  superseded?: boolean;
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
