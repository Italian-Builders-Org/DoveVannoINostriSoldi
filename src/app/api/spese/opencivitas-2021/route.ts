import type { NextRequest } from "next/server";
import { queryOpenCivitas2021 } from "@/lib/opencivitas-2021-snapshot";

const CACHE_CONTROL = "public, max-age=3600, stale-while-revalidate=86400";

function parseLimit(value: string | null): number | undefined {
  if (value === null) return undefined;
  if (!/^(0|[1-9]\d*)$/.test(value)) return Number.NaN;
  return Number(value);
}

export function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const allowed = new Set(["anno", "regione", "codice", "limit", "offset"]);
  for (const key of params.keys()) {
    if (!allowed.has(key) || params.getAll(key).length !== 1) {
      return Response.json({ error: `Parametro sconosciuto o ripetuto: ${key}.` },
        { status: 400, headers: { "Cache-Control": "no-store" } });
    }
  }
  const year = params.get("anno");
  if (year !== null && year !== "2021") {
    return Response.json(
      { error: "Questo endpoint serve solo l'annualità 2021 FC70TOT. Il 2022 resta sullo snapshot già in produzione." },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  const limit = parseLimit(params.get("limit"));
  const offset = parseLimit(params.get("offset"));
  if (Number.isNaN(limit) || Number.isNaN(offset)) {
    return Response.json({ error: "limit e offset devono essere interi." }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }

  try {
    return Response.json(
      queryOpenCivitas2021({
        region: params.get("regione") ?? undefined,
        code: params.get("codice") ?? undefined,
        limit,
        offset: offset ?? 0,
      }),
      { headers: { "Cache-Control": CACHE_CONTROL } },
    );
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Richiesta non valida." },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
}
