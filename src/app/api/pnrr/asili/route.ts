import { NextResponse, type NextRequest } from "next/server.js";
import {
  PnrrChildcareQueryError,
  queryPnrrChildcare,
  type PnrrChildcareQuery,
} from "@/lib/pnrr-childcare-snapshot";

const ALLOWED_PARAMS = new Set(["cup", "q", "region", "province", "limit", "offset"]);
export const MAX_PNRR_RESPONSE_BYTES = 750_000;

function jsonResponse(value: unknown, init: ResponseInit = {}): NextResponse {
  const body = JSON.stringify(value);
  if (new TextEncoder().encode(body).byteLength > MAX_PNRR_RESPONSE_BYTES) {
    return NextResponse.json(
      { error: "La risposta richiesta supera il limite di dimensione.", code: "response_too_large" },
      { status: 413 },
    );
  }
  return new NextResponse(body, {
    ...init,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...init.headers,
    },
  });
}

function singleValue(params: URLSearchParams, key: string): string | undefined {
  const values = params.getAll(key);
  if (values.length > 1) throw new PnrrChildcareQueryError(`Il parametro ${key} può comparire una sola volta.`);
  const value = values[0]?.trim();
  return value || undefined;
}

function integerValue(params: URLSearchParams, key: string): number | undefined {
  const value = singleValue(params, key);
  if (value === undefined) return undefined;
  if (!/^\d+$/.test(value)) throw new PnrrChildcareQueryError(`${key} deve essere un intero non negativo.`);
  return Number(value);
}

function parseQuery(params: URLSearchParams): PnrrChildcareQuery {
  for (const key of params.keys()) {
    if (!ALLOWED_PARAMS.has(key)) throw new PnrrChildcareQueryError(`Parametro non supportato: ${key}.`);
  }
  return {
    cup: singleValue(params, "cup"),
    query: singleValue(params, "q"),
    region: singleValue(params, "region"),
    province: singleValue(params, "province"),
    limit: integerValue(params, "limit"),
    offset: integerValue(params, "offset"),
  };
}

export async function GET(request: NextRequest) {
  try {
    const result = queryPnrrChildcare(parseQuery(request.nextUrl.searchParams));
    return jsonResponse(result, {
      headers: { "Cache-Control": "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400" },
    });
  } catch (error) {
    if (error instanceof PnrrChildcareQueryError) {
      return jsonResponse(
        { error: error.message, code: error.code },
        { status: error.code === "not_found" ? 404 : 400 },
      );
    }
    console.error("PNRR childcare API failed", error);
    return jsonResponse({ error: "Snapshot PNRR temporaneamente non disponibile." }, { status: 500 });
  }
}
