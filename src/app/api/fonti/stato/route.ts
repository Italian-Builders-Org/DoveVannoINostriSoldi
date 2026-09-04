import { NextResponse } from "next/server";
import { getCachedSourceHealthOverview } from "@/lib/data/cached-live-views";
import { ConcurrencyLimiter } from "@/lib/report/rate-limit";
import { runWithRequestBudget } from "@/lib/search/request-budget";

export const dynamic = "force-dynamic";
export const maxDuration = 10;

const SOURCE_HEALTH_REQUEST_TIMEOUT_MS = 6_000;
const sourceHealthConcurrency = new ConcurrencyLimiter(2);

export async function GET(request: Request) {
  const release = sourceHealthConcurrency.tryAcquire();
  if (!release) {
    return NextResponse.json(
      { ok: false, error: "Controllo delle fonti temporaneamente occupato." },
      { status: 503, headers: { "Cache-Control": "private, no-store", "Retry-After": "5" } },
    );
  }

  try {
    const outcome = await runWithRequestBudget(
      request.signal,
      SOURCE_HEALTH_REQUEST_TIMEOUT_MS,
      () => getCachedSourceHealthOverview(),
    );
    if (outcome.timedOut) {
      return NextResponse.json(
        { ok: false, error: "Il controllo delle fonti ha superato il tempo massimo." },
        { status: 504, headers: { "Cache-Control": "private, no-store", "Retry-After": "10" } },
      );
    }
    const { checkedAt, sources } = outcome.value;

    return NextResponse.json({
      ok: true,
      observedAt: checkedAt,
      summary: {
        total: sources.length,
        active: sources.filter((source) => source.integration === "active").length,
        reachable: sources.filter((source) => source.reachability === "up").length,
        unreachable: sources.filter((source) => source.reachability === "down").length,
        notProbed: sources.filter((source) => source.reachability === "not-probed").length,
      },
      sources,
    });
  } catch (error) {
    if (request.signal.aborted) throw error;
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Errore sconosciuto" },
      { status: 503, headers: { "Cache-Control": "private, no-store" } },
    );
  } finally {
    release();
  }
}
