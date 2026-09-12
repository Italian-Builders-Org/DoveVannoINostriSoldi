import { createHash } from "node:crypto";
import * as z from "zod/v4";
import { AI_KEY_PATTERN, AI_MAX_HISTORY_CHARS, AI_MAX_HISTORY_MESSAGES, AI_MAX_PROMPT_CHARS, AI_MAX_TEXT_CHARS, AI_MODEL_PATTERN, AI_REQUEST_MAX_BYTES, AI_REQUEST_TIMEOUT_MS, type AiFailure, type AiConnection } from "@/lib/assistant/byok-contracts";
import { FREE_MODEL } from "@/lib/assistant/free-contracts";
import { freeQuota, FreeQuotaError } from "@/lib/assistant/free-quota";
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
  mode: z.enum(["personal", "free"]).optional(),
  provider: z.enum(["openai", "openrouter", "anthropic", "regolo"]),
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
  // Personal credentials never fall back to the shared key. Free access is explicit.
  const credential = request.headers.get("authorization")?.match(/^Bearer ([\x21-\x7E]+)$/u)?.[1];
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
  if (parsed.provider === "regolo" && parsed.model === FREE_MODEL && attachments.some((file) => file.kind === "image")) {
    return failure("model", "GLM 5.2 non legge immagini. Rimuovi le immagini oppure collega un modello con visione; la quota gratuita non è stata consumata.");
  }
  const free = parsed.mode === "free";
  if (free && (request.headers.has("authorization") || parsed.provider !== "regolo" || parsed.model !== FREE_MODEL || parsed.reasoning !== undefined)) {
    return failure("invalid_request", "Configurazione gratuita non valida.");
  }
  if (!free && (!credential || !AI_KEY_PATTERN.test(credential))) return failure("authentication", "Inserisci una chiave API valida nel pannello del provider.", 401);
  if (!free) {
    const keyId = createHash("sha256").update(credential!).digest("hex");
    if (!byKey.consume(keyId)) return failure("rate_limit", "Limite di richieste raggiunto per questa chiave. Riprova tra un minuto.", 429, { "Retry-After": "60" });
  }
  const localRelease = concurrency.tryAcquire();
  if (!localRelease) return failure("busy", "Assistente temporaneamente occupato. Riprova tra poco.", 503, { "Retry-After": "5" });
  let admission: Awaited<ReturnType<typeof freeQuota>> | undefined;
  if (free) {
    try { admission = await freeQuota(request, true); }
    catch (error) {
      localRelease();
      const code = error instanceof FreeQuotaError ? error.code : "free_unavailable";
      const message = code === "free_limit" ? "Hai esaurito le domande gratuite di oggi per questo browser o questa rete. Collega la tua chiave oppure torna domani."
        : code === "free_busy" ? "Una richiesta è già in corso su questo browser o questa rete. Attendi qualche secondo."
          : code === "free_identity" ? "Ricarica la disponibilità gratuita e abilita i cookie tecnici per continuare."
            : "Il servizio gratuito non è disponibile. Puoi collegare la tua chiave personale.";
      return failure(code, message, code === "free_limit" || code === "free_busy" ? 429 : 503);
    }
  }
  const connection: AiConnection = { provider: parsed.provider, model: parsed.model, apiKey: admission?.apiKey ?? credential!, reasoning: parsed.reasoning };
  const quotaHeaders: Record<string, string> = admission ? { "X-Assistant-Remaining": String(admission.quota.remaining), "X-Assistant-Reset": admission.quota.resetAt } : {};
  const release = async () => { localRelease(); await admission?.release(); };
  const upstreamMessage = (code: keyof typeof providerMessages) => free ? "Regolo non ha completato la risposta gratuita. Puoi riprovare o collegare una chiave personale." : providerMessages[code];
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
              return await executeByokChat(connection, parsed.messages, {
                signal, onDelta: (text) => { if (!signal.aborted) send({ type: "delta", text }); },
                onActivity: (activity) => { if (!signal.aborted) send({ type: "activity", activity }); },
              });
            } finally { await release(); }
          });
          if (result.timedOut) send({ type: "error", response: { ok: false, kind: "ai_error", code: "timeout", message: "La risposta ha superato il tempo disponibile. Puoi riprovare." } });
          else send({ type: "done", response: result.value });
        } catch (error) {
          const code = error instanceof AiProviderError ? error.code : "provider";
          send({ type: "error", response: { ok: false, kind: "ai_error", code, message: upstreamMessage(code) } });
        } finally {
          if (!closed) { closed = true; controller.close(); }
        }
      },
      cancel() { closed = true; disconnected.abort(); },
    });
    return new Response(stream, { headers: {
      "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "private, no-store, no-transform",
      "X-Content-Type-Options": "nosniff", "X-Accel-Buffering": "no", ...quotaHeaders,
    } });
  }
  try {
    const outcome = await runWithRequestBudget(request.signal, AI_REQUEST_TIMEOUT_MS, async (signal) => {
      // A timed-out response must not release the slot while work is still cancelling.
      try { return await executeByokChat(connection, parsed.messages, { signal }); }
      finally { await release(); }
    });
    if (outcome.timedOut) return failure("timeout", "La risposta ha superato il tempo disponibile. Puoi riprovare.", 504);
    return jsonResponse(outcome.value, 200, quotaHeaders);
  } catch (error) {
    if (request.signal.aborted) return failure("cancelled", "Richiesta interrotta.", 499);
    if (error instanceof AiProviderError) return failure(error.code, upstreamMessage(error.code), error.code === "authentication" ? 401 : 502);
    // No exception strings, provider bodies, headers or user content enter a response or log.
    return failure("provider", providerMessages.provider, 502);
  }
}
