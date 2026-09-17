import type { NextRequest } from "next/server";
import { queryCptRegionalFiscal } from "@/lib/cpt-regional-fiscal-snapshot";

export function GET(request: NextRequest) {
  const yearValue = request.nextUrl.searchParams.get("anno");
  const year = yearValue === null ? undefined : Number(yearValue);
  const region = request.nextUrl.searchParams.get("regione") ?? undefined;
  if (yearValue !== null && (!/^\d{4}$/.test(yearValue) || !Number.isInteger(year))) {
    return Response.json({ error: "Il parametro anno deve contenere quattro cifre." }, { status: 400 });
  }
  try {
    return Response.json(queryCptRegionalFiscal({ year, region }), {
      headers: { "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400" },
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Richiesta non valida." },
      { status: 400 },
    );
  }
}
