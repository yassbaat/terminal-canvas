import { Sparkles, Cpu, Moon, Gem, Wrench, MousePointer2, Github, type LucideIcon } from "lucide-vue-next";

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
  /** Vue icon component (not a trademarked logo image) -- enough to give
   * each agent a distinct, glanceable identity without bundling
   * third-party brand assets. */
  icon: LucideIcon;
  color: string;
}

/**
 * Known coding-agent CLIs we can recognize from the command a user types.
 */
export const AGENT_META: Record<KnownAgentId, AgentMeta> = {
  claude: { label: "Claude Code", icon: Sparkles, color: "#d97757" },
  codex: { label: "Codex", icon: Cpu, color: "#10a37f" },
  kimi: { label: "Kimi", icon: Moon, color: "#7c6cf0" },
  gemini: { label: "Gemini", icon: Gem, color: "#4a90e2" },
  aider: { label: "Aider", icon: Wrench, color: "#f2994a" },
  "cursor-agent": { label: "Cursor", icon: MousePointer2, color: "#6e6e6e" },
  copilot: { label: "Copilot", icon: Github, color: "#3fb950" },
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
