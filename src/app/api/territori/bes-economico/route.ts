import type { NextRequest } from "next/server";
import { queryIstatBes } from "@/lib/istat-bes-snapshot";

const CACHE_CONTROL = "public, max-age=3600, stale-while-revalidate=86400";

function parseYear(value: string | null): number | undefined {
  if (value === null) return undefined;
  if (!/^\d{4}$/.test(value)) return NaN;
  const year = Number(value);
  return Number.isSafeInteger(year) ? year : NaN;
}

function parseToken(value: string | null, pattern: RegExp): string | undefined | null {
  if (value === null) return undefined;
  if (!pattern.test(value)) return null;
  return value;
}

export function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;

  const year = parseYear(params.get("anno"));
  if (Number.isNaN(year)) {
    return Response.json({ error: "Il parametro anno deve essere un anno a quattro cifre." }, { status: 400 });
  }

  const territory = parseToken(params.get("territorio"), /^[A-Za-z0-9]{2,6}$/);
  if (territory === null) {
    return Response.json(
      { error: "Il parametro territorio accetta un codice ISTAT, per esempio IT, ITC1 o ITC11." },
      { status: 400 },
    );
  }

  const indicator = parseToken(params.get("indicatore"), /^[A-Za-z0-9]{6,12}$/);
  if (indicator === null) {
    return Response.json(
      { error: "Il parametro indicatore accetta un codice BES, per esempio 04BEC002P." },
      { status: 400 },
    );
  }

  const sex = parseToken(params.get("sesso"), /^[FMTfmt]$/);
  if (sex === null) {
    return Response.json({ error: "Il parametro sesso accetta F, M oppure T." }, { status: 400 });
  }

  // Senza filtri la risposta sarebbe l'intera serie di 19.592 osservazioni.
  if (territory === undefined && year === undefined && indicator === undefined && sex === undefined) {
    return Response.json(
      {
        error:
          "Specificare almeno un filtro fra territorio, anno, indicatore e sesso: la serie completa non viene servita in un'unica risposta.",
      },
      { status: 400 },
    );
  }

  try {
    return Response.json(queryIstatBes({ territory, year, indicator, sex }), {
      headers: { "Cache-Control": CACHE_CONTROL },
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Richiesta non valida." },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
}
