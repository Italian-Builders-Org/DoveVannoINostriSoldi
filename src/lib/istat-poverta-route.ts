import type { NextRequest } from "next/server";
import type { IstatPovertaQuery, IstatPovertaQueryResult } from "@/lib/istat-poverta-query";

/**
 * Handler condiviso delle due rotte di povertà.
 *
 * La validazione dei parametri è identica per assoluta e relativa: duplicarla
 * significherebbe che una delle due, prima o poi, accetta ciò che l'altra rifiuta.
 */

const CACHE_CONTROL = "public, max-age=3600, stale-while-revalidate=86400";

function parseYear(value: string | null): number | undefined {
  if (value === null) return undefined;
  if (!/^\d{4}$/.test(value)) return NaN;
  const year = Number(value);
  return Number.isSafeInteger(year) ? year : NaN;
}

function parseTerritory(value: string | null): string | undefined | null {
  if (value === null) return undefined;
  // Accetta la forma di un codice ISTAT, comprese le regioni: chi chiede ITC1 si
  // merita di sapere che il dettaglio regionale qui non esiste, non un generico
  // "parametro malformato".
  if (!/^[A-Za-z0-9]{2,8}$/.test(value)) return null;
  return value;
}

function parseMeasure(value: string | null): string | undefined | null {
  if (value === null) return undefined;
  if (!/^[A-Za-z_]{3,24}$/.test(value)) return null;
  return value;
}

export function createPovertaRouteHandler(query: (input?: IstatPovertaQuery) => IstatPovertaQueryResult) {
  return function GET(request: NextRequest) {
    const params = request.nextUrl.searchParams;

    const year = parseYear(params.get("anno"));
    if (Number.isNaN(year)) {
      return Response.json({ error: "Il parametro anno deve essere un anno a quattro cifre." }, { status: 400 });
    }

    const territory = parseTerritory(params.get("territorio"));
    if (territory === null) {
      return Response.json(
        { error: "Il parametro territorio accetta un codice ISTAT, per esempio IT, ITC o ITFG." },
        { status: 400 },
      );
    }

    const measure = parseMeasure(params.get("misura"));
    if (measure === null) {
      return Response.json(
        { error: "Il parametro misura accetta un codice ISTAT, per esempio INCID_POVASS_FAM." },
        { status: 400 },
      );
    }

    // Senza filtri la risposta sarebbe l'intera serie: la superficie resta
    // limitata per contratto e si rifiuta invece di servirla.
    if (territory === undefined && year === undefined && measure === undefined) {
      return Response.json(
        {
          error:
            "Specificare almeno un filtro fra territorio, anno e misura: la serie completa non viene servita in un'unica risposta.",
        },
        { status: 400 },
      );
    }

    try {
      return Response.json(query({ territory, year, measure }), {
        headers: { "Cache-Control": CACHE_CONTROL },
      });
    } catch (error) {
      return Response.json(
        { error: error instanceof Error ? error.message : "Richiesta non valida." },
        { status: 400, headers: { "Cache-Control": "no-store" } },
      );
    }
  };
}
