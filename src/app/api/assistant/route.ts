import {
  ASSISTANT_MAX_PROMPT_CHARS,
  assistantFailure,
  parseAssistantRequest,
} from "@/lib/assistant/contracts";
import { executeAssistant } from "@/lib/assistant/executor";
import { jsonResponse, readBoundedBody, rejectPublicPost } from "@/lib/http/public-post-guard";
import { ConcurrencyLimiter, SlidingWindowLimiter, clientAddress } from "@/lib/report/rate-limit";
import { runWithRequestBudget } from "@/lib/search/request-budget";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 15;

const GUARD = { maxRequestBytes: 16_384 } as const;
const ASSISTANT_REQUEST_TIMEOUT_MS = 11_000;
const assistantLimiter = new SlidingWindowLimiter({ windowMs: 60_000, max: 30 });
const assistantConcurrency = new ConcurrencyLimiter(4);

function json(body: unknown, status = 200, headers?: HeadersInit) {
  return jsonResponse(body, status, headers);
}

export async function POST(request: Request) {
  const rejected = rejectPublicPost(request, GUARD);
  if (rejected) return rejected;

  const clientKey = clientAddress(request) ?? "unknown";
  if (!assistantLimiter.consume(clientKey)) {
    return json({ ok: false, error: "Troppe richieste all’assistente. Riprova tra un minuto." }, 429, {
      "Retry-After": "60",
    });
  }

  let rawBody: string | Response;
  try {
    rawBody = await readBoundedBody(request, GUARD);
  } catch {
    return json({ ok: false, error: "Richiesta interrotta o non leggibile" }, 400);
  }
  if (rawBody instanceof Response) return rawBody;

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return json({ ok: false, error: "Richiesta JSON non valida" }, 400);
  }

  const release = assistantConcurrency.tryAcquire();
  if (!release) {
    return json({ ok: false, error: "Assistente temporaneamente occupato." }, 503, {
      "Retry-After": "5",
    });
  }

  try {
    const parsed = parseAssistantRequest(payload);
    const outcome = await runWithRequestBudget(
      request.signal,
      ASSISTANT_REQUEST_TIMEOUT_MS,
      (signal) => executeAssistant(parsed, { signal }),
    );
    if (outcome.timedOut) {
      return json(assistantFailure(
        "unavailable",
        "timeout",
        "La richiesta ha superato il tempo disponibile. Riprova più tardi.",
      ), 504, { "Retry-After": "10" });
    }
    const response = outcome.value;
    return json(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Richiesta non valida";
    return json(assistantFailure(
      "invalid_request",
      "invalid_request",
      message || `La domanda deve essere testuale e non superare ${ASSISTANT_MAX_PROMPT_CHARS} caratteri.`,
    ), 400);
  } finally {
    release();
  }
}
