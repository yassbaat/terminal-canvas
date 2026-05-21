import { createLogger } from "../util/logger";
import { DEFAULT_GROQ_CONFIG, type GroqConfig } from "./groq-types";
import { redactSensitive } from "../terminal/prompt-capture";
import type { GeneratedName, NamingContext, GroupNamingContext } from "@renderer/type/groq";

const logger = createLogger("GroqNaming");

let config: GroqConfig = { ...DEFAULT_GROQ_CONFIG };

export function getGroqConfig(): GroqConfig {
  return { ...config };
}

export function updateGroqConfig(newConfig: Partial<GroqConfig>): void {
  config = { ...config, ...newConfig };
  logger.info("Groq config updated");
}

export async function generateTerminalName(
  context: NamingContext
): Promise<GeneratedName> {
  if (!config.apiKey) {
    return fallbackName(context);
  }

  try {
    const response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        temperature: config.temperature,
        max_tokens: config.maxTokens,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: buildUserMessage(context) },
        ],
        response_format: { type: "json_object" },
      }),
    });

    if (!response.ok) {
      throw new Error(`Groq API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || "{}";
    const parsed = JSON.parse(content);

    const name = sanitizeName(parsed.name || "");
    const reason = (parsed.reason || "").slice(0, 200);
    const confidence = Math.min(
      1,
      Math.max(0, parseFloat(parsed.confidence) || 0)
    );

    logger.info(`Groq generated name: "${name}" (${confidence})`);

    return { name, reason, confidence };
  } catch (error) {
    logger.error("Groq naming failed, using fallback", error);
    return fallbackName(context);
  }
}

/**
 * Deterministic fallback naming when Groq is unavailable or fails.
 */
function fallbackName(context: NamingContext): GeneratedName {
  const recent = context.recentPrompts.join(" ");
  const projectName = context.projectName || context.shellName;

  if (recent.includes("npm run dev") || recent.includes("pnpm dev")) {
    return {
      name: `${projectName} Dev Server`,
      reason: "Detected dev server command",
      confidence: 0.7,
    };
  }

  if (
    recent.includes("npm test") ||
    recent.includes("vitest") ||
    recent.includes("jest")
  ) {
    return {
      name: `${projectName} Tests`,
      reason: "Detected test command",
      confidence: 0.7,
    };
  }

  if (recent.includes("docker compose")) {
    return {
      name: "Docker Compose",
      reason: "Detected docker compose",
      confidence: 0.8,
    };
  }

  if (recent.includes("git ")) {
    return {
      name: `${projectName} Git`,
      reason: "Detected git command",
      confidence: 0.6,
    };
  }

  if (context.shellName === "WSL") {
    return {
      name: `${projectName} WSL`,
      reason: "WSL shell detected",
      confidence: 0.5,
    };
  }

  return {
    name: `${projectName} Shell`,
    reason: `Default name for ${context.shellName} in ${context.cwdLabel}`,
    confidence: 0.4,
  };
}

/**
 * Sanitize a name string to be safe for display.
 */
function sanitizeName(name: string): string {
  let sanitized = name.replace(/[^\w\s\-_]/g, "").trim();
  if (sanitized.length > 40) {
    sanitized = sanitized.slice(0, 40);
  }
  if (sanitized.length < 2) {
    sanitized = "Terminal Session";
  }
  return sanitized;
}

const SYSTEM_PROMPT = `You generate short, useful terminal session names for a desktop app that manages many coding-agent terminals. Return only strict JSON.

Rules:
- Name must be 2 to 5 words.
- Be specific.
- Prefer project/task intent over generic shell names.
- Do not include secrets, paths, usernames, or private tokens.
- Do not use emojis.
- Do not use quotes around the name except inside JSON.
- If context is weak, use the project folder and shell purpose.
- Return JSON only:
{
  "name": "...",
  "reason": "...",
  "confidence": 0.0
}`;

export async function generateGroupName(
  context: GroupNamingContext
): Promise<GeneratedName> {
  if (!config.apiKey) {
    return fallbackGroupName(context);
  }

  try {
    const response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        temperature: config.temperature,
        max_tokens: config.maxTokens,
        messages: [
          { role: "system", content: GROUP_SYSTEM_PROMPT },
          { role: "user", content: buildGroupUserMessage(context) },
        ],
        response_format: { type: "json_object" },
      }),
    });

    if (!response.ok) {
      throw new Error(`Groq API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || "{}";
    const parsed = JSON.parse(content);

    const name = sanitizeName(parsed.name || "");
    const reason = (parsed.reason || "").slice(0, 200);
    const confidence = Math.min(
      1,
      Math.max(0, parseFloat(parsed.confidence) || 0)
    );

    logger.info(`Groq generated group name: "${name}" (${confidence})`);

    return { name, reason, confidence };
  } catch (error) {
    logger.error("Groq group naming failed, using fallback", error);
    return fallbackGroupName(context);
  }
}

function fallbackGroupName(context: GroupNamingContext): GeneratedName {
  const uniqueProjects = Array.from(new Set(context.projects.filter(Boolean)));
  const commonProject = uniqueProjects.length === 1 ? uniqueProjects[0] : null;

  if (commonProject) {
    return {
      name: `${commonProject} Group`,
      reason: "Grouped by common project",
      confidence: 0.5,
    };
  }

  return {
    name: `${context.terminalNames.length} Terminals`,
    reason: "Fallback group name",
    confidence: 0.3,
  };
}

const GROUP_SYSTEM_PROMPT = `You generate short, useful group names for a desktop app that manages multiple coding-agent terminals in groups. Return only strict JSON.

Rules:
- Name must be 2 to 4 words.
- Describe the shared purpose or project of the grouped terminals.
- Be specific.
- Do not include secrets, paths, usernames, or private tokens.
- Do not use emojis.
- Do not use quotes around the name except inside JSON.
- If terminals share a common project, use the project name.
- Return JSON only:
{
  "name": "...",
  "reason": "...",
  "confidence": 0.0
}`;

function buildGroupUserMessage(context: GroupNamingContext): string {
  const redactedPrompts = context.recentPrompts
    .map((p) => redactSensitive(p).slice(0, 300))
    .join("\n");

  return `Generate a group name from this context:

Terminals in group: ${context.terminalNames.join(", ")}
Projects: ${context.projects.filter(Boolean).join(", ") || "Unknown"}
Directories: ${context.cwds.join(", ")}
Shells: ${context.shells.join(", ")}
Recent prompts/commands: ${redactedPrompts || "None yet"}

Return JSON only.`;
}

function buildUserMessage(context: NamingContext): string {
  const redactedPrompts = context.recentPrompts
    .map((p) => redactSensitive(p).slice(0, 300))
    .join("\n");

  return `Generate a terminal session name from this context:

Project name: ${context.projectName || "Unknown"}
CWD label: ${context.cwdLabel}
Shell: ${context.shellName}
Recent prompts/commands: ${redactedPrompts || "None yet"}
Output preview: ${context.outputPreview.slice(0, 500)}
Existing title: ${context.existingTitle || "None"}

Return JSON only.`;
}
