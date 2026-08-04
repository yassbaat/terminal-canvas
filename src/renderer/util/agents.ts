import type { Component } from "vue";
import { Wrench } from "lucide-vue-next";
import {
  ClaudeMark,
  OpenAIMark,
  GeminiMark,
  KimiMark,
  CursorMark,
  CopilotMark,
} from "@renderer/component/icon/brand-icons";

export type KnownAgentId =
  | "claude"
  | "codex"
  | "kimi"
  | "gemini"
  | "aider"
  | "cursor-agent"
  | "copilot";

export interface AgentMeta {
  label: string;
  /** The provider's own mark, so a running agent is identifiable at a glance
   * rather than by a stand-in glyph (see component/icon/brand-icons). Aider
   * has no published mark in that set and keeps a neutral Lucide icon. */
  icon: Component;
  color: string;
  /**
   * Offered as a one-click choice in the New Terminal dialog. The rest stay
   * fully supported -- recognized from a typed command, badged, relaunched on
   * workspace restore, listed in Settings -- they just don't crowd the
   * create-a-terminal path.
   */
  featured: boolean;
}

/**
 * Known coding-agent CLIs we can recognize from the command a user types.
 * Declaration order is the order the featured ones are offered in.
 */
export const AGENT_META: Record<KnownAgentId, AgentMeta> = {
  claude: { label: "Claude Code", icon: ClaudeMark, color: "#d97757", featured: true },
  codex: { label: "Codex", icon: OpenAIMark, color: "#10a37f", featured: true },
  kimi: { label: "Kimi", icon: KimiMark, color: "#7c6cf0", featured: true },
  gemini: { label: "Gemini", icon: GeminiMark, color: "#4a90e2", featured: false },
  aider: { label: "Aider", icon: Wrench, color: "#f2994a", featured: false },
  "cursor-agent": { label: "Cursor", icon: CursorMark, color: "#8a8aa0", featured: false },
  copilot: { label: "Copilot", icon: CopilotMark, color: "#3fb950", featured: false },
};

// Matches the first "word" of a typed command, stripped of a few common
// wrappers (sudo, env, a leading path) so `./bin/claude`, `sudo kimi`, and
// plain `claude` all resolve to the same launcher token.
function firstCommandToken(text: string): string {
  let t = text.trim();
  t = t.replace(/^(sudo|env)\s+/i, "");
  const firstWord = t.split(/\s+/)[0] || "";
  const base = firstWord.split(/[\\/]/).pop() || firstWord;
  return base.toLowerCase();
}

const AGENT_LAUNCH_TOKENS: Record<string, KnownAgentId> = {
  claude: "claude",
  codex: "codex",
  kimi: "kimi",
  gemini: "gemini",
  aider: "aider",
  cursor: "cursor-agent",
  "cursor-agent": "cursor-agent",
  copilot: "copilot",
  "gh-copilot": "copilot",
};

const EXIT_TOKENS = new Set(["exit", "quit", "logout"]);

/**
 * Command used to bring an agent back when restoring a saved workspace. A live
 * agent process can't be serialized, so restore re-launches the CLI instead --
 * using each agent's own "pick up where you left off" flag where one exists
 * (both claude and codex key resumption off the terminal's cwd, which restore
 * preserves). Agents without a resume flag just relaunch fresh.
 */
export const AGENT_RELAUNCH_COMMANDS: Record<KnownAgentId, string> = {
  claude: "claude --continue",
  codex: "codex resume --last",
  kimi: "kimi",
  gemini: "gemini",
  aider: "aider",
  "cursor-agent": "cursor-agent",
  copilot: "copilot",
};

export type AgentDetection =
  | { action: "start"; agent: KnownAgentId }
  | { action: "stop" }
  | { action: "none" };

/**
 * Best-effort, agent-agnostic heuristic for "what coding-agent CLI (if any)
 * is now running in the foreground of this terminal". Mirrors the same
 * spirit as idle/attention detection: we don't hook into the process itself,
 * we just read what the user typed at the shell.
 *
 * Deliberately sticky: an unrecognized command (e.g. a message typed inside
 * the agent's own interactive prompt) does not clear the active agent, since
 * we can't distinguish "typed to the outer shell" from "typed to the agent's
 * REPL" from the command text alone. Only an explicit exit/quit, launching a
 * different known agent, or the process actually exiting clears it.
 */
export function detectAgentFromCommand(text: string): AgentDetection {
  const token = firstCommandToken(text);
  if (!token) return { action: "none" };

  const agent = AGENT_LAUNCH_TOKENS[token];
  if (agent) return { action: "start", agent };

  if (EXIT_TOKENS.has(token)) return { action: "stop" };

  return { action: "none" };
}
