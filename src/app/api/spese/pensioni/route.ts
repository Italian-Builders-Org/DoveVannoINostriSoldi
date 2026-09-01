import type { NextRequest } from "next/server";
import { queryInpsPensionsOsservatorio } from "@/lib/inps-pensions-snapshot";
import { queryIstatPensions } from "@/lib/istat-pensions-snapshot";

const CACHE_CONTROL = "public, max-age=3600, stale-while-revalidate=86400";

function parseYear(value: string | null): number | undefined {
  if (value === null) return undefined;
  if (!/^\d{4}$/.test(value)) return NaN;
  const year = Number(value);
  return Number.isSafeInteger(year) ? year : NaN;
}

export function GET(request: NextRequest) {
  const yearValue = request.nextUrl.searchParams.get("anno");
  const year = parseYear(yearValue);

  if (Number.isNaN(year)) {
    return Response.json(
      { error: "Il parametro anno deve essere un anno a quattro cifre." },
      { status: 400 },
    );
  }

  try {
    return Response.json({
      ...queryIstatPensions({ year }),
      inpsOsservatorio: queryInpsPensionsOsservatorio(),
    }, {
      headers: { "Cache-Control": CACHE_CONTROL },
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Richiesta non valida." },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
}
