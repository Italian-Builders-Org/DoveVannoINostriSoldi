import { NextRequest, NextResponse } from "next/server";
import { parliamentSnapshot } from "@/lib/parliament-snapshot";

export const dynamic = "force-dynamic";

export function GET(request: NextRequest) {
  const chamberId = request.nextUrl.searchParams.get("ramo")?.trim().toLowerCase();
  const rawYear = request.nextUrl.searchParams.get("anno")?.trim();
  const year = rawYear && /^\d{4}$/.test(rawYear) ? Number.parseInt(rawYear, 10) : null;

  if (chamberId && chamberId !== "camera" && chamberId !== "senato") {
    return NextResponse.json(
      { ok: false, error: "La camera richiesta deve essere camera o senato." },
      { status: 400 },
    );
  }
  if (rawYear && year === null) {
    return NextResponse.json(
      { ok: false, error: "L'anno richiesto non è valido." },
      { status: 400 },
    );
  }

  const chambers = parliamentSnapshot.chambers
    .filter((chamber) => !chamberId || chamber.id === chamberId)
    .map((chamber) => ({
      ...chamber,
      statements: chamber.statements.filter((statement) => year === null || statement.year === year),
    }))
    .filter((chamber) => chamber.statements.length > 0);

  if (chambers.length === 0) {
    return NextResponse.json(
      {
        ok: false,
        error: "Nessun documento parlamentare disponibile per i filtri richiesti.",
        available: parliamentSnapshot.chambers.map((chamber) => ({
          chamber: chamber.id,
          years: [...new Set(chamber.statements.map((statement) => statement.year))].sort(),
        })),
      },
      { status: 404 },
    );
  }

  return NextResponse.json(
    {
      ok: true,
      observedAt: parliamentSnapshot.observedAt,
      unit: parliamentSnapshot.unit,
      rounding: parliamentSnapshot.rounding,
      chambers,
      methodology: parliamentSnapshot.methodology,
    },
    { headers: { "Cache-Control": "public, s-maxage=21600, stale-while-revalidate=86400" } },
  );
}
