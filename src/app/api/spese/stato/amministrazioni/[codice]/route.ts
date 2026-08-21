import { NextRequest, NextResponse } from "next/server";
import {
  getStateAdministrationSpending,
  StateAdministrationNotFoundError,
  StatePaymentPeriodUnavailableError,
} from "@/lib/bdap-payments";
import { parseReferencePeriod } from "@/lib/data/reference-period";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ codice: string }> };

export async function GET(request: NextRequest, context: RouteContext) {
  const requestedPeriod = parseReferencePeriod(request.nextUrl.searchParams);
  if (!requestedPeriod.ok) {
    return NextResponse.json(
      { ok: false, error: requestedPeriod.error },
      { status: 400 },
    );
  }

  const { codice } = await context.params;

  try {
    const spending = await getStateAdministrationSpending(
      decodeURIComponent(codice),
      requestedPeriod.value,
    );

    return NextResponse.json(
      {
        ok: true,
        source: {
          owner: "Ragioneria Generale dello Stato",
          platform: "OpenBDAP",
          cadence: "rilasci mensili e consuntivi annuali",
          normalization: "DoveVannoINostriSoldi",
        },
        scope:
          spending.period.releaseKind === "consuntivo"
            ? "Pagamenti del consuntivo annuale dell'esercizio indicato."
            : "Pagamenti cumulati dall'inizio dell'anno al mese indicato.",
        ...spending,
      },
      {
        headers: {
          "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=21600",
        },
      },
    );
  } catch (error) {
    const notFound =
      error instanceof StateAdministrationNotFoundError ||
      error instanceof StatePaymentPeriodUnavailableError;

    return NextResponse.json(
      {
        ok: false,
        source: "RGS / OpenBDAP",
        observedAt: new Date().toISOString(),
        error: error instanceof Error ? error.message : "Errore sconosciuto",
      },
      { status: notFound ? 404 : 503 },
    );
  }
}
