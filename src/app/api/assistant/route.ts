import {
  ASSISTANT_MAX_PROMPT_CHARS,
  assistantFailure,
  parseAssistantRequest,
} from "@/lib/assistant/contracts";
import { executeAssistant } from "@/lib/assistant/executor";
import { jsonResponse, readBoundedBody, rejectPublicPost } from "@/lib/http/public-post-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 15;

const GUARD = { maxRequestBytes: 16_384 } as const;

function json(body: unknown, status = 200, headers?: HeadersInit) {
  return jsonResponse(body, status, headers);
}

export async function POST(request: Request) {
  const rejected = rejectPublicPost(request, GUARD);
  if (rejected) return rejected;

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

  try {
    const parsed = parseAssistantRequest(payload);
    const response = await executeAssistant(parsed, { signal: request.signal });
    return json(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Richiesta non valida";
    return json(assistantFailure(
      "invalid_request",
      "invalid_request",
      message || `La domanda deve essere testuale e non superare ${ASSISTANT_MAX_PROMPT_CHARS} caratteri.`,
    ), 400);
  }
}
