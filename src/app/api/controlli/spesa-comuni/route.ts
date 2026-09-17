import type { NextRequest } from "next/server";
import {
  OpenCivitasOutlierQueryError,
  queryOpenCivitasSpendingOutliers,
} from "@/lib/opencivitas-outliers";
import { openCivitasSnapshot } from "@/lib/opencivitas-snapshot";

export const dynamic = "force-dynamic";

const ALLOWED_PARAMETERS = new Set(["anno", "limit", "offset", "regione"]);

class InvalidQueryError extends Error {}

function singleParameter(request: NextRequest, name: string): string | null {
  const values = request.nextUrl.searchParams.getAll(name);
  if (values.length > 1) throw new InvalidQueryError(`${name}: parametro duplicato`);
  return values[0] ?? null;
}

function boundedInteger(value: string | null, name: string, fallback: number, minimum: number, maximum: number): number {
  if (value === null) return fallback;
  if (!/^\d+$/.test(value)) throw new InvalidQueryError(`${name}: intero atteso`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new InvalidQueryError(`${name}: valore ammesso da ${minimum} a ${maximum}`);
  }
  return parsed;
}

function requestedYear(value: string | null): number {
  if (value === null) return openCivitasSnapshot.referenceYear;
  if (!/^20\d{2}$/.test(value)) throw new InvalidQueryError("anno: anno a quattro cifre atteso");
  const year = Number(value);
  if (year !== openCivitasSnapshot.referenceYear) {
    throw new InvalidQueryError(`anno: OpenCivitas è disponibile per il ${openCivitasSnapshot.referenceYear}`);
  }
  return year;
}

function invalidRequest(message: string) {
  return Response.json(
    { ok: false, error: "invalid_query", message },
    { status: 400, headers: { "Cache-Control": "no-store" } },
  );
}

export function GET(request: NextRequest) {
  try {
    for (const name of request.nextUrl.searchParams.keys()) {
      if (!ALLOWED_PARAMETERS.has(name)) {
        throw new InvalidQueryError(`${name}: parametro non supportato`);
      }
    }

    const year = requestedYear(singleParameter(request, "anno"));
    const limit = boundedInteger(singleParameter(request, "limit"), "limit", 50, 1, 100);
    const offset = boundedInteger(singleParameter(request, "offset"), "offset", 0, 0, 100_000);
    const region = singleParameter(request, "regione") ?? undefined;
    const result = queryOpenCivitasSpendingOutliers({ year, region, limit, offset });

    return Response.json(
      {
        ok: true,
        ...result,
        totalOutliers: result.pagination.total,
      },
      {
        headers: { "Cache-Control": "public, s-maxage=21600, stale-while-revalidate=86400" },
      },
    );
  } catch (error) {
    if (error instanceof InvalidQueryError || error instanceof OpenCivitasOutlierQueryError) {
      return invalidRequest(error.message);
    }
    throw error;
  }
}
