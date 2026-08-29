import { NextResponse, type NextRequest } from "next/server.js";
import { BudgetLawInvalidWindowError, getBudgetLawMissionSeries } from "@/lib/bdap-legge-bilancio";

export const dynamic = "force-dynamic";

const ALLOWED_PARAMS = new Set(["anni"]);

class InvalidQueryError extends Error {}

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

  try {
    const series = await getBudgetLawMissionSeries({
      windowYears,
      signal: request.signal,
    });

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
  }
}
