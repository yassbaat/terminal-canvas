import { promises as fsp } from "fs";
import path from "path";

/**
 * Path guard for the filesystem IPC surface.
 *
 * The renderer runs with contextIsolation on and no node integration, so until
 * now it had no filesystem reach at all. file-ipc deliberately hands it read,
 * write and delete -- which means the renderer (and anything that manages to
 * run inside it) can name an arbitrary path. Every fs channel therefore routes
 * its path through here first.
 *
 * The model is an allowlist of roots, not a denylist of bad paths:
 *   - each live terminal registers the folder its file explorer is rooted at
 *   - anything the user explicitly picks in a native open dialog is added
 * Nothing else is reachable. Roots are registered by main-process code only;
 * the renderer can never widen the allowlist by asking.
 *
 * Containment is checked against the *realpath*, which is the part that
 * actually matters: `<allowedRoot>/link -> /` passes a naive prefix test and
 * fails this one.
 */

/** Refcounted so two terminals in the same repo don't unregister each other's root. */
const roots = new Map<string, number>();

/** Max bytes we'll read as text. Bigger files are reported truncated, not streamed. */
export const MAX_READ_BYTES = 2 * 1024 * 1024;

/** How much of a file to sniff for NUL bytes when deciding "is this binary". */
const BINARY_SNIFF_BYTES = 8192;

export class PathAccessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PathAccessError";
  }
}

function normalizeRoot(p: string): string | null {
  if (!p) return null;
  try {
    return path.resolve(p);
  } catch {
    return null;
  }
}

/** Grant access to a directory tree. Returns a disposer, or null if `dir` was unusable. */
export function registerRoot(dir: string): (() => void) | null {
  const key = normalizeRoot(dir);
  if (!key) return null;
  roots.set(key, (roots.get(key) ?? 0) + 1);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    unregisterRoot(key);
  };
}

export function unregisterRoot(dir: string): void {
  const key = normalizeRoot(dir);
  if (!key) return;
  const count = roots.get(key);
  if (count === undefined) return;
  if (count <= 1) roots.delete(key);
  else roots.set(key, count - 1);
}

export function listRoots(): string[] {
  return [...roots.keys()];
}

/**
 * True when `child` is `parent` or sits underneath it. Compares path segments
 * rather than raw strings so `/a/bcd` is not treated as living inside `/a/bc`.
 */
function isInside(parent: string, child: string): boolean {
  if (child === parent) return true;
  const rel = path.relative(parent, child);
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}

/**
 * Resolve `p` through symlinks as far as it exists. A path being created (a new
 * file, a rename target) has no realpath yet, so resolve the deepest existing
 * ancestor and re-attach the remainder -- that still catches a symlinked parent
 * pointing outside the allowlist, which is the escape we care about.
 */
async function realpathBestEffort(p: string): Promise<string> {
  let current = path.resolve(p);
  const trailing: string[] = [];

  for (let depth = 0; depth < 64; depth++) {
    try {
      const real = await fsp.realpath(current);
      return trailing.length ? path.join(real, ...trailing.reverse()) : real;
    } catch {
      const parent = path.dirname(current);
      if (parent === current) return path.resolve(p); // nothing on this path exists
      trailing.push(path.basename(current));
      current = parent;
    }
  }
  return path.resolve(p);
}

/**
 * Validate a renderer-supplied path and return the canonical form to actually
 * use. Throws PathAccessError when the path escapes every allowed root -- IPC
 * handlers let that propagate so the renderer sees a rejected promise.
 */
export async function assertAllowed(p: unknown): Promise<string> {
  if (typeof p !== "string" || p.trim() === "") {
    throw new PathAccessError("A path is required");
  }
  if (p.includes("\0")) {
    throw new PathAccessError("Invalid path");
  }

  const resolved = path.resolve(p);
  const real = await realpathBestEffort(resolved);

  for (const root of roots.keys()) {
    // Check both forms: `resolved` catches the common case cheaply, `real`
    // is what closes the symlink hole.
    if (isInside(root, resolved) && isInside(root, real)) return real;
    // A root may itself be a symlink (/tmp -> /private/tmp on macOS), in which
    // case the child's realpath won't sit under the root's literal path.
    try {
      const realRoot = await fsp.realpath(root);
      if (isInside(realRoot, real)) return real;
    } catch {
      // Root no longer exists; skip it.
    }
  }

  throw new PathAccessError(`Access denied: ${p} is outside the allowed folders`);
}

/**
 * Heuristic "is this a text file we can show". A NUL byte in the first few KB
 * is the same test `grep` uses and it is right nearly always -- and being wrong
 * costs a "can't preview this" message rather than a corrupt editor buffer.
 */
export function looksBinary(buf: Buffer): boolean {
  const len = Math.min(buf.length, BINARY_SNIFF_BYTES);
  for (let i = 0; i < len; i++) {
    if (buf[i] === 0) return true;
  }
  return false;
}
