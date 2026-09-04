import { NextResponse } from "next/server.js";
import { getStateSpendingHistory } from "@/lib/bdap-history";
import { ConcurrencyLimiter, SlidingWindowLimiter, clientAddress } from "@/lib/report/rate-limit";
import { runWithRequestBudget } from "@/lib/search/request-budget";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 15;

const HISTORY_REQUEST_TIMEOUT_MS = 9_000;
const historyLimiter = new SlidingWindowLimiter({ windowMs: 60_000, max: 6 });
const historyConcurrency = new ConcurrencyLimiter(2);

function unavailable(message: string, status: number, retryAfter: string): Response {
  return NextResponse.json(
    { ok: false, source: "RGS / OpenBDAP", error: message },
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
  const clientKey = clientAddress(request) ?? "unknown";
  if (!historyLimiter.consume(clientKey)) {
    return unavailable("Troppe richieste per lo storico. Riprova tra un minuto.", 429, "60");
  }

  const release = historyConcurrency.tryAcquire();
  if (!release) {
    return unavailable("Storico OpenBDAP temporaneamente occupato.", 503, "5");
  }

  try {
    const outcome = await runWithRequestBudget(
      request.signal,
      HISTORY_REQUEST_TIMEOUT_MS,
      (signal) => getStateSpendingHistory({ signal }),
    );
    if (outcome.timedOut) {
      return unavailable("Lo storico OpenBDAP ha superato il tempo massimo.", 504, "10");
    }
    const history = outcome.value;

    return NextResponse.json(
      {
        ok: true,
        source: {
          owner: "Ragioneria Generale dello Stato",
          platform: "OpenBDAP",
          semantics: "cumulative-from-january",
        },
        ...history,
      },
      {
        headers: {
          "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=21600",
        },
      },
    );
  } catch (error) {
    if (request.signal.aborted) throw error;
    return NextResponse.json(
      {
        ok: false,
        source: "RGS / OpenBDAP",
        observedAt: new Date().toISOString(),
        error: error instanceof Error ? error.message : "Errore sconosciuto",
      },
      { status: 503 },
    );
  } finally {
    release();
  }
}
