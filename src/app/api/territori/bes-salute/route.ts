import type { NextRequest } from "next/server";
import { queryIstatBesSalute } from "@/lib/istat-bes-salute-snapshot";

const FILTERS = new Set(["territorio", "anno", "indicatore", "sesso", "limit", "offset"]);

export function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  try {
    for (const key of params.keys()) {
      if (!FILTERS.has(key) || params.getAll(key).length !== 1) {
        throw new Error("Usare soltanto territorio, anno, indicatore, sesso, limit e offset, una volta ciascuno.");
      }
    }
    const rawYear = params.get("anno");
    if (rawYear !== null && !/^\d{4}$/.test(rawYear)) {
      throw new Error("Il parametro anno deve essere un anno a quattro cifre.");
    }
    for (const key of ["limit", "offset"]) {
      const value = params.get(key);
      if (value !== null && !/^(0|[1-9]\d{0,5})$/.test(value)) {
        throw new Error("limit e offset devono essere numeri interi non negativi.");
      }
    }
    const result = queryIstatBesSalute({
      territory: params.get("territorio") ?? undefined,
      year: rawYear === null ? undefined : Number(rawYear),
      indicator: params.get("indicatore") ?? undefined,
      sex: params.get("sesso") ?? undefined,
      limit: params.has("limit") ? Number(params.get("limit")) : undefined,
      offset: params.has("offset") ? Number(params.get("offset")) : undefined,
    });
    return Response.json(result, {
      headers: { "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400" },
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Richiesta non valida." }, {
      status: 400,
      headers: { "Cache-Control": "no-store" },
    });
  }
}
