import { createHash } from "node:crypto";
import * as z from "zod/v4";
import { AI_KEY_PATTERN, AI_MAX_HISTORY_CHARS, AI_MAX_HISTORY_MESSAGES, AI_MAX_PROMPT_CHARS, AI_MAX_TEXT_CHARS, AI_MODEL_PATTERN, AI_REQUEST_MAX_BYTES, AI_REQUEST_TIMEOUT_MS, type AiFailure } from "@/lib/assistant/byok-contracts";
import { attachmentSchema } from "@/lib/assistant/attachment-schema";
import { ATTACHMENT_MAX_FILES, ATTACHMENT_MAX_TEXT_CHARS, attachmentTextSize } from "@/lib/assistant/attachment-contracts";
import { executeByokChat } from "@/lib/assistant/byok-engine";
import { AiProviderError } from "@/lib/assistant/provider-client";
import { jsonResponse, readBoundedBody, rejectPublicPost } from "@/lib/http/public-post-guard";
import { ConcurrencyLimiter, SlidingWindowLimiter, clientAddress } from "@/lib/report/rate-limit";
import { runWithRequestBudget } from "@/lib/search/request-budget";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
const GUARD = { maxRequestBytes: AI_REQUEST_MAX_BYTES };
const byAddress = new SlidingWindowLimiter({ windowMs: 60_000, max: 20 });
const byKey = new SlidingWindowLimiter({ windowMs: 60_000, max: 10 });
const concurrency = new ConcurrencyLimiter(4);
const schema = z.object({
  provider: z.enum(["openai", "openrouter", "anthropic"]),
  model: z.string().regex(AI_MODEL_PATTERN),
  consent: z.literal(true),
  reasoning: z.enum(["auto", "none", "medium"]).optional(),
  messages: z.array(z.object({
    role: z.enum(["user", "assistant"]), content: z.string().min(1).max(AI_MAX_TEXT_CHARS),
    attachments: z.array(attachmentSchema).max(ATTACHMENT_MAX_FILES).optional(),
  }).strict()).min(1).max(AI_MAX_HISTORY_MESSAGES + 1),
}).strict();

function failure(code: string, message: string, status = 400, headers?: HeadersInit) {
  return jsonResponse({ ok: false, kind: "ai_error", code, message } satisfies AiFailure, status, headers);
}
const providerMessages = {
  authentication: "Chiave non valida o non autorizzata. Controlla il provider e i permessi della chiave.",
  credits: "Il provider segnala credito insufficiente. Controlla il tuo conto.",
  rate_limit: "Il provider ha raggiunto un limite di richieste o di credito. Controlla il tuo conto e riprova più tardi.",
  model: "Il modello non è disponibile o non supporta questa richiesta. Controlla il suo identificativo e i permessi del conto.",
  provider: "Il provider non è raggiungibile in questo momento. Riprova più tardi.",
  response: "Il provider non ha restituito una risposta completa e leggibile. Puoi riprovare o scegliere un altro modello.",
};

export async function POST(request: Request) {
  const rejected = rejectPublicPost(request, GUARD);
  if (rejected) return rejected;
  if (!byAddress.consume(clientAddress(request) ?? "unknown")) return failure("rate_limit", "Troppe richieste. Riprova tra un minuto.", 429, { "Retry-After": "60" });
  // Only a per-request Authorization header. No cookies, URL keys, environment fallback or key vault.
  const credential = request.headers.get("authorization")?.match(/^Bearer ([\x21-\x7E]+)$/u)?.[1];
  if (!credential || !AI_KEY_PATTERN.test(credential)) return failure("authentication", "Inserisci una chiave API valida nel pannello del provider.", 401);
  let raw: string | Response;
  try { raw = await readBoundedBody(request, GUARD); }
  catch { return failure("invalid_request", "Richiesta interrotta o non leggibile."); }
  if (raw instanceof Response) return raw;
  let parsed: z.infer<typeof schema>;
  try { parsed = schema.parse(JSON.parse(raw)); }
  catch { return failure("invalid_request", "Configurazione o messaggi non validi. Controlla il pannello del provider."); }
  const attachments = parsed.messages.flatMap((message) => message.attachments ?? []);
  if (attachments.length > ATTACHMENT_MAX_FILES || attachmentTextSize(attachments) > ATTACHMENT_MAX_TEXT_CHARS || parsed.messages.some((message) => message.role !== "user" && message.attachments?.length)) {
    return failure("invalid_request", "Gli allegati superano i limiti disponibili. Rimuovi un file o inizia una nuova chat.");
  }
  const last = parsed.messages.at(-1)!;
  if (last.role !== "user" || !last.content.trim() || last.content.length > AI_MAX_PROMPT_CHARS || parsed.messages.reduce((sum, message) => sum + message.content.length, 0) > AI_MAX_HISTORY_CHARS) {
    return failure("invalid_request", "La conversazione supera i limiti disponibili. Inizia una nuova chat.");
  }
  const keyId = createHash("sha256").update(credential).digest("hex");
  if (!byKey.consume(keyId)) return failure("rate_limit", "Limite di richieste raggiunto per questa chiave. Riprova tra un minuto.", 429, { "Retry-After": "60" });
  const release = concurrency.tryAcquire();
  if (!release) return failure("busy", "Assistente temporaneamente occupato. Riprova tra poco.", 503, { "Retry-After": "5" });
  if (request.headers.get("accept")?.includes("text/event-stream")) {
    const disconnected = new AbortController();
    const caller = AbortSignal.any([request.signal, disconnected.signal]);
    const encoder = new TextEncoder();
    let closed = false;
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const send = (event: unknown) => { if (!closed && !caller.aborted) controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`)); };
        try {
          const result = await runWithRequestBudget(caller, AI_REQUEST_TIMEOUT_MS, async (signal) => {
            try {
              return await executeByokChat({ provider: parsed.provider, model: parsed.model, apiKey: credential, reasoning: parsed.reasoning }, parsed.messages, {
                signal, onDelta: (text) => { if (!signal.aborted) send({ type: "delta", text }); },
                onActivity: (activity) => { if (!signal.aborted) send({ type: "activity", activity }); },
              });
            } finally { release(); }
          });
          if (result.timedOut) send({ type: "error", response: { ok: false, kind: "ai_error", code: "timeout", message: "La risposta ha superato il tempo disponibile. Puoi riprovare." } });
          else send({ type: "done", response: result.value });
        } catch (error) {
          const code = error instanceof AiProviderError ? error.code : "provider";
          send({ type: "error", response: { ok: false, kind: "ai_error", code, message: providerMessages[code] } });
        } finally {
          if (!closed) { closed = true; controller.close(); }
        }
      },
      cancel() { closed = true; disconnected.abort(); },
    });
    return new Response(stream, { headers: {
      "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "private, no-store, no-transform",
      "X-Content-Type-Options": "nosniff", "X-Accel-Buffering": "no",
    } });
  }
  try {
    const outcome = await runWithRequestBudget(request.signal, AI_REQUEST_TIMEOUT_MS, async (signal) => {
      // A timed-out response must not release the slot while work is still cancelling.
      try { return await executeByokChat({ provider: parsed.provider, model: parsed.model, apiKey: credential, reasoning: parsed.reasoning }, parsed.messages, { signal }); }
      finally { release(); }
    });
    if (outcome.timedOut) return failure("timeout", "La risposta ha superato il tempo disponibile. Puoi riprovare.", 504);
    return jsonResponse(outcome.value);
  } catch (error) {
    if (request.signal.aborted) return failure("cancelled", "Richiesta interrotta.", 499);
    if (error instanceof AiProviderError) return failure(error.code, providerMessages[error.code], error.code === "authentication" ? 401 : 502);
    // No exception strings, provider bodies, headers or user content enter a response or log.
    return failure("provider", providerMessages.provider, 502);
  }
}
