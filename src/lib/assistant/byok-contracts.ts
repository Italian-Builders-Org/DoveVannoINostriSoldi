import type { AiAttachment } from "./attachment-contracts";

/** Shared UI contract: no credentials, model results or provider state are persisted. */
export const AI_PROVIDERS = {
  openrouter: {
    label: "OpenRouter", defaultModel: "openai/gpt-5.6-luna",
    models: ["openai/gpt-5.6-luna", "openai/gpt-4.1-mini", "openai/gpt-5-mini", "anthropic/claude-haiku-4.5"],
    keysUrl: "https://openrouter.ai/settings/keys", privacyUrl: "https://openrouter.ai/privacy",
  },
  openai: {
    label: "OpenAI", defaultModel: "gpt-4.1-mini",
    models: ["gpt-4.1-mini", "gpt-5-mini"],
    keysUrl: "https://platform.openai.com/api-keys", privacyUrl: "https://developers.openai.com/api/docs/guides/your-data",
  },
  anthropic: {
    label: "Anthropic", defaultModel: "claude-haiku-4-5-20251001",
    models: ["claude-haiku-4-5-20251001", "claude-sonnet-5"],
    keysUrl: "https://platform.claude.com/settings/keys", privacyUrl: "https://www.anthropic.com/legal/privacy",
  },
} as const;
export type AiProvider = keyof typeof AI_PROVIDERS;
export type AiReasoning = "auto" | "none" | "medium";
export type AiConnection = { provider: AiProvider; model: string; apiKey: string; reasoning?: AiReasoning };
export type AiMessage = { role: "user" | "assistant"; content: string; attachments?: AiAttachment[] };
export const AI_MAX_HISTORY_MESSAGES = 6;
export const AI_MAX_HISTORY_CHARS = 16_000;
export const AI_MAX_PROMPT_CHARS = 8_000;
export const AI_MAX_TEXT_CHARS = 8_000;
export const AI_MAX_OUTPUT_TOKENS = 2_048;
export const AI_MAX_PROVIDER_RESPONSE_BYTES = 262_144;
export const AI_MAX_EVIDENCE_CHARS = 24_000;
export const AI_MAX_QUERIES = 2;
export const AI_REQUEST_TIMEOUT_MS = 50_000;
export const AI_REQUEST_MAX_BYTES = 4_000_000;
export const AI_MODEL_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,119}$/u;
export const AI_KEY_PATTERN = /^[\x21-\x7E]{16,512}$/u;
export type AiSource = { name: string; url: string; period?: string };
export type AiEvidence = { dataset: string; title: string; sources: AiSource[]; caveat?: string };
export type AiAnswer = {
  ok: true; kind: "ai_answer"; provider: AiProvider; model: string; text: string; evidence: AiEvidence[];
};
export type AiFailure = { ok: false; kind: "ai_error"; code: string; message: string };
export type AiResponse = AiAnswer | AiFailure;
export function isAiProvider(value: unknown): value is AiProvider {
  return typeof value === "string" && Object.hasOwn(AI_PROVIDERS, value);
}
export function isAiResponse(value: unknown): value is AiResponse {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  if (item.ok === false && item.kind === "ai_error") return typeof item.code === "string" && typeof item.message === "string";
  if (item.ok !== true || item.kind !== "ai_answer" || !isAiProvider(item.provider) || typeof item.model !== "string" || typeof item.text !== "string" || item.text.length > AI_MAX_TEXT_CHARS || !Array.isArray(item.evidence) || item.evidence.length > AI_MAX_QUERIES) return false;
  return item.evidence.every((entry: unknown) => {
    if (!entry || typeof entry !== "object") return false;
    const evidence = entry as Record<string, unknown>;
    return typeof evidence.dataset === "string" && typeof evidence.title === "string" && (evidence.caveat === undefined || typeof evidence.caveat === "string") && Array.isArray(evidence.sources) && evidence.sources.length <= 8 && evidence.sources.every((source: unknown) => {
      if (!source || typeof source !== "object") return false;
      const s = source as Record<string, unknown>;
      if (typeof s.name !== "string" || typeof s.url !== "string" || (s.period !== undefined && typeof s.period !== "string")) return false;
      try { const url = new URL(s.url); return url.protocol === "https:" && !url.username && !url.password; } catch { return false; }
    });
  });
}
