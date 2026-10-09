import type { NextRequest } from "next/server";
import { queryInpsCasellarioSistema } from "@/lib/inps-casellario-sistema-snapshot";
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
  const params = request.nextUrl.searchParams;
  for (const key of params.keys()) {
    if (!["anno", "territorio"].includes(key) || params.getAll(key).length !== 1) {
      return Response.json({ error: `Parametro sconosciuto o ripetuto: ${key}.` },
        { status: 400, headers: { "Cache-Control": "no-store" } });
    }
  }
  const year = parseYear(params.get("anno"));
  const territoryValue = params.get("territorio");
  if (territoryValue !== null && !/^[A-Za-z0-9]{2,6}$/.test(territoryValue)) {
    return Response.json(
      { error: "Il parametro territorio accetta un codice ISTAT, per esempio IT, ITF3 o ITF33." },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  if (Number.isNaN(year)) {
    return Response.json(
      { error: "Il parametro anno deve essere un anno a quattro cifre." },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  try {
    const istat = queryIstatPensions({ year, territory: territoryValue ?? undefined });
    const national = istat.territory === "IT";
    return Response.json({
      ...istat,
      inpsOsservatorio: national ? queryInpsPensionsOsservatorio() : null,
      inpsCasellarioSistema: national ? queryInpsCasellarioSistema() : null,
      ...(national ? {} : {
        inpsOsservatorioNote: "L’Osservatorio INPS non è disponibile con filtro territoriale in questo endpoint.",
        inpsCasellarioSistemaNote: "Il Casellario INPS di sistema è solo nazionale in questo endpoint.",
      }),
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
