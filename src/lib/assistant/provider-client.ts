import { readProviderStream } from "@/lib/assistant/provider-stream";
import { AI_MAX_OUTPUT_TOKENS, AI_MAX_PROVIDER_RESPONSE_BYTES, AI_MAX_TEXT_CHARS, type AiConnection, type AiMessage } from "@/lib/assistant/byok-contracts";

// Fixed destinations only. The public route never accepts an endpoint or request headers.
const ENDPOINTS = {
  openai: "https://api.openai.com/v1/responses",
  anthropic: "https://api.anthropic.com/v1/messages",
  openrouter: "https://openrouter.ai/api/v1/chat/completions",
} as const;

export class AiProviderError extends Error {
  readonly code: "authentication" | "credits" | "rate_limit" | "model" | "provider" | "response";
  constructor(code: AiProviderError["code"]) {
    super(code);
    this.code = code;
    this.name = "AiProviderError";
  }
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

async function boundedJson(response: Response, signal: AbortSignal): Promise<unknown> {
  if (!response.body) throw new AiProviderError("response");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  const cancel = () => { void reader.cancel().catch(() => undefined); };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    signal.throwIfAborted();
    while (true) {
      const { done, value } = await reader.read();
      signal.throwIfAborted();
      if (done) break;
      total += value.byteLength;
      if (total > AI_MAX_PROVIDER_RESPONSE_BYTES) throw new AiProviderError("response");
      chunks.push(value);
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
    catch { throw new AiProviderError("response"); }
  } finally {
    signal.removeEventListener("abort", cancel);
    await reader.cancel().catch(() => undefined);
  }
}

/** Serialize only validated inline content. No file IDs, remote URLs or provider file stores. */
function providerMessages(provider: AiConnection["provider"], messages: readonly AiMessage[]) {
  return messages.map((message) => {
    if (!message.attachments?.length) return { role: message.role, content: message.content };
    const text = [message.content, ...message.attachments.map((file) => JSON.stringify(file.kind === "text"
      ? { allegatoUtente: file.name, contenuto: file.text, limiti: file.note }
      : { immagineUtente: file.name, limiti: file.note }))].join("\n\n");
    const images = message.attachments.filter((file) => file.kind === "image");
    if (!images.length) return { role: message.role, content: text };
    if (provider === "openai") return { role: message.role, content: [
      { type: "input_text", text }, ...images.map((file) => ({ type: "input_image", image_url: `data:${file.mime};base64,${file.data}`, detail: "auto" })),
    ] };
    if (provider === "anthropic") return { role: message.role, content: [
      ...images.map((file) => ({ type: "image", source: { type: "base64", media_type: file.mime, data: file.data } })), { type: "text", text },
    ] };
    return { role: message.role, content: [
      { type: "text", text }, ...images.map((file) => ({ type: "image_url", image_url: { url: `data:${file.mime};base64,${file.data}` } })),
    ] };
  });
}

/** One paid request, without retries, redirects, persistence or cross-provider fallback. */
export async function completeProviderText(
  connection: AiConnection,
  system: string,
  messages: readonly AiMessage[],
  options: { signal: AbortSignal; fetcher?: typeof fetch; json?: boolean; toolSchema?: Record<string, unknown>; onDelta?: (text: string) => void; reasoning?: "none" | "medium" },
): Promise<string> {
  const { provider, model, apiKey } = connection;
  const inputMessages = providerMessages(provider, messages);
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  let body: Record<string, unknown>;
  if (provider === "anthropic") {
    headers["x-api-key"] = apiKey;
    headers["anthropic-version"] = "2023-06-01";
    body = { model, system, messages: inputMessages, max_tokens: AI_MAX_OUTPUT_TOKENS, stream: false };
  } else {
    headers.Authorization = `Bearer ${apiKey}`;
    if (provider === "openai") {
      body = { model, instructions: system, input: inputMessages, store: false, max_output_tokens: AI_MAX_OUTPUT_TOKENS, stream: false,
        ...(options.json ? { text: { format: { type: "json_object" } } } : {}),
        ...(model.startsWith("gpt-5") ? { reasoning: { effort: "low" } } : {}),
      };
    } else {
      body = { model, messages: [{ role: "system", content: system }, ...inputMessages], max_tokens: AI_MAX_OUTPUT_TOKENS, stream: false,
        provider: { data_collection: "deny", allow_fallbacks: false },
        ...(options.json ? { response_format: { type: "json_object" } } : {}),
      };
    }
  }
  if (options.reasoning && provider === "openrouter" && model === "openai/gpt-5.6-luna") body.reasoning = { effort: options.reasoning, exclude: true };
  if (options.toolSchema) {
    const parameters = { ...options.toolSchema };
    delete parameters.$schema;
    const tool = { name: "query_dvns", description: "Select up to two read-only DVNS dataset queries or ask for clarification.", parameters, strict: false };
    if (provider === "anthropic") {
      body.tools = [{ name: tool.name, description: tool.description, input_schema: parameters }];
      body.tool_choice = { type: "tool", name: tool.name, disable_parallel_tool_use: true };
    } else if (provider === "openai") {
      body.tools = [{ type: "function", ...tool }];
      body.tool_choice = { type: "function", name: tool.name };
      body.parallel_tool_calls = false;
    } else {
      body.tools = [{ type: "function", function: tool }];
      body.tool_choice = { type: "function", function: { name: tool.name } };
      body.parallel_tool_calls = false;
    }
  }
  if (!options.json && !options.toolSchema && options.onDelta) body.stream = true;
  options.signal.throwIfAborted();
  const response = await (options.fetcher ?? fetch)(ENDPOINTS[provider], {
    method: "POST", headers, body: JSON.stringify(body), signal: options.signal,
    redirect: "error", cache: "no-store", credentials: "omit", referrerPolicy: "no-referrer",
  });
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    // Provider error bodies can contain secrets or request content; never read or reflect them.
    throw new AiProviderError(response.status === 401 || response.status === 403 ? "authentication"
      : response.status === 402 ? "credits" : response.status === 429 ? "rate_limit"
        : response.status === 400 || response.status === 404 ? "model" : "provider");
  }
  if (!options.json && !options.toolSchema && options.onDelta) {
    try { return await readProviderStream(response, connection, options.signal, options.onDelta); }
    catch { options.signal.throwIfAborted(); throw new AiProviderError("response"); }
  }
  const payload = record(await boundedJson(response, options.signal));
  let text: string;
  if (options.toolSchema) {
    let calls: unknown[] = [];
    if (provider === "openai") {
      if (payload.status !== "completed") throw new AiProviderError("response");
      calls = (Array.isArray(payload.output) ? payload.output : []).filter((item: unknown) => record(item).type === "function_call");
    } else if (provider === "anthropic") {
      if (payload.stop_reason !== "tool_use") throw new AiProviderError("response");
      calls = (Array.isArray(payload.content) ? payload.content : []).filter((item: unknown) => record(item).type === "tool_use");
    } else {
      const choice = record(Array.isArray(payload.choices) ? payload.choices[0] : null);
      if (choice.finish_reason !== "tool_calls") throw new AiProviderError("response");
      const tools = record(choice.message).tool_calls;
      calls = (Array.isArray(tools) ? tools : []).map((item: unknown) => record(item).function);
    }
    const call = record(calls[0]);
    if (calls.length !== 1 || call.name !== "query_dvns") throw new AiProviderError("response");
    const args = provider === "anthropic" ? JSON.stringify(call.input) : call.arguments;
    if (typeof args !== "string" || args.length > AI_MAX_TEXT_CHARS) throw new AiProviderError("response");
    return args.replaceAll(apiKey, "[chiave rimossa]");
  }
  if (provider === "openai") {
    if (payload.status && payload.status !== "completed") throw new AiProviderError("response");
    text = (Array.isArray(payload.output) ? payload.output : []).flatMap((item: unknown) => {
      const message = record(item);
      return message.type === "message" && Array.isArray(message.content) ? message.content : [];
    }).filter((part: unknown) => record(part).type === "output_text")
      .map((part: unknown) => record(part).text).filter((part: unknown): part is string => typeof part === "string").join("\n");
  } else if (provider === "anthropic") {
    if (payload.stop_reason !== "end_turn") throw new AiProviderError("response");
    text = (Array.isArray(payload.content) ? payload.content : []).filter((part: unknown) => record(part).type === "text")
      .map((part: unknown) => record(part).text).filter((part: unknown): part is string => typeof part === "string").join("\n");
  } else {
    const choice = record(Array.isArray(payload.choices) ? payload.choices[0] : null);
    if (choice.finish_reason !== "stop") throw new AiProviderError("response");
    const content = record(choice.message).content;
    text = typeof content === "string" ? content : "";
  }
  if (!text.trim() || text.length > AI_MAX_TEXT_CHARS) throw new AiProviderError("response");
  // Defense against accidental upstream reflection; keys are never model input.
  return text.replaceAll(apiKey, "[chiave rimossa]").trim();
}
