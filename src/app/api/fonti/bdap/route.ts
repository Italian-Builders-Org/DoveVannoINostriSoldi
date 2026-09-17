import { NextResponse } from "next/server";

const BDAP_PACKAGE_LIST =
  "https://bdap-opendata.rgs.mef.gov.it/SpodCkanApi/api/3/action/package_list";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const startedAt = Date.now();
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(8_000)]);

  try {
    const response = await fetch(BDAP_PACKAGE_LIST, {
      headers: {
        Accept: "application/json",
        "User-Agent": "DoveVannoINostriSoldi/0.1 (+https://github.com/Italian-Builders-Org/DoveVannoINostriSoldi)",
      },
      next: { revalidate: 3600 },
      signal,
    });

    if (!response.ok) {
      return NextResponse.json(
        {
          ok: false,
          source: "OpenBDAP",
          upstreamStatus: response.status,
          observedAt: new Date().toISOString(),
        },
        { status: 502 },
      );
    }

    const payload: unknown = await response.json();

    return NextResponse.json({
      ok: true,
      source: "OpenBDAP",
      sourceUrl: BDAP_PACKAGE_LIST,
      observedAt: new Date().toISOString(),
      latencyMs: Date.now() - startedAt,
      payload,
    });
  } catch (error) {
    if (request.signal.aborted) throw error;
    return NextResponse.json(
      {
        ok: false,
        source: "OpenBDAP",
        observedAt: new Date().toISOString(),
        error: error instanceof Error ? error.message : "Errore sconosciuto",
      },
      { status: 503 },
    );
  }
}
