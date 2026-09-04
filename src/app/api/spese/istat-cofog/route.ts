import type { NextRequest } from "next/server";
import { queryIstatCofog } from "@/lib/istat-cofog-snapshot";

const CACHE_CONTROL = "public, max-age=3600, stale-while-revalidate=86400";

function parseYear(value: string | null): number | undefined {
  if (value === null) return undefined;
  if (!/^\d{4}$/.test(value)) return NaN;
  const year = Number(value);
  return Number.isSafeInteger(year) ? year : NaN;
}

function parseTerritory(value: string | null): string | undefined | null {
  if (value === null) return undefined;
  if (!/^[A-Za-z0-9]{2,8}$/.test(value)) return null;
  return value;
}

function parseFunction(value: string | null): string | undefined | null {
  if (value === null) return undefined;
  // Il totale ufficiale è "G" (una sola lettera); le divisioni sono G010…G100.
  if (!/^(G|G(?:0[1-9]0|100))$/i.test(value)) return null;
  return value.toUpperCase();
}

export function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;

  const year = parseYear(params.get("anno"));
  if (Number.isNaN(year)) {
    return Response.json({ error: "Il parametro anno deve essere un anno a quattro cifre." }, { status: 400 });
  }

  const area = parseTerritory(params.get("territorio"));
  if (area === null) {
    return Response.json(
      { error: "Il parametro territorio accetta un codice ISTAT, per esempio IT, ITF3 o ITCDE." },
      { status: 400 },
    );
  }

  const cofogFunction = parseFunction(params.get("funzione"));
  if (cofogFunction === null) {
    return Response.json(
      { error: "Il parametro funzione accetta G oppure una divisione COFOG da G010 a G100." },
      { status: 400 },
    );
  }

  // Senza filtri la risposta sarebbe l'intera serie di 10208 osservazioni: la
  // superficie resta limitata per contratto e si rifiuta invece di servirla.
  if (area === undefined && year === undefined && cofogFunction === undefined) {
    return Response.json(
      {
        error:
          "Specificare almeno un filtro fra territorio, anno e funzione: la serie completa non viene servita in un'unica risposta.",
      },
      { status: 400 },
    );
  }

  try {
    return Response.json(queryIstatCofog({ area, year, function: cofogFunction }), {
      headers: { "Cache-Control": CACHE_CONTROL },
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Richiesta non valida." },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
}
