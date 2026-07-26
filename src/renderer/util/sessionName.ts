import type { TerminalSession } from "@renderer/type/terminal";
import { getBasename } from "@renderer/util/path";

/**
 * What to call a terminal, in one place.
 *
 * Precedence: a name the user typed always wins. Below that, when a coding
 * agent is running, the title *it* set beats anything we guessed -- Claude Code
 * and friends continuously retitle the terminal with what they're currently
 * doing, which is strictly better information than a name derived from the
 * folder or from the first command. Then our own auto-name, then the default.
 */
export function sessionDisplayName(session: TerminalSession): string {
  const agentTitle = usableAgentTitle(session);
  return session.manualName || agentTitle || session.autoName || session.name;
}

/** True when the name shown comes from the agent rather than from us. */
export function hasAgentTitle(session: TerminalSession): boolean {
  return !session.manualName && usableAgentTitle(session) !== null;
}

const MAX_TITLE_LENGTH = 60;

/**
 * Shells set the window title too, and theirs is noise: zsh's default is
 * `user@host:cwd`, and plenty of setups emit just the path. Those tell us
 * nothing the header doesn't already show, so only titles that survive this
 * filter get used.
 */
function usableAgentTitle(session: TerminalSession): string | null {
  // Only trust the title while an agent is actually running -- outside that,
  // whatever is in there came from the shell or from a random program.
  if (!session.activeAgent) return null;

  const raw = session.oscTitle?.trim();
  if (!raw) return null;

  // user@host or user@host:/some/path -- the classic shell default.
  if (/^[\w.-]+@[\w.-]+(?::|$|\s)/.test(raw)) return null;

  // A bare path, or one with a leading ~. Includes the exact-cwd case.
  if (/^(~|\/|[A-Za-z]:\\)/.test(raw)) return null;

  // The folder name on its own is what our own auto-naming already uses.
  if (raw === getBasename(session.cwd) || raw === session.projectName) return null;

  return raw.length > MAX_TITLE_LENGTH ? `${raw.slice(0, MAX_TITLE_LENGTH - 1)}…` : raw;
}
