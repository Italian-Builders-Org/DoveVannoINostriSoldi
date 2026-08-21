import { NextRequest, NextResponse } from "next/server";
import {
  getStateSpendingSnapshot,
  StatePaymentPeriodUnavailableError,
} from "@/lib/bdap-payments";
import { parseReferencePeriod } from "@/lib/data/reference-period";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const requestedPeriod = parseReferencePeriod(request.nextUrl.searchParams);
  if (!requestedPeriod.ok) {
    return NextResponse.json(
      { ok: false, error: requestedPeriod.error },
      { status: 400 },
    );
  }

  try {
    const snapshot = await getStateSpendingSnapshot(requestedPeriod.value);

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
  }
}
