import fs from "fs";
import os from "os";
import path from "path";

/**
 * Repo-root resolution.
 *
 * A terminal's cwd is wherever the user happens to have `cd`'d to; the folder a
 * file explorer should be rooted at is the *project*. Walking up to the nearest
 * `.git` gets us that in the overwhelmingly common case, and gives the rewind
 * feature (Phase 2) the tree it needs to checkpoint.
 *
 * Note `.git` is checked with a plain existsSync rather than a directory test:
 * in a linked worktree or a submodule `.git` is a *file* containing a gitdir
 * pointer, and those are still repo roots.
 */

// Resolution is on the hot path (every cwd change on every terminal) and the
// answer for a given directory effectively never changes, so memoize it. Bounded
// because a long session can `cd` through a lot of directories.
const cache = new Map<string, string | null>();
const CACHE_LIMIT = 500;

function remember(key: string, value: string | null): string | null {
  if (cache.size >= CACHE_LIMIT) {
    // Cheapest possible eviction: drop the oldest insertion. The cache is a
    // pure optimization, so a wrong eviction only costs one extra walk.
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, value);
  return value;
}

/**
 * Nearest ancestor of `startDir` (inclusive) containing a `.git` entry, or null
 * if there isn't one below the stop boundary.
 *
 * The walk stops at the filesystem root *and* at the user's home directory.
 * Stopping at home matters: some people have `~/.git` (dotfile repos tracked in
 * place), and without the boundary every terminal in the home tree would report
 * the entire home directory as its project and root a file explorer there.
 */
export function findRepoRoot(startDir: string): string | null {
  if (!startDir) return null;

  const cached = cache.get(startDir);
  if (cached !== undefined) return cached;

  let dir: string;
  try {
    dir = path.resolve(startDir);
  } catch {
    return remember(startDir, null);
  }

  const home = os.homedir();
  const visited: string[] = [];

  // Bounded so a pathological path can never spin here.
  for (let depth = 0; depth < 64; depth++) {
    visited.push(dir);

    try {
      if (fs.existsSync(path.join(dir, ".git"))) {
        for (const seen of visited) remember(seen, dir);
        return dir;
      }
    } catch {
      // Unreadable directory (permissions) -- treat as "no repo here" and
      // keep walking up rather than failing the whole resolution.
    }

    if (dir === home) break;

    const parent = path.dirname(dir);
    if (parent === dir) break; // filesystem root
    dir = parent;
  }

  for (const seen of visited) remember(seen, null);
  return null;
}

/**
 * The folder a terminal's file explorer should be rooted at: the enclosing repo
 * when there is one, otherwise the cwd itself. Callers may override this per
 * terminal (the drawer's "Open folder…"), which is why this is only the default.
 */
export function resolveFileRoot(cwd: string): string {
  return findRepoRoot(cwd) ?? cwd;
}

/** Drop memoized answers. Used when a directory is created/renamed under us. */
export function clearRepoRootCache(): void {
  cache.clear();
}
