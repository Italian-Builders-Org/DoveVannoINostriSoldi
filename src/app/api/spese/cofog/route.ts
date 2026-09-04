import type { NextRequest } from "next/server";
import { queryEurostatCofog } from "@/lib/eurostat-cofog-snapshot";

const CACHE_CONTROL = "public, max-age=3600, stale-while-revalidate=86400";

function parseYear(value: string | null): number | undefined {
  if (value === null) return undefined;
  if (!/^\d{4}$/.test(value)) return NaN;
  const year = Number(value);
  return Number.isSafeInteger(year) ? year : NaN;
}

function parseCode(value: string | null): string | undefined | null {
  if (value === null) return undefined;
  // Codici Eurostat: lettere, cifre e underscore (EU27_2020, IT, GF07).
  if (!/^[A-Za-z0-9_]{2,12}$/.test(value)) return null;
  return value;
}

export function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;

  const year = parseYear(params.get("anno"));
  if (Number.isNaN(year)) {
    return Response.json(
      { error: "Il parametro anno deve essere un anno a quattro cifre." },
      { status: 400 },
    );
  }

  const geo = parseCode(params.get("paese"));
  if (geo === null) {
    return Response.json(
      { error: "Il parametro paese accetta un codice Eurostat, per esempio IT o EU27_2020." },
      { status: 400 },
    );
  }

  const cofogFunction = parseCode(params.get("funzione"));
  if (cofogFunction === null) {
    return Response.json(
      { error: "Il parametro funzione accetta TOTAL oppure una divisione COFOG da GF01 a GF10." },
      { status: 400 },
    );
  }

  // Una richiesta senza filtri restituirebbe tutte e 4114 le osservazioni: la
  // superficie resta limitata per contratto, quindi si rifiuta invece di
  // servire un payload non delimitato.
  if (geo === undefined && year === undefined && cofogFunction === undefined) {
    return Response.json(
      {
        error:
          "Specificare almeno un filtro fra paese, anno e funzione: la serie completa non viene servita in un'unica risposta.",
      },
      { status: 400 },
    );
  }

  try {
    return Response.json(queryEurostatCofog({ geo, year, function: cofogFunction }), {
      headers: { "Cache-Control": CACHE_CONTROL },
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Richiesta non valida." },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
}
