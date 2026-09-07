import { AI_MAX_PROVIDER_RESPONSE_BYTES, AI_MAX_TEXT_CHARS, type AiConnection } from "@/lib/assistant/byok-contracts";

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

/** Parse SSE incrementally, including split UTF-8, CRLF, comments and multiline data.
 * Only bounded text deltas escape; reasoning, error bodies and provider metadata never do.
 */
export async function readProviderStream(response: Response, connection: AiConnection, signal: AbortSignal, onDelta: (text: string) => void): Promise<string> {
  if (!response.body || !response.headers.get("content-type")?.includes("text/event-stream")) throw new Error("stream_response");
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let buffer = "", text = "", delivered = "", eventData: string[] = [];
  let bytes = 0, complete = false, stopped = false;
  const cancel = () => { void reader.cancel().catch(() => undefined); };
  signal.addEventListener("abort", cancel, { once: true });
  const emit = (final = false) => {
    // Keep a possible partial key in the buffer until it can be redacted as a whole.
    const safe = text.replaceAll(connection.apiKey, "[chiave rimossa]");
    let end = safe.length;
    if (!final) for (let size = Math.min(connection.apiKey.length - 1, safe.length); size > 0; size--) {
      if (safe.endsWith(connection.apiKey.slice(0, size))) { end -= size; break; }
    }
    if (end > delivered.length) { onDelta(safe.slice(delivered.length, end)); delivered = safe.slice(0, end); }
  };
  const event = () => {
    if (!eventData.length) return;
    const data = eventData.join("\n"); eventData = [];
    if (data === "[DONE]") { if (connection.provider === "openrouter" && complete) stopped = true; return; }
    const item = record(JSON.parse(data));
    if (item.error || item.type === "error" || item.type === "response.failed" || item.type === "response.incomplete") throw new Error("stream_error");
    let delta: unknown;
    if (connection.provider === "openrouter") {
      const choice = record(Array.isArray(item.choices) ? item.choices[0] : null);
      delta = record(choice.delta).content;
      if (choice.finish_reason) {
        if (choice.finish_reason !== "stop") throw new Error("stream_incomplete");
        complete = true;
      }
    } else if (connection.provider === "openai") {
      if (item.type === "response.output_text.delta") delta = item.delta;
      if (item.type === "response.completed") { complete = record(item.response).status === "completed"; stopped = complete; }
    } else {
      const change = record(item.delta);
      if (item.type === "content_block_delta" && change.type === "text_delta") delta = change.text;
      if (item.type === "message_delta" && change.stop_reason) {
        if (change.stop_reason !== "end_turn") throw new Error("stream_incomplete");
        complete = true;
      }
      if (item.type === "message_stop") stopped = complete;
    }
    if (typeof delta === "string" && delta) {
      if (stopped) throw new Error("stream_after_end");
      text += delta;
      if (text.length > AI_MAX_TEXT_CHARS) throw new Error("stream_size");
      emit();
    }
  };
  try {
    signal.throwIfAborted();
    while (true) {
      const next = await reader.read(); signal.throwIfAborted();
      if (next.done) { buffer += decoder.decode(); break; }
      bytes += next.value.byteLength;
      if (bytes > AI_MAX_PROVIDER_RESPONSE_BYTES) throw new Error("stream_size");
      buffer += decoder.decode(next.value, { stream: true });
      let newline: number;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newline).replace(/\r$/u, ""); buffer = buffer.slice(newline + 1);
        if (!line) event();
        else if (line.startsWith("data:")) eventData.push(line.slice(5).replace(/^ /u, ""));
      }
    }
    // A missing terminal event is a truncated response, even if a few words arrived.
    if (buffer.trim() || eventData.length || !complete || !stopped || !text.trim()) throw new Error("stream_incomplete");
    emit(true);
    return text.replaceAll(connection.apiKey, "[chiave rimossa]").trim();
  } finally {
    signal.removeEventListener("abort", cancel);
    await reader.cancel().catch(() => undefined);
  }
}
