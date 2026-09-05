import type { NextRequest } from "next/server";
import { queryMefIrpefDettaglio } from "@/lib/mef-irpef-dettaglio-snapshot";

const CACHE_CONTROL = "public, max-age=3600, stale-while-revalidate=86400";

function parseYear(value: string | null): number | undefined {
  if (value === null) return undefined;
  if (!/^\d{4}$/.test(value)) return NaN;
  const year = Number(value);
  return Number.isSafeInteger(year) ? year : NaN;
}

function parseToken(value: string | null): string | undefined | null {
  if (value === null) return undefined;
  return /^[A-Za-z_]{3,20}$/.test(value) ? value : null;
}

export function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const allowed = new Set(["anno", "famiglia", "taglio", "limit", "offset"]);
  for (const key of params.keys()) {
    if (!allowed.has(key) || params.getAll(key).length !== 1) {
      return Response.json({ error: `Parametro sconosciuto o ripetuto: ${key}.` }, { status: 400, headers: { "Cache-Control": "no-store" } });
    }
  }
  for (const key of ["limit", "offset"]) {
    const value = params.get(key);
    if (value !== null && !/^(0|[1-9]\d*)$/.test(value)) return Response.json({ error: `Parametro ${key} non canonico.` }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
  const limit = params.has("limit") ? Number(params.get("limit")) : undefined;
  const offset = params.has("offset") ? Number(params.get("offset")) : undefined;

  const year = parseYear(params.get("anno"));
  if (Number.isNaN(year)) {
    return Response.json({ error: "Il parametro anno deve essere un anno di dichiarazione a quattro cifre." }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }

  const family = parseToken(params.get("famiglia"));
  if (family === null) {
    return Response.json(
      { error: "Il parametro famiglia accetta tipo_reddito, calcolo_irpef oppure bonus_irpef." },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  const breakdown = parseToken(params.get("taglio"));
  if (breakdown === null) {
    return Response.json(
      { error: "Il parametro taglio accetta regione, classeEta oppure sesso." },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  // Senza filtri la risposta sarebbe l'intera serie: 79 tabelle e 25.534 righe.
  // La superficie resta limitata per contratto e si rifiuta invece di servirla.
  if (family === undefined && breakdown === undefined && year === undefined) {
    return Response.json(
      {
        error:
          "Specificare almeno un filtro fra famiglia, taglio e anno: la serie completa non viene servita in un'unica risposta.",
      },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  try {
    return Response.json(queryMefIrpefDettaglio({ family, breakdown, year, limit, offset }), {
      headers: { "Cache-Control": CACHE_CONTROL },
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Richiesta non valida." },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
}
