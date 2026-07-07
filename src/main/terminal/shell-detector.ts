import { existsSync } from "fs";
import { execSync } from "child_process";
import { createLogger } from "../util/logger";
import type { ShellConfig } from "./terminal-types";

const logger = createLogger("ShellDetector");

export function detectShells(): ShellConfig[] {
  const shells =
    process.platform === "win32" ? detectWindowsShells() : detectPosixShells();
  logger.info(`Total shells detected: ${shells.length}`);
  return shells;
}

// ─── Windows ────────────────────────────────────────────────────────────────

function detectWindowsShells(): ShellConfig[] {
  const shells: ShellConfig[] = [];

  // 1. cmd.exe — always available on Windows
  const cmdPath = "C:\\Windows\\System32\\cmd.exe";
  if (existsSync(cmdPath)) {
    shells.push({
      id: "cmd",
      name: "Command Prompt",
      path: cmdPath,
      args: ["/K", "prompt $P$G"],
      icon: "terminal",
    });
    logger.info("Detected: Command Prompt");
  }

  // 2. Windows PowerShell (built-in)
  const winPowerShellPath =
    process.env.SystemRoot
      ? `${process.env.SystemRoot}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`
      : "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe";
  if (existsSync(winPowerShellPath)) {
    shells.push({
      id: "powershell",
      name: "Windows PowerShell",
      path: winPowerShellPath,
      args: ["-NoLogo", "-NoExit"],
      icon: "powershell",
    });
    logger.info("Detected: Windows PowerShell");
  }

  // 3. PowerShell 7 (pwsh.exe from PATH)
  const pwshPath = findInPath("pwsh.exe");
  if (pwshPath && existsSync(pwshPath)) {
    shells.push({
      id: "pwsh",
      name: "PowerShell 7",
      path: pwshPath,
      args: ["-NoLogo", "-NoExit"],
      icon: "pwsh",
    });
    logger.info("Detected: PowerShell 7");
  }

  // 4. Git Bash
  const gitBashPaths = [
    "C:\\Program Files\\Git\\bin\\bash.exe",
    "C:\\Program Files\\Git\\usr\\bin\\bash.exe",
    "C:\\Program Files (x86)\\Git\\bin\\bash.exe",
    "C:\\Program Files (x86)\\Git\\usr\\bin\\bash.exe",
  ];
  for (const gitBashPath of gitBashPaths) {
    if (existsSync(gitBashPath)) {
      shells.push({
        id: "gitbash",
        name: "Git Bash",
        path: gitBashPath,
        args: ["--login", "-i"],
        icon: "bash",
      });
      logger.info("Detected: Git Bash");
      break;
    }
  }

  // 5. WSL (wsl.exe from PATH)
  const wslPath = findInPath("wsl.exe");
  if (wslPath && existsSync(wslPath)) {
    shells.push({
      id: "wsl",
      name: "WSL",
      path: wslPath,
      args: [],
      icon: "linux",
    });
    logger.info("Detected: WSL");
  }

  return shells;
}

// ─── macOS / Linux ──────────────────────────────────────────────────────────

interface PosixShellCandidate {
  id: string;
  name: string;
  paths: string[];
  /**
   * Login + interactive so ~/.zshrc, ~/.bash_profile, /etc/profile etc. are
   * sourced. Without this, PATH entries added by nvm/brew/pyenv/etc. are
   * missing and the embedded terminal behaves differently from a normal
   * Terminal.app / iTerm session.
   */
  args: string[];
}

const POSIX_CANDIDATES: PosixShellCandidate[] = [
  {
    id: "zsh",
    name: "Zsh",
    paths: ["/bin/zsh", "/usr/bin/zsh", "/opt/homebrew/bin/zsh", "/usr/local/bin/zsh"],
    args: ["-il"],
  },
  {
    id: "bash",
    name: "Bash",
    paths: ["/bin/bash", "/usr/bin/bash", "/opt/homebrew/bin/bash", "/usr/local/bin/bash"],
    args: ["-il"],
  },
  {
    id: "fish",
    name: "Fish",
    paths: ["/opt/homebrew/bin/fish", "/usr/local/bin/fish", "/usr/bin/fish", "/bin/fish"],
    args: ["-il"],
  },
  {
    id: "sh",
    name: "sh (POSIX)",
    paths: ["/bin/sh"],
    args: ["-i"],
  },
];

function detectPosixShells(): ShellConfig[] {
  const shells: ShellConfig[] = [];
  const seenIds = new Set<string>();
  const seenPaths = new Set<string>();

  // 1. The user's actual login shell ($SHELL) first — this is what
  // Terminal.app / iTerm2 use by default, so it's the least surprising choice.
  const defaultShellPath = process.env.SHELL;
  if (defaultShellPath && existsSync(defaultShellPath)) {
    const known = POSIX_CANDIDATES.find((c) => c.paths.includes(defaultShellPath));
    const base = defaultShellPath.split("/").pop() || "shell";
    const id = known?.id ?? `default-${base}`;
    const name = known ? `${known.name} (Default)` : `${capitalize(base)} (Default)`;
    shells.push({
      id,
      name,
      path: defaultShellPath,
      args: known?.args ?? ["-il"],
      icon: known?.id ?? "terminal",
    });
    seenIds.add(id);
    seenPaths.add(defaultShellPath);
    logger.info(`Detected default shell ($SHELL): ${name} at ${defaultShellPath}`);
  }

  // 2. Well-known shells at common install locations.
  for (const candidate of POSIX_CANDIDATES) {
    if (seenIds.has(candidate.id)) continue;
    for (const p of candidate.paths) {
      if (seenPaths.has(p)) continue;
      if (existsSync(p)) {
        shells.push({
          id: candidate.id,
          name: candidate.name,
          path: p,
          args: candidate.args,
          icon: candidate.id,
        });
        seenIds.add(candidate.id);
        seenPaths.add(p);
        logger.info(`Detected: ${candidate.name} at ${p}`);
        break;
      }
    }
  }

  // 3. Fallback: resolve any remaining well-known shells via PATH (covers
  // installs outside the common locations above, e.g. asdf/mise shims).
  for (const candidate of POSIX_CANDIDATES) {
    if (seenIds.has(candidate.id)) continue;
    const resolved = findInPath(candidate.id);
    if (resolved && existsSync(resolved) && !seenPaths.has(resolved)) {
      shells.push({
        id: candidate.id,
        name: candidate.name,
        path: resolved,
        args: candidate.args,
        icon: candidate.id,
      });
      seenIds.add(candidate.id);
      seenPaths.add(resolved);
      logger.info(`Detected via PATH: ${candidate.name} at ${resolved}`);
    }
  }

  // Absolute last resort so the app is never left with zero shells.
  if (shells.length === 0) {
    shells.push({
      id: "sh",
      name: "sh (POSIX)",
      path: "/bin/sh",
      args: ["-i"],
      icon: "sh",
    });
    logger.warn("No shells detected via any method — falling back to /bin/sh");
  }

  return shells;
}

function capitalize(s: string): string {
  return s.length > 0 ? s[0].toUpperCase() + s.slice(1) : s;
}

// ─── Shared ─────────────────────────────────────────────────────────────────

function findInPath(executable: string): string | null {
  const isWindows = process.platform === "win32";
  try {
    const result = execSync(isWindows ? `where ${executable}` : `which ${executable}`, {
      encoding: "utf-8",
      windowsHide: true,
      timeout: 5000,
    });
    const lines = result.trim().split(/\r?\n/).filter(Boolean);
    if (lines.length > 0) {
      return lines[0].trim();
    }
  } catch {
    // Executable not found in PATH
  }
  return null;
}
