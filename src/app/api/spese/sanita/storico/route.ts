import { NextResponse } from "next/server";
import { getCachedSsnNationalHistory } from "@/lib/data/cached-live-views";
import { ConcurrencyLimiter, SlidingWindowLimiter, clientAddress } from "@/lib/report/rate-limit";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const ssnHistoryLimiter = new SlidingWindowLimiter({ windowMs: 60_000, max: 6 });
const ssnHistoryConcurrency = new ConcurrencyLimiter(1);

export async function GET(request: Request) {
  const clientKey = clientAddress(request) ?? "unknown";
  if (!ssnHistoryLimiter.consume(clientKey)) {
    return NextResponse.json(
      { ok: false, source: "RGS / OpenBDAP", error: "Troppe richieste per lo storico SSN." },
      { status: 429, headers: { "Cache-Control": "private, no-store", "Retry-After": "60" } },
    );
  }

  const release = ssnHistoryConcurrency.tryAcquire();
  if (!release) {
    return NextResponse.json(
      { ok: false, source: "RGS / OpenBDAP", error: "Storico SSN temporaneamente occupato." },
      { status: 503, headers: { "Cache-Control": "private, no-store", "Retry-After": "5" } },
    );
  }

  try {
    const history = await getCachedSsnNationalHistory();

    return NextResponse.json(
      {
        ok: true,
        dataMode: history.dataMode,
        source: {
          owner: history.source.owner,
          platform: history.source.platform,
          landingUrl: history.source.landingUrl,
          cadence: "consuntivo annuale",
          observedAt: history.source.observedAt,
          license: history.source.license,
          licenseUrl: history.source.licenseUrl,
        },
        caveat:
          "Solo livello nazionale: il dettaglio regionale e per ente resta disponibile soltanto per il 2024 in /api/spese/sanita. Voci di competenza economica, non pagamenti di cassa; non identificano gettonisti, cooperative o organico e non permettono classifiche di efficienza tra anni o Regioni.",
        years: history.years,
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
