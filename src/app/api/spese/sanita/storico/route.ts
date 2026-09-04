import { NextResponse } from "next/server";
import { getSsnNationalHistory } from "@/lib/ssn-national-history";

export const dynamic = "force-dynamic";
// The adapter's 50s global deadline leaves a small serialization/framework margin.
export const maxDuration = 60;

export async function GET(request: Request) {
  try {
    const history = await getSsnNationalHistory({ signal: request.signal });

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
          "Cache-Control": "public, s-maxage=21600, stale-while-revalidate=86400",
        },
      },
    );
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        source: "RGS / OpenBDAP",
        observedAt: new Date().toISOString(),
        error: error instanceof Error ? error.message : "Errore sconosciuto",
      },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
