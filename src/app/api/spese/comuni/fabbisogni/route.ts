import { NextRequest, NextResponse } from "next/server";
import { openCivitasSnapshot } from "@/lib/opencivitas-snapshot";

export const revalidate = 86_400;

const SORT_FIELDS = {
  codice: "istatCode",
  differenza: "differenceCents",
  "per-abitante": "differencePerCapitaCents",
  percentuale: "differenceBasisPoints",
  servizi: "serviceDifferenceBasisPoints",
} as const;

function boundedInteger(raw: string | null, fallback: number, minimum: number, maximum: number): number {
  if (!raw) return fallback;
  if (!/^\d+$/.test(raw)) return fallback;
  const value = Number.parseInt(raw, 10);
  return Number.isInteger(value) ? Math.min(maximum, Math.max(minimum, value)) : fallback;
}

export function GET(request: NextRequest) {
  const year = request.nextUrl.searchParams.get("anno");
  if (year && year !== String(openCivitasSnapshot.referenceYear)) {
    return NextResponse.json(
      {
        ok: false,
        error: `OpenCivitas è integrata per il ${openCivitasSnapshot.referenceYear}.`,
        availableYears: [openCivitasSnapshot.referenceYear],
      },
      { status: 400 },
    );
  }

  const istatCode = request.nextUrl.searchParams.get("codiceIstat")?.trim();
  const region = request.nextUrl.searchParams.get("regione")?.trim().toLocaleUpperCase("it-IT");
  const sortKey = request.nextUrl.searchParams.get("ordine") ?? "codice";
  const sortField = SORT_FIELDS[sortKey as keyof typeof SORT_FIELDS] ?? SORT_FIELDS.codice;
  const descending = request.nextUrl.searchParams.get("direzione") === "desc";
  const limit = boundedInteger(request.nextUrl.searchParams.get("limite"), istatCode ? 1 : 100, 1, 500);
  const offset = boundedInteger(request.nextUrl.searchParams.get("offset"), 0, 0, 100_000);

  let municipalities = openCivitasSnapshot.municipalities.filter((item) => {
    if (istatCode && item.istatCode !== istatCode) return false;
    if (region && item.region !== region) return false;
    return true;
  });
  municipalities = [...municipalities].sort((left, right) => {
    const leftValue = left[sortField];
    const rightValue = right[sortField];
    if (leftValue === null && rightValue === null) return left.istatCode.localeCompare(right.istatCode);
    if (leftValue === null) return 1;
    if (rightValue === null) return -1;
    const comparison = typeof leftValue === "string"
      ? leftValue.localeCompare(rightValue as string)
      : leftValue - (rightValue as number);
    return descending ? -comparison : comparison;
  });

  const total = municipalities.length;
  const page = municipalities.slice(offset, offset + limit);
  return NextResponse.json(
    {
      ok: true,
      availableYears: [openCivitasSnapshot.referenceYear],
      referenceYear: openCivitasSnapshot.referenceYear,
      publishedAt: openCivitasSnapshot.publishedAt,
      filters: { codiceIstat: istatCode ?? null, regione: region ?? null },
      pagination: { total, offset, limit, returned: page.length },
      data: page,
      coverage: openCivitasSnapshot.coverage,
      methodology: openCivitasSnapshot.methodology,
      provenance: openCivitasSnapshot.source,
    },
    { headers: { "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=604800" } },
  );
}
