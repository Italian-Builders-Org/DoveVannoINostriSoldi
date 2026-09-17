import { NextRequest, NextResponse } from "next/server";
import {
  getStateSpendingSnapshot,
  StatePaymentPeriodUnavailableError,
} from "@/lib/bdap-payments";
import { parseReferencePeriod } from "@/lib/data/reference-period";
import { ConcurrencyLimiter } from "@/lib/report/rate-limit";
import { runWithRequestBudget } from "@/lib/search/request-budget";

export const dynamic = "force-dynamic";
export const maxDuration = 15;

const STATE_SPENDING_REQUEST_TIMEOUT_MS = 10_000;
const stateSpendingConcurrency = new ConcurrencyLimiter(3);

function unavailable(message: string, status: number, retryAfter: string): Response {
  return NextResponse.json(
    { ok: false, source: "RGS / OpenBDAP", error: message },
    {
      status,
      headers: { "Cache-Control": "private, no-store", "Retry-After": retryAfter },
    },
  );
}

export async function GET(request: NextRequest) {
  const requestedPeriod = parseReferencePeriod(request.nextUrl.searchParams);
  if (!requestedPeriod.ok) {
    return NextResponse.json(
      { ok: false, error: requestedPeriod.error },
      { status: 400 },
    );
  }

  const release = stateSpendingConcurrency.tryAcquire();
  if (!release) {
    return unavailable("Spesa statale temporaneamente occupata.", 503, "5");
  }

  try {
    const outcome = await runWithRequestBudget(
      request.signal,
      STATE_SPENDING_REQUEST_TIMEOUT_MS,
      (signal) => getStateSpendingSnapshot({ ...requestedPeriod.value, signal }),
    );
    if (outcome.timedOut) {
      return unavailable("La fonte OpenBDAP ha superato il tempo massimo.", 504, "10");
    }
    const snapshot = outcome.value;

    return NextResponse.json(
      {
        ok: true,
        source: {
          owner: "Ragioneria Generale dello Stato",
          platform: "OpenBDAP",
          cadence: "rilasci mensili e consuntivi annuali",
          normalization: "DoveVannoINostriSoldi",
        },
        ...snapshot,
      },
      {
        headers: {
          "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=21600",
        },
      },
    );
  } catch (error) {
    if (request.signal.aborted) throw error;
    const unavailable = error instanceof StatePaymentPeriodUnavailableError;
    return NextResponse.json(
      {
        ok: false,
        source: "RGS / OpenBDAP",
        observedAt: new Date().toISOString(),
        error: error instanceof Error ? error.message : "Errore sconosciuto",
      },
      { status: unavailable ? 404 : 503 },
    );
  } finally {
    release();
  }
}
