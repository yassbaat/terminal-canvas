/**
 * Directories the file explorer and project search both skip.
 *
 * These are the ones that make a tree unusable rather than merely noisy --
 * .git has tens of thousands of objects, node_modules more. Shared between the
 * explorer (file-ipc) and search (file-search) on purpose: a search that walks
 * into folders the tree refuses to show would return results you can't get back
 * to, and two copies of this list would drift apart the first time one is
 * edited.
 */
export const DEFAULT_HIDDEN = new Set([
  ".git",
  "node_modules",
  ".DS_Store",
  "__pycache__",
  ".next",
  ".nuxt",
  ".turbo",
  ".venv",
  "venv",
]);

/**
 * Extensions never worth opening for a text search. The NUL-byte sniff catches
 * binaries properly; this just avoids reading megabytes of image and archive
 * data to reach that conclusion.
 */
export const BINARY_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".ico", ".icns", ".tiff",
  ".pdf", ".zip", ".gz", ".tgz", ".bz2", ".xz", ".7z", ".rar", ".jar",
  ".mp3", ".mp4", ".m4a", ".mov", ".avi", ".mkv", ".wav", ".flac", ".ogg",
  ".woff", ".woff2", ".ttf", ".otf", ".eot",
  ".exe", ".dll", ".dylib", ".so", ".a", ".o", ".class", ".wasm",
  ".sqlite", ".db", ".bin", ".dat", ".pack", ".idx", ".node",
]);
