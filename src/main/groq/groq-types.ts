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
  model: "llama-3.1-8b-instant",
  temperature: 0.1,
  maxTokens: 256,
  enabled: true,
};
