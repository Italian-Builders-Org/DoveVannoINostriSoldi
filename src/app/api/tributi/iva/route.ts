import type { NextRequest } from "next/server";
import { queryMefIva } from "@/lib/mef-iva-snapshot";

export function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const invalid = (error: string) => Response.json({ error }, {
    status: 400, headers: { "Cache-Control": "no-store" },
  });
  const allowed = new Set(["anno", "taglio", "limit", "offset"]);
  for (const key of params.keys()) {
    if (!allowed.has(key) || params.getAll(key).length !== 1) {
      return invalid(`Parametro sconosciuto o ripetuto: ${key}.`);
    }
  }
  for (const key of ["anno", "limit", "offset"]) {
    const value = params.get(key);
    if (value !== null && !/^(0|[1-9]\d*)$/.test(value)) return invalid(`Parametro ${key} non canonico.`);
  }
  try {
    return Response.json(queryMefIva({
      year: params.has("anno") ? Number(params.get("anno")) : undefined,
      breakdown: params.get("taglio") ?? undefined,
      limit: params.has("limit") ? Number(params.get("limit")) : undefined,
      offset: params.has("offset") ? Number(params.get("offset")) : undefined,
    }), { headers: { "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400" } });
  } catch (error) {
    return invalid(error instanceof Error ? error.message : "Richiesta non valida.");
  }
}
