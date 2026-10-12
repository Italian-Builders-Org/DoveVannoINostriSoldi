import type { NextRequest } from "next/server";
import {
  consulentiRegionaliSnapshot,
  getConsulentiRegionaliYear,
} from "@/lib/consulenti-regionali-snapshot";

const CACHE_CONTROL = "public, s-maxage=21600, stale-while-revalidate=86400";

function invalid(message: string) {
  return Response.json(
    { ok: false, error: message },
    { status: 400, headers: { "Cache-Control": "no-store" } },
  );
}

export function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  for (const key of params.keys()) {
    if (key !== "anno" || params.getAll(key).length !== 1) {
      return invalid(`Parametro sconosciuto o ripetuto: ${key}.`);
    }
  }
  const anno = params.get("anno");
  let year: number | undefined;
  if (anno !== null) {
    if (!/^\d{4}$/.test(anno)) {
      return invalid("Il parametro anno richiede quattro cifre.");
    }
    year = Number(anno);
    if (!consulentiRegionaliSnapshot.years.some((item) => item.year === year)) {
      return invalid(
        `Anno ${year} assente. Disponibili: ${consulentiRegionaliSnapshot.years
          .map((item) => item.year)
          .join(", ")}.`,
      );
    }
  }

  const selected = getConsulentiRegionaliYear(year);
  return Response.json(
    {
      ok: true,
      source: consulentiRegionaliSnapshot.provenance.dataset,
      observedAt: consulentiRegionaliSnapshot.provenance.observedAt,
      latestYear: consulentiRegionaliSnapshot.latestYear,
      selectedYear: selected.year,
      soldi: consulentiRegionaliSnapshot.soldi,
      periodo: consulentiRegionaliSnapshot.periodo,
      data: selected,
      years: consulentiRegionaliSnapshot.years.map((item) => ({
        year: item.year,
        territoryCount: item.territoryCount,
        assignments: item.assignments,
        paidCents: item.paidCents,
      })),
      methodology: consulentiRegionaliSnapshot.methodology,
      provenance: consulentiRegionaliSnapshot.provenance,
    },
    { headers: { "Cache-Control": CACHE_CONTROL } },
  );
}
