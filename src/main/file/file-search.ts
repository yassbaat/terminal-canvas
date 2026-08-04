import { promises as fsp } from "fs";
import path from "path";
import { listRoots, looksBinary } from "../util/path-guard";
import { DEFAULT_HIDDEN, BINARY_EXTENSIONS } from "./ignore";
import { createLogger } from "../util/logger";
import type { FileSearchHit, FileSearchMode, FileSearchResult } from "@renderer/type/file";

const logger = createLogger("FileSearch");

/**
 * Project-wide search over the folders the workspace currently has open --
 * find a file by name, or a line of code by its text.
 *
 * Scope is the path guard's allowlist, not an arbitrary path: search reaches
 * exactly the project folders live terminals registered, which is the same set
 * the file explorer can already show. The renderer supplies a query, never a
 * directory, so there is nothing here for it to point somewhere it shouldn't.
 *
 * This runs on the main process's event loop -- the same loop that forwards
 * every PTY's output to the renderer. A walk that starves it would stall every
 * terminal in the workspace mid-agent-run, so the budget below is deliberately
 * conservative and enforced three ways: a wall-clock deadline, hard file caps,
 * and a generation counter that abandons a walk the moment a newer keystroke
 * starts one. Every file is an await point, so control returns to the loop
 * constantly rather than in batches.
 */

/** How long a single search may run before it reports back with what it has. */
const DEADLINE_MS = 2500;
/** Directory entries visited before giving up on completeness. */
const MAX_ENTRIES_SCANNED = 40000;
/** Files actually opened and read in content mode. */
const MAX_FILES_READ = 4000;
/** Files bigger than this are skipped by content search (minified bundles, logs). */
const MAX_FILE_BYTES = 512 * 1024;
/** Matches reported per file, so one dense file can't fill the whole result list. */
const MAX_HITS_PER_FILE = 5;
/** Longest preview line handed to the renderer. */
const PREVIEW_MAX = 200;

const DEFAULT_LIMIT = 200;

/**
 * Bumped by every incoming search. A walk whose generation is stale abandons
 * itself at its next await, so typing quickly can't pile up overlapping walks.
 */
let generation = 0;

interface Budget {
  deadline: number;
  entriesScanned: number;
  filesRead: number;
  myGeneration: number;
  truncated: boolean;
}

function outOfBudget(budget: Budget): boolean {
  if (budget.entriesScanned >= MAX_ENTRIES_SCANNED) return true;
  if (Date.now() > budget.deadline) return true;
  return false;
}

/**
 * Drop roots contained in another root. Two terminals open at `/repo` and
 * `/repo/packages/app` register both; walking each separately would report the
 * nested one's files twice, under two different relative paths.
 */
function topLevelRoots(): string[] {
  const roots = [...new Set(listRoots())].sort((a, b) => a.length - b.length);
  const kept: string[] = [];
  for (const root of roots) {
    const nested = kept.some((k) => {
      const rel = path.relative(k, root);
      return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
    });
    if (!nested) kept.push(root);
  }
  return kept;
}

/**
 * Case-insensitive subsequence test -- what makes "wsc" find
 * "WorkspaceCanvas.vue". Only used as a fallback after substring matching, so
 * exact fragments still rank first.
 */
function isSubsequence(needle: string, haystack: string): boolean {
  let i = 0;
  for (let j = 0; j < haystack.length && i < needle.length; j++) {
    if (haystack[j] === needle[i]) i++;
  }
  return i === needle.length;
}

interface ScoredHit extends FileSearchHit {
  score: number;
}

function scoreName(query: string, relativePath: string): number | null {
  const rel = relativePath.toLowerCase();
  const base = path.basename(rel);

  const baseIndex = base.indexOf(query);
  if (baseIndex === 0) return 0;
  if (baseIndex > 0) return 1;
  if (rel.includes(query)) return 2;
  if (isSubsequence(query, base)) return 3;
  if (isSubsequence(query, rel)) return 4;
  return null;
}

/**
 * Clip a matching line down to something that fits a result row, keeping the
 * match itself visible, and report where it landed so the UI can highlight it.
 */
function buildPreview(
  line: string,
  matchIndex: number,
  queryLength: number
): { preview: string; matchStart: number; matchEnd: number } {
  // Leading indentation is never what you're reading in a result list.
  const leading = line.length - line.trimStart().length;
  let start = leading;
  let text = line.slice(start);
  let index = matchIndex - start;

  if (text.length > PREVIEW_MAX) {
    // Keep the match roughly a third of the way in so there's context on both
    // sides of it.
    const window = Math.max(0, index - Math.floor(PREVIEW_MAX / 3));
    text = text.slice(window, window + PREVIEW_MAX);
    index -= window;
    if (window > 0) {
      text = `…${text}`;
      index += 1;
    }
  }

  return {
    preview: text.replace(/\s+$/, ""),
    matchStart: Math.max(0, index),
    matchEnd: Math.max(0, index) + queryLength,
  };
}

async function searchFileContent(
  filePath: string,
  relativePath: string,
  root: string,
  query: string,
  hits: ScoredHit[],
  limit: number,
  budget: Budget
): Promise<void> {
  if (BINARY_EXTENSIONS.has(path.extname(filePath).toLowerCase())) return;

  let size = 0;
  try {
    const st = await fsp.stat(filePath);
    if (!st.isFile()) return;
    size = st.size;
  } catch {
    return; // Vanished mid-walk, or unreadable -- neither is worth reporting.
  }
  if (size === 0 || size > MAX_FILE_BYTES) {
    if (size > MAX_FILE_BYTES) budget.truncated = true;
    return;
  }

  budget.filesRead += 1;

  let buf: Buffer;
  try {
    buf = await fsp.readFile(filePath);
  } catch {
    return;
  }
  if (looksBinary(buf)) return;

  const lines = buf.toString("utf8").split("\n");
  let found = 0;
  for (let i = 0; i < lines.length; i++) {
    const index = lines[i].toLowerCase().indexOf(query);
    if (index === -1) continue;

    const { preview, matchStart, matchEnd } = buildPreview(lines[i], index, query.length);
    hits.push({
      path: filePath,
      relativePath,
      root,
      line: i + 1,
      preview,
      matchStart,
      matchEnd,
      score: 0,
    });

    found += 1;
    if (found >= MAX_HITS_PER_FILE) {
      budget.truncated = true;
      break;
    }
    if (hits.length >= limit) return;
  }
}

async function walkRoot(
  root: string,
  query: string,
  mode: FileSearchMode,
  hits: ScoredHit[],
  limit: number,
  budget: Budget
): Promise<void> {
  const queue: string[] = [root];

  while (queue.length > 0) {
    if (generation !== budget.myGeneration) return;
    if (hits.length >= limit || outOfBudget(budget)) {
      budget.truncated = true;
      return;
    }
    if (mode === "content" && budget.filesRead >= MAX_FILES_READ) {
      budget.truncated = true;
      return;
    }

    const dir = queue.shift() as string;
    let entries;
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      continue; // Permission denied or removed mid-walk; the rest still works.
    }

    for (const entry of entries) {
      if (generation !== budget.myGeneration) return;
      if (DEFAULT_HIDDEN.has(entry.name)) continue;

      budget.entriesScanned += 1;
      const full = path.join(dir, entry.name);

      // Never follow symlinked directories: a link back up the tree turns the
      // walk into an infinite one, and the target may sit outside the root.
      if (entry.isSymbolicLink()) continue;

      if (entry.isDirectory()) {
        queue.push(full);
        continue;
      }
      if (!entry.isFile()) continue;

      const relativePath = path.relative(root, full);

      if (mode === "name") {
        const score = scoreName(query, relativePath);
        if (score !== null) {
          hits.push({ path: full, relativePath, root, score });
          if (hits.length >= limit) {
            budget.truncated = true;
            return;
          }
        }
      } else {
        await searchFileContent(full, relativePath, root, query, hits, limit, budget);
        if (hits.length >= limit) {
          budget.truncated = true;
          return;
        }
        if (budget.filesRead >= MAX_FILES_READ || outOfBudget(budget)) {
          budget.truncated = true;
          return;
        }
      }
    }
  }
}

export async function searchProject(options: {
  query: unknown;
  mode: unknown;
  limit?: unknown;
}): Promise<FileSearchResult> {
  const query = typeof options.query === "string" ? options.query.trim().toLowerCase() : "";
  const mode: FileSearchMode = options.mode === "content" ? "content" : "name";
  const limit =
    typeof options.limit === "number" && options.limit > 0
      ? Math.min(500, Math.floor(options.limit))
      : DEFAULT_LIMIT;

  const myGeneration = ++generation;
  const roots = topLevelRoots();

  // One character of content search matches essentially every file in the
  // project -- all cost, no signal. Names are cheap enough to match on one.
  const minLength = mode === "content" ? 2 : 1;
  if (query.length < minLength || roots.length === 0) {
    return { hits: [], truncated: false, rootCount: roots.length };
  }

  const budget: Budget = {
    deadline: Date.now() + DEADLINE_MS,
    entriesScanned: 0,
    filesRead: 0,
    myGeneration,
    truncated: false,
  };

  const hits: ScoredHit[] = [];
  const started = Date.now();

  for (const root of roots) {
    await walkRoot(root, query, mode, hits, limit, budget);
    if (generation !== myGeneration) return { hits: [], truncated: false, rootCount: roots.length, superseded: true };
    if (hits.length >= limit || outOfBudget(budget)) break;
  }

  if (generation !== myGeneration) {
    return { hits: [], truncated: false, rootCount: roots.length, superseded: true };
  }

  if (mode === "name") {
    hits.sort((a, b) => a.score - b.score || a.relativePath.length - b.relativePath.length);
  }

  logger.debug(
    `search "${query}" (${mode}) -> ${hits.length} hit(s) in ${Date.now() - started}ms ` +
      `across ${roots.length} root(s)`
  );

  return {
    hits: hits.slice(0, limit).map(({ score: _score, ...hit }) => hit),
    truncated: budget.truncated,
    rootCount: roots.length,
  };
}
