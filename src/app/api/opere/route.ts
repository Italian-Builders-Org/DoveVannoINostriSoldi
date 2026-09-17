import { NextResponse } from "next/server.js";
import { getPublicWorksByCup } from "@/lib/bdap-public-works";
import { ConcurrencyLimiter, SlidingWindowLimiter, clientAddress } from "@/lib/report/rate-limit";
import { runWithRequestBudget } from "@/lib/search/request-budget";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 15;

const OPERE_REQUEST_TIMEOUT_MS = 6_000;
const opereLimiter = new SlidingWindowLimiter({ windowMs: 60_000, max: 20 });
const opereConcurrency = new ConcurrencyLimiter(3);

function unavailable(message: string, status: number, retryAfter: string): Response {
  return NextResponse.json(
    { ok: false, error: message },
    {
      status,
      headers: {
        "Cache-Control": "private, no-store",
        "Retry-After": retryAfter,
        "X-Content-Type-Options": "nosniff",
      },
    },
  );
}

export async function GET(request: Request) {
  const cup = new URL(request.url).searchParams.get("cup");
  if (!cup) {
    return NextResponse.json(
      { ok: false, error: "Specificare il parametro CUP" },
      { status: 400 },
    );
  }

  const clientKey = clientAddress(request) ?? "unknown";
  if (!opereLimiter.consume(clientKey)) {
    return unavailable("Troppe richieste per le opere. Riprova tra un minuto.", 429, "60");
  }

  const release = opereConcurrency.tryAcquire();
  if (!release) {
    return unavailable("Ricerca opere temporaneamente occupata.", 503, "5");
  }

  try {
    const outcome = await runWithRequestBudget(
      request.signal,
      OPERE_REQUEST_TIMEOUT_MS,
      (signal) => getPublicWorksByCup(cup, { signal }),
    );
    if (outcome.timedOut) {
      return unavailable("La fonte OpenBDAP ha superato il tempo massimo.", 504, "10");
    }
    const result = outcome.value;
    return NextResponse.json(
      { ok: true, ...result },
      {
        headers: {
          "Cache-Control": "public, s-maxage=21600, stale-while-revalidate=86400",
        },
      },
    );
  } catch (error) {
    if (request.signal.aborted) throw error;
    const message = error instanceof Error ? error.message : "Errore sconosciuto";
    const invalidInput = message.startsWith("CUP non valido");
    return NextResponse.json(
      { ok: false, error: message },
      { status: invalidInput ? 400 : 502 },
    );
  } finally {
    release();
  }
}
