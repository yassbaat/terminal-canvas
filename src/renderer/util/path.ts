export function getBasename(filepath: string): string {
  const parts = filepath.replace(/\\/g, "/").split("/");
  return parts[parts.length - 1] || "";
}

export function getDirname(filepath: string): string {
  const normalized = filepath.replace(/\\/g, "/");
  const idx = normalized.lastIndexOf("/");
  return idx >= 0 ? normalized.slice(0, idx) : ".";
}

export function shortenCwd(cwd: string, maxLen = 35): string {
  if (cwd.length <= maxLen) return cwd;
  const parts = cwd.replace(/\\/g, "/").split("/");
  if (parts.length <= 3) return cwd;
  return ".../" + parts.slice(-2).join("/");
}

export function getProjectName(cwd: string): string | null {
  const basename = getBasename(cwd);
  if (!basename || basename === "/" || basename === "." || basename.match(/^[A-Z]:$/)) {
    return null;
  }
  return basename;
}

export function getRelativePath(from: string, to: string): string {
  const f = from.replace(/\\/g, "/").replace(/\/$/, "");
  const t = to.replace(/\\/g, "/").replace(/\/$/, "");
  if (t.startsWith(f + "/")) {
    return t.slice(f.length + 1);
  }
  return to;
}
