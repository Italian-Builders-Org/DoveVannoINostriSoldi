import type { NextRequest } from "next/server";
import {
  MefIrpefQueryError,
  queryMefMunicipalIrpef,
  type MefIrpefLevel,
  type MefIrpefQuery,
} from "@/lib/mef-irpef-snapshot";
import {
  getMunicipalityGeographyByIstatCode,
  getRegionGeography,
} from "@/lib/municipality-geography";

const ALLOWED_PARAMS = new Set([
  "anno",
  "livello",
  "regione",
  "provincia",
  "codice",
  "q",
  "limite",
  "offset",
]);

const LEVELS: Readonly<Record<string, MefIrpefLevel>> = {
  regione: "region",
  provincia: "province",
  comune: "municipality",
};

function invalid(message: string): never {
  throw new MefIrpefQueryError("invalid_query", message);
}

function singleValue(params: URLSearchParams, key: string): string | undefined {
  const values = params.getAll(key);
  if (values.length > 1) invalid(`Il parametro ${key} non può essere ripetuto.`);
  return values[0];
}

function optionalInteger(params: URLSearchParams, key: string): number | undefined {
  const value = singleValue(params, key);
  if (value === undefined) return undefined;
  if (!/^\d+$/.test(value)) invalid(`Il parametro ${key} deve essere un intero non negativo.`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) invalid(`Il parametro ${key} è fuori intervallo.`);
  return parsed;
}

function parseLevel(params: URLSearchParams): MefIrpefLevel | undefined {
  const value = singleValue(params, "livello");
  if (value === undefined) return undefined;
  const level = LEVELS[value];
  if (!level) invalid("Il parametro livello deve essere regione, provincia oppure comune.");
  return level;
}

function parseQuery(params: URLSearchParams): MefIrpefQuery {
  for (const key of params.keys()) {
    if (!ALLOWED_PARAMS.has(key)) invalid(`Parametro non supportato: ${key}.`);
  }
  return {
    year: optionalInteger(params, "anno"),
    level: parseLevel(params),
    region: singleValue(params, "regione"),
    province: singleValue(params, "provincia"),
    code: singleValue(params, "codice"),
    query: singleValue(params, "q"),
    limit: optionalInteger(params, "limite"),
    offset: optionalInteger(params, "offset"),
  };
}

export function GET(request: NextRequest) {
  try {
    const result = queryMefMunicipalIrpef(parseQuery(request.nextUrl.searchParams));
    const data = result.data.map((record) => ({
      ...record,
      geography: record.territory.level === "municipality"
        ? getMunicipalityGeographyByIstatCode(result.period.taxYear, record.territory.code)
        : record.territory.level === "region"
          ? getRegionGeography(result.period.taxYear, record.territory.code)
          : null,
    }));
    return Response.json({ ...result, data }, {
      headers: { "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400" },
    });
  } catch (error) {
    if (error instanceof MefIrpefQueryError) {
      return Response.json(
        { error: { code: error.code, message: error.message } },
        { status: error.status, headers: { "Cache-Control": "private, no-store" } },
      );
    }
    console.error("MEF IRPEF API failed", error);
    return Response.json(
      { error: { code: "internal_error", message: "Dati temporaneamente non disponibili." } },
      { status: 500, headers: { "Cache-Control": "private, no-store" } },
    );
  }
}
