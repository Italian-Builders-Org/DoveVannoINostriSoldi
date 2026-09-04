import { NextResponse } from "next/server";
import { getCachedLegislatureSpendingCycles } from "@/lib/data/cached-live-views";
import { ConcurrencyLimiter, SlidingWindowLimiter, clientAddress } from "@/lib/report/rate-limit";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const legislatureLimiter = new SlidingWindowLimiter({ windowMs: 60_000, max: 6 });
const legislatureConcurrency = new ConcurrencyLimiter(1);

export async function GET(request: Request) {
  const clientKey = clientAddress(request) ?? "unknown";
  if (!legislatureLimiter.consume(clientKey)) {
    return NextResponse.json(
      { ok: false, source: "RGS / OpenBDAP", error: "Troppe richieste per la serie per legislature." },
      { status: 429, headers: { "Cache-Control": "private, no-store", "Retry-After": "60" } },
    );
  }

  const release = legislatureConcurrency.tryAcquire();
  if (!release) {
    return NextResponse.json(
      { ok: false, source: "RGS / OpenBDAP", error: "Serie per legislature temporaneamente occupata." },
      { status: 503, headers: { "Cache-Control": "private, no-store", "Retry-After": "5" } },
    );
  }

  try {
    const cycles = await getCachedLegislatureSpendingCycles();

    return NextResponse.json(
      {
        ok: true,
        source: {
          spending: {
            owner: "Ragioneria Generale dello Stato",
            platform: "OpenBDAP",
            cadence: "consuntivo annuale",
          },
          elections: {
            owner: "Camera dei Deputati / Ministero dell'Interno",
            cadence: "una tantum, per legislatura",
          },
        },
        methodology:
          "Confronto puramente descrittivo tra l'anno pre-elettorale e la media degli altri anni completi della stessa legislatura. Non è un test di significatività statistica, non implica causalità o intento elettorale e riguarda solo la spesa statale nazionale.",
        cycles,
      },
      {
        headers: {
          "Cache-Control": "public, s-maxage=21600, stale-while-revalidate=3600",
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
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  } finally {
    release();
  }
}
