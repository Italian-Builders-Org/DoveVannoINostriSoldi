import type { NextRequest } from "next/server";
import { queryInpsCivilInvalidity } from "@/lib/inps-invalidity-snapshot";

export function GET(request: NextRequest) {
  const yearValue = request.nextUrl.searchParams.get("anno");
  const year = yearValue === null ? undefined : Number.parseInt(yearValue, 10);
  const region = request.nextUrl.searchParams.get("regione") ?? undefined;

  if (yearValue !== null && (!Number.isInteger(year) || yearValue !== String(year))) {
    return Response.json({ error: "Il parametro anno deve essere un intero." }, { status: 400 });
  }

  try {
    return Response.json(queryInpsCivilInvalidity({ year, region }), {
      headers: { "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400" },
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Richiesta non valida." },
      { status: 400 },
    );
  }
}
