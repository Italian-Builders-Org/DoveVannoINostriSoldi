import { isAiActivity, type AiActivity } from "@/lib/assistant/activity-contracts";
import { AI_MAX_TEXT_CHARS, isAiResponse, type AiResponse } from "@/lib/assistant/byok-contracts";

/** DVNS stream protocol; unfinished text never becomes a completed history message. */
export async function readChatStream(response: Response, signal: AbortSignal, onText: (text: string) => void, onActivity?: (activity: AiActivity) => void): Promise<AiResponse> {
  if (!response.headers.get("content-type")?.includes("text/event-stream")) {
    const result: unknown = await response.json();
    if (!isAiResponse(result)) throw new Error("chat_response");
    return result;
  }
  if (!response.body) throw new Error("chat_stream");
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let buffer = "", text = "", total = 0;
  let result: AiResponse | undefined;
  const cancel = () => { void reader.cancel().catch(() => undefined); };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    signal.throwIfAborted();
    while (true) {
      const next = await reader.read(); signal.throwIfAborted();
      if (next.done) break;
      total += next.value.byteLength;
      if (total > 262_144) throw new Error("chat_stream_size");
      buffer += decoder.decode(next.value, { stream: true });
      let end: number;
      while ((end = buffer.indexOf("\n\n")) >= 0) {
        const frame = buffer.slice(0, end); buffer = buffer.slice(end + 2);
        if (!frame.startsWith("data: ") || result) throw new Error("chat_stream_protocol");
        const event = JSON.parse(frame.slice(6)) as Record<string, unknown>;
        if (event.type === "activity" && isAiActivity(event.activity)) onActivity?.(event.activity);
        else if (event.type === "delta" && typeof event.text === "string") {
          text += event.text;
          if (text.length > AI_MAX_TEXT_CHARS) throw new Error("chat_stream_size");
          onText(text);
        } else if ((event.type === "done" || event.type === "error") && isAiResponse(event.response)) result = event.response;
        else throw new Error("chat_stream_protocol");
      }
    }
    buffer += decoder.decode();
    if (buffer.trim() || !result) throw new Error("chat_stream_incomplete");
    return result;
  } finally {
    signal.removeEventListener("abort", cancel);
    await reader.cancel().catch(() => undefined);
  }
}
