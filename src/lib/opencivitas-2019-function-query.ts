import "server-only";
import type { NextRequest } from "next/server";
import type { OpenCivitas2019FunctionSnapshot } from "@/lib/data/opencivitas-2019-function-contract";
import { OPENCIVITAS_2019_FUNCTIONS, type OpenCivitas2019FunctionKey } from "@/lib/data/opencivitas-2019-functions";
import { resolveOpenCivitasRegionName } from "@/lib/region-query";

export type OpenCivitas2019FunctionFilters = {
  region?: string;
  code?: string;
  limit?: number;
  offset?: number;
};

// Shared by API and MCP so both surfaces keep the same bounds, errors and caveats.
export function queryOpenCivitas2019Function(
  key: OpenCivitas2019FunctionKey,
  snapshot: OpenCivitas2019FunctionSnapshot,
  filters: OpenCivitas2019FunctionFilters,
) {
  const descriptor = OPENCIVITAS_2019_FUNCTIONS[key];
  const limit = filters.limit ?? 20;
  const offset = filters.offset ?? 0;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    throw new Error("limit deve essere un intero tra 1 e 100.");
  }
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > 100_000) {
    throw new Error("offset deve essere un intero tra 0 e 100000.");
  }
  if (filters.region === undefined && filters.code === undefined) {
    throw new Error(
      `Specificare regione o codice ISTAT Comune: lo snapshot ${descriptor.label} 2019 completo non viene servito in un'unica risposta.`,
    );
  }

  const regionInput = filters.region?.trim();
  if (regionInput !== undefined && !regionInput) {
    throw new Error("La regione non può essere vuota.");
  }
  const region = regionInput ? resolveOpenCivitasRegionName(regionInput) : null;
  if (regionInput && !region) {
    throw new Error(`Regione OpenCivitas non riconosciuta: ${regionInput}.`);
  }
  const code = filters.code?.trim();
  if (code !== undefined && !/^\d{6}$/.test(code)) {
    throw new Error("Il codice ISTAT Comune deve avere sei cifre.");
  }

  const matches = snapshot.municipalities.filter(
    (item) => (!region || item.region === region) && (!code || item.istatCode === code),
  );
  if (region && matches.length === 0 && !code) {
    throw new Error(`Nessun Comune RSO per la regione ${regionInput}.`);
  }
  const page = matches.slice(offset, offset + limit);

  return {
    datasetId: descriptor.datasetId,
    family: descriptor.family,
    function: descriptor.function,
    referenceYear: snapshot.referenceYear,
    publishedAt: snapshot.publishedAt,
    modifiedAt: snapshot.modifiedAt,
    pagination: { total: matches.length, offset, limit, returned: page.length },
    data: page,
    coverage: snapshot.coverage,
    methodology: snapshot.methodology,
    provenance: snapshot.source,
    caveats: [
      `Snapshot distinto da OpenCivitas FC60TOT 2019 (servizi totali) e dalla funzione ${descriptor.label} 2021 e 2022.`,
      "Non sommare né confrontare in silenzio funzioni o annualità diverse.",
      "La differenza spesa storica − spesa standard non è spreco.",
      "RSS e Province autonome sono fuori perimetro.",
      descriptor.exclusionNote,
    ],
  };
}

function parseInteger(value: string | null): number | undefined {
  if (value === null) return undefined;
  if (!/^(0|[1-9]\d*)$/.test(value)) return Number.NaN;
  return Number(value);
}

const CACHE_CONTROL = "public, max-age=3600, stale-while-revalidate=86400";
const ALLOWED_PARAMS = new Set(["anno", "regione", "codice", "limit", "offset"]);

function badRequest(error: string) {
  return Response.json({ error }, { status: 400, headers: { "Cache-Control": "no-store" } });
}

/** GET handler for one static /api/spese/opencivitas-2019-<funzione> route. */
export function createOpenCivitas2019FunctionGet(
  key: OpenCivitas2019FunctionKey,
  query: (filters: OpenCivitas2019FunctionFilters) => ReturnType<typeof queryOpenCivitas2019Function>,
) {
  const descriptor = OPENCIVITAS_2019_FUNCTIONS[key];
  return function GET(request: NextRequest) {
    const params = request.nextUrl.searchParams;
    for (const name of params.keys()) {
      if (!ALLOWED_PARAMS.has(name) || params.getAll(name).length !== 1) {
        return badRequest(`Parametro sconosciuto o ripetuto: ${name}.`);
      }
    }
    const year = params.get("anno");
    if (year !== null && year !== "2019") {
      return badRequest(
        `Questo endpoint serve solo l'annualità 2019 ${descriptor.family}. I servizi totali 2019 restano su /api/spese/opencivitas-2019.`,
      );
    }
    const limit = parseInteger(params.get("limit"));
    const offset = parseInteger(params.get("offset"));
    if (Number.isNaN(limit) || Number.isNaN(offset)) {
      return badRequest("limit e offset devono essere interi.");
    }
    try {
      return Response.json(
        query({
          region: params.get("regione") ?? undefined,
          code: params.get("codice") ?? undefined,
          limit,
          offset: offset ?? 0,
        }),
        { headers: { "Cache-Control": CACHE_CONTROL } },
      );
    } catch (error) {
      return badRequest(error instanceof Error ? error.message : "Richiesta non valida.");
    }
  };
}
