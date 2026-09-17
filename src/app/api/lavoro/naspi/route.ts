import type { NextRequest } from "next/server";
import { queryInpsNaspi } from "@/lib/inps-naspi-snapshot";

const CACHE_CONTROL = "public, max-age=3600, stale-while-revalidate=86400";

function parseYear(value: string | null): number | undefined {
  if (value === null) return undefined;
  if (!/^\d{4}$/.test(value)) return NaN;
  const year = Number(value);
  return Number.isSafeInteger(year) ? year : NaN;
}

function parseToken(value: string | null, pattern: RegExp): string | undefined | null {
  if (value === null) return undefined;
  return pattern.test(value) ? value : null;
}

export function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;

  const year = parseYear(params.get("anno"));
  if (Number.isNaN(year)) {
    return Response.json({ error: "Il parametro anno deve essere un anno a quattro cifre." }, { status: 400 });
  }

  const table = parseToken(params.get("tabella"), /^[A-Za-z_0-9]{3,40}$/);
  if (table === null) {
    return Response.json(
      { error: "Il parametro tabella accetta un id pubblicato, per esempio beneficiari_02." },
      { status: 400 },
    );
  }

  const measure = parseToken(params.get("misura"), /^[A-Za-z]{3,20}$/);
  if (measure === null) {
    return Response.json(
      { error: "Il parametro misura accetta beneficiari oppure trattamenti." },
      { status: 400 },
    );
  }

  const territory = parseToken(params.get("territorio"), /^[A-Za-z0-9]{2,8}$/);
  if (territory === null) {
    return Response.json(
      { error: "Il parametro territorio accetta un codice ISTAT, per esempio ITF3." },
      { status: 400 },
    );
  }

  // Senza filtri la risposta sarebbe l'intera serie di 53.362 osservazioni: la
  // superficie resta limitata per contratto e si rifiuta invece di servirla.
  if (table === undefined && measure === undefined && year === undefined && territory === undefined) {
    return Response.json(
      {
        error:
          "Specificare almeno un filtro fra tabella, misura, anno e territorio: la serie completa non viene servita in un'unica risposta.",
      },
      { status: 400 },
    );
  }

  try {
    return Response.json(queryInpsNaspi({ table, measure, year, territory }), {
      headers: { "Cache-Control": CACHE_CONTROL },
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Richiesta non valida." },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
}
