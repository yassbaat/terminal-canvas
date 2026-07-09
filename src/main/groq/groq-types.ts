export interface GroqConfig {
  apiKey: string | null;
  baseUrl: string;
  model: string;
  temperature: number;
  maxTokens: number;
  enabled: boolean;
}

export const DEFAULT_GROQ_CONFIG: GroqConfig = {
  apiKey: process.env.GROQ_API_KEY || null,
  baseUrl: "https://api.groq.com/openai/v1",
  // llama-3.1-8b-instant (the old default) is deprecated by Groq as of
  // 2026-08-16; gpt-oss-20b is their recommended replacement and is
  // faster/cheaper too, ideal for short auto-naming completions.
  model: "openai/gpt-oss-20b",
  temperature: 0.1,
  maxTokens: 256,
  enabled: true,
};
