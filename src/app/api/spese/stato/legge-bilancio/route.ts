import { NextResponse, type NextRequest } from "next/server.js";
import { BudgetLawInvalidWindowError, getBudgetLawMissionSeries } from "@/lib/bdap-legge-bilancio";
import { ConcurrencyLimiter, SlidingWindowLimiter, clientAddress } from "@/lib/report/rate-limit";
import { runWithRequestBudget } from "@/lib/search/request-budget";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 15;

const ALLOWED_PARAMS = new Set(["anni"]);
const BUDGET_LAW_REQUEST_TIMEOUT_MS = 12_000;
const budgetLawLimiter = new SlidingWindowLimiter({ windowMs: 60_000, max: 6 });
const budgetLawConcurrency = new ConcurrencyLimiter(2);

class InvalidQueryError extends Error {}

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

function windowYearsParam(request: NextRequest): number | undefined {
  for (const key of request.nextUrl.searchParams.keys()) {
    if (!ALLOWED_PARAMS.has(key)) throw new InvalidQueryError(`Parametro non supportato: ${key}.`);
  }
  const values = request.nextUrl.searchParams.getAll("anni");
  if (values.length === 0) return undefined;
  if (values.length > 1) throw new InvalidQueryError("Il parametro anni non può essere ripetuto.");
  if (!/^\d+$/.test(values[0])) throw new InvalidQueryError("Il parametro anni deve essere un intero.");
  return Number(values[0]);
}

export async function GET(request: NextRequest) {
  let windowYears: number | undefined;
  try {
    windowYears = windowYearsParam(request);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Richiesta non valida." },
      { status: 400, headers: { "Cache-Control": "private, no-store" } },
    );
  }

  const clientKey = clientAddress(request) ?? "unknown";
  if (!budgetLawLimiter.consume(clientKey)) {
    return unavailable("Troppe richieste per la Legge di Bilancio.", 429, "60");
  }

  const release = budgetLawConcurrency.tryAcquire();
  if (!release) {
    return unavailable("Serie della Legge di Bilancio temporaneamente occupata.", 503, "5");
  }

  try {
    const outcome = await runWithRequestBudget(
      request.signal,
      BUDGET_LAW_REQUEST_TIMEOUT_MS,
      (signal) => getBudgetLawMissionSeries({
        windowYears,
        signal,
      }),
    );
    if (outcome.timedOut) {
      return unavailable("La fonte OpenBDAP ha superato il tempo massimo.", 504, "10");
    }
    const series = outcome.value;

    return NextResponse.json(
      {
        ok: true,
        source: {
          owner: "Ragioneria Generale dello Stato",
          platform: "OpenBDAP",
          semantics: "stanziamento-competenza-legge-bilancio",
        },
        ...series,
      },
      {
        headers: {
          "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=21600",
        },
      },
    );
  } catch (error) {
    if (request.signal.aborted) throw error;
    const status = error instanceof BudgetLawInvalidWindowError ? 400 : 503;
    return NextResponse.json(
      {
        ok: false,
        source: "RGS / OpenBDAP",
        error:
          status === 400
            ? error instanceof Error
              ? error.message
              : "Richiesta non valida."
            : "La fonte OpenBDAP non è disponibile in questo momento.",
      },
      { status, headers: { "Cache-Control": "private, no-store" } },
    );
  } finally {
    release();
  }
}
