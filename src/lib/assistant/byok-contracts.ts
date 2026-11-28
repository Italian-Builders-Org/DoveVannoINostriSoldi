import type { AiAttachment } from "./attachment-contracts";

/** Shared UI contract: no credentials, model results or provider state are persisted. */
export const AI_PROVIDERS = {
  regolo: {
    label: "Regolo", defaultModel: "glm5.2",
    models: ["glm5.2"],
    keysUrl: "https://dashboard.regolo.ai", privacyUrl: "https://regolo.ai/privacy-policy/",
  },
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
/** `period` is what the data covers; `asOf` is the snapshot date of the source, never shown as a period. */
export type AiSource = { name: string; url: string; period?: string; asOf?: string };
/** `href` is the DVNS page built from this dataset, chosen by the server. */
export type AiEvidence = { dataset: string; title: string; href?: string; sources: AiSource[]; caveat?: string };
/** A same-origin DVNS page chosen by the server, never by the model. */
export type AiSiteLink = { href: string; title: string; description?: string };
export const AI_MAX_SITE_LINKS = 4;
export type AiAnswer = {
  ok: true; kind: "ai_answer"; provider: AiProvider; model: string; text: string; evidence: AiEvidence[];
  /** Optional on the wire so answers produced before this field still validate. */
  siteLinks?: AiSiteLink[];
};
export type AiFailure = { ok: false; kind: "ai_error"; code: string; message: string };
export type AiResponse = AiAnswer | AiFailure;
/** Root-relative path on this site: no scheme, host, protocol-relative prefix, backslash or control character. */
export function isInternalSiteHref(value: unknown): value is string {
  return typeof value === "string" && value.length <= 300 && /^\/(?![/\\])[^\s\\\p{Cc}]*$/u.test(value);
}
function isAiSiteLink(value: unknown): value is AiSiteLink {
  if (!value || typeof value !== "object") return false;
  const link = value as Record<string, unknown>;
  return isInternalSiteHref(link.href) && typeof link.title === "string" && link.title.length > 0 && link.title.length <= 120 &&
    (link.description === undefined || (typeof link.description === "string" && link.description.length <= 240));
}
function isAiProvider(value: unknown): value is AiProvider {
  return typeof value === "string" && Object.hasOwn(AI_PROVIDERS, value);
}
export function isAiResponse(value: unknown): value is AiResponse {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  if (item.ok === false && item.kind === "ai_error") return typeof item.code === "string" && typeof item.message === "string";
  if (item.ok !== true || item.kind !== "ai_answer" || !isAiProvider(item.provider) || typeof item.model !== "string" || typeof item.text !== "string" || item.text.length > AI_MAX_TEXT_CHARS || !Array.isArray(item.evidence) || item.evidence.length > AI_MAX_QUERIES) return false;
  if (item.siteLinks !== undefined && (!Array.isArray(item.siteLinks) || item.siteLinks.length > AI_MAX_SITE_LINKS || !item.siteLinks.every(isAiSiteLink))) return false;
  return item.evidence.every((entry: unknown) => {
    if (!entry || typeof entry !== "object") return false;
    const evidence = entry as Record<string, unknown>;
    return typeof evidence.dataset === "string" && typeof evidence.title === "string" && (evidence.href === undefined || isInternalSiteHref(evidence.href)) && (evidence.caveat === undefined || typeof evidence.caveat === "string") && Array.isArray(evidence.sources) && evidence.sources.length <= 8 && evidence.sources.every((source: unknown) => {
      if (!source || typeof source !== "object") return false;
      const s = source as Record<string, unknown>;
      if (typeof s.name !== "string" || typeof s.url !== "string" || (s.period !== undefined && typeof s.period !== "string") || (s.asOf !== undefined && typeof s.asOf !== "string")) return false;
      try { const url = new URL(s.url); return url.protocol === "https:" && !url.username && !url.password; } catch { return false; }
    });
  });
}
