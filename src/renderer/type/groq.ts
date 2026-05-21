export interface GeneratedName {
  name: string;
  reason: string;
  confidence: number;
}

export interface GroqSettings {
  apiKey: string | null;
  baseUrl: string;
  model: string;
  temperature: number;
  maxTokens: number;
  enabled: boolean;
}

export interface NamingContext {
  projectName: string | null;
  cwdLabel: string;
  shellName: string;
  recentPrompts: string[];
  outputPreview: string;
  existingTitle: string | null;
  promptCount: number;
}

export interface GroupNamingContext {
  terminalNames: string[];
  projects: (string | null)[];
  cwds: string[];
  shells: string[];
  recentPrompts: string[];
}

export interface GroqTestResult {
  success: boolean;
  message: string;
  latency?: number;
}

export const DEFAULT_GROQ_SETTINGS: GroqSettings = {
  apiKey: process.env.GROQ_API_KEY || null,
  baseUrl: "https://api.groq.com/openai/v1",
  model: "llama-3.1-8b-instant",
  temperature: 0.1,
  maxTokens: 256,
  enabled: true,
};

export const GROQ_NAMING_PROMPT = `You generate short, useful terminal session names for a desktop app that manages many coding-agent terminals. Return only strict JSON.

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
