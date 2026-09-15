import type { NextRequest } from "next/server";
import { queryEurostatGovMain } from "@/lib/eurostat-gov-main-snapshot";

const CACHE_CONTROL = "public, max-age=3600, stale-while-revalidate=86400";

function parseYear(value: string | null): number | undefined {
  if (value === null) return undefined;
  if (!/^\d{4}$/.test(value)) return NaN;
  const year = Number(value);
  return Number.isSafeInteger(year) ? year : NaN;
}

function parseItem(value: string | null): string | undefined | null {
  if (value === null) return undefined;
  // Codici na_item Eurostat: lettere, cifre e underscore (TR, D41PAY, P11_P12_P131).
  if (!/^[A-Za-z0-9_]{2,16}$/.test(value)) return null;
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

  const naItem = parseItem(params.get("voce"));
  if (naItem === null) {
    return Response.json(
      { error: "Il parametro voce accetta un codice na_item Eurostat, per esempio TR, TE, B9 o D41PAY." },
      { status: 400 },
    );
  }

  // Coerente con /api/spese/cofog: la serie completa non viene servita in
  // un'unica risposta non delimitata.
  if (year === undefined && naItem === undefined) {
    return Response.json(
      { error: "Specificare almeno un filtro fra anno e voce: la serie completa non viene servita in un'unica risposta." },
      { status: 400 },
    );
  }

  try {
    return Response.json(queryEurostatGovMain({ year, naItem }), {
      headers: { "Cache-Control": CACHE_CONTROL },
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Richiesta non valida." },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
}
