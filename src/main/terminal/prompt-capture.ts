import { createLogger } from "../util/logger";
import type { PromptKind } from "@renderer/type/prompt";

const logger = createLogger("PromptCapture");

// Heuristic patterns for agent prompts
const AGENT_VERBS =
  /^(create|fix|implement|rewrite|analyze|refactor|explain|update|add|remove|change|make|ensure|check|run|test|debug|optimize|convert|merge|split)/i;
const AGENT_PHRASES =
  /(read the repo|update the file|run tests|make sure|please|can you|help me|write a|create a|fix the|implement a)/i;

export interface PromptDetectionResult {
  text: string;
  kind: PromptKind;
  shouldCapture: boolean;
}

/**
 * Classify a prompt string into one of the PromptKind categories.
 *
 * Rules (in order of precedence):
 * 1. "multiline" — if the text contains one or more newline characters
 * 2. "agent-prompt" — if the text has > 8 words OR starts with an action verb
 *                       OR contains a known agent phrase
 * 3. "shell-command" — short command-like input that does not look like NL
 * 4. "unknown" — empty or suspicious strings
 */
export function classifyPrompt(text: string): PromptKind {
  const trimmed = text.trim();

  if (trimmed.length === 0) {
    return "unknown";
  }

  // Rule 1: contains newline -> multiline
  if (trimmed.includes("\n")) {
    return "multiline";
  }

  const wordCount = trimmed.split(/\s+/).length;

  // Rule 2: agent-prompt heuristics
  if (wordCount > 8) {
    return "agent-prompt";
  }
  if (AGENT_VERBS.test(trimmed)) {
    return "agent-prompt";
  }
  if (AGENT_PHRASES.test(trimmed)) {
    return "agent-prompt";
  }

  // Rule 3: shell-command (default for short, non-NL input)
  return "shell-command";
}

/**
 * Process the accumulated input buffer when Enter is pressed.
 * Trims whitespace, normalizes internal whitespace, classifies, and decides
 * whether the result should be captured as a prompt entry.
 */
export function processInputBuffer(buffer: string): PromptDetectionResult {
  const trimmed = buffer.trim();

  if (trimmed.length === 0) {
    return {
      text: "",
      kind: "unknown",
      shouldCapture: false,
    };
  }

  // Normalize: collapse multiple spaces/tabs into single spaces
  const normalized = trimmed.replace(/\s+/g, " ");

  const kind = classifyPrompt(normalized);

  // Capture everything except "unknown"
  const shouldCapture = kind !== "unknown";

  logger.debug(`Classified prompt: kind=${kind}, text="${normalized.slice(0, 60)}..."`);

  return {
    text: normalized,
    kind,
    shouldCapture,
  };
}

/**
 * Redact sensitive patterns from text before sending to external APIs.
 *
 * Covers:
 * - API keys (API_KEY=..., apiKey: ..., etc.)
 * - Tokens (TOKEN=..., etc.)
 * - Passwords (PASSWORD=..., etc.)
 * - .env-style lines (UPPERCASE_KEY=value with 8+ chars)
 * - Private key blocks (BEGIN ... PRIVATE KEY)
 * - Bearer tokens (Bearer xxxxxx...)
 * - Long base64 strings (40+ chars)
 */
export function redactSensitive(text: string): string {
  let redacted = text;

  // API keys: patterns like API_KEY=xxxx, api-key:xxxx, etc.
  redacted = redacted.replace(
    /[a-zA-Z_]+[aA][pP][iI][_\-]?[kK][eE][yY].{0,3}[=:].{8,}/gi,
    "[API_KEY_REDACTED]"
  );

  // Tokens: patterns like TOKEN=xxxx, auth-token:xxxx, etc.
  redacted = redacted.replace(
    /[tT][oO][kK][eE][nN].{0,3}[=:].{8,}/gi,
    "[TOKEN_REDACTED]"
  );

  // Passwords: patterns like PASSWORD=xxxx, db_password:xxxx, etc.
  redacted = redacted.replace(
    /[pP][aA][sS][sS][wW][oO][rR][dD].{0,3}[=:].{4,}/gi,
    "[PASSWORD_REDACTED]"
  );

  // .env-style lines: UPPERCASE_KEY=value (value at least 8 chars)
  redacted = redacted.replace(
    /^\s*[A-Z_]+=.{8,}/gm,
    "[ENV_VAR_REDACTED]"
  );

  // Private key blocks
  redacted = redacted.replace(
    /-----BEGIN .* PRIVATE KEY-----/gi,
    "[PRIVATE_KEY_REDACTED]"
  );

  // Bearer tokens: "Bearer " followed by 20+ alphanumeric chars
  redacted = redacted.replace(
    /[bB][eE][aA][rR][eE][rR]\s+[a-zA-Z0-9_\-\.]{20,}/g,
    "[BEARER_TOKEN_REDACTED]"
  );

  // Long base64 strings: 40+ base64 characters
  redacted = redacted.replace(
    /[A-Za-z0-9+/]{40,}={0,2}/g,
    "[BASE64_REDACTED]"
  );

  return redacted;
}
