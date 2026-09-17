import type { NextRequest } from "next/server";
import { queryIstatEpea } from "@/lib/istat-epea-snapshot";

const CACHE_CONTROL = "public, max-age=3600, stale-while-revalidate=86400";

function parseYear(value: string | null): number | undefined {
  if (value === null) return undefined;
  if (!/^\d{4}$/.test(value)) return NaN;
  const year = Number(value);
  return Number.isSafeInteger(year) ? year : NaN;
}

function parseToken(value: string | null): string | undefined | null {
  if (value === null) return undefined;
  const trimmed = value.trim();
  if (!/^[A-Za-z0-9_]{2,16}$/.test(trimmed)) return null;
  return trimmed;
}

export function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;

  const year = parseYear(params.get("anno"));
  if (Number.isNaN(year)) {
    return Response.json({ error: "Il parametro anno deve essere un anno a quattro cifre." }, { status: 400 });
  }

  const sector = parseToken(params.get("settore"));
  if (sector === null) {
    return Response.json(
      { error: "Il parametro settore accetta un codice istituzionale EPEA, per esempio S13_15." },
      { status: 400 },
    );
  }

  const cepa = parseToken(params.get("cepa"));
  if (cepa === null) {
    return Response.json(
      { error: "Il parametro cepa accetta una classe CEPA, per esempio CEPA1 o TOT_CEPA." },
      { status: 400 },
    );
  }

  if (year === undefined && sector === undefined && cepa === undefined) {
    return Response.json(
      {
        error:
          "Specificare almeno un filtro fra anno, settore e cepa: la serie completa non viene servita in un'unica risposta.",
      },
      { status: 400 },
    );
  }

  try {
    return Response.json(queryIstatEpea({ year, sector, cepa }), {
      headers: { "Cache-Control": CACHE_CONTROL },
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Richiesta non valida." },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
}
