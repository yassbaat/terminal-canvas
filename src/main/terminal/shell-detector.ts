import { existsSync } from "fs";
import { execSync } from "child_process";
import { createLogger } from "../util/logger";
import type { ShellConfig } from "./terminal-types";

const logger = createLogger("ShellDetector");

export function detectShells(): ShellConfig[] {
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

  logger.info(`Total shells detected: ${shells.length}`);
  return shells;
}

function findInPath(executable: string): string | null {
  try {
    const result = execSync(`where ${executable}`, {
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
