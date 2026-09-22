import type { NextRequest } from "next/server";
import { queryIstatPermessiCostruire } from "@/lib/istat-permessi-costruire-snapshot";

const TABLE_IDS = new Set(["a1", "a2", "a3", "a4"]);

export function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const invalid = (error: string) => Response.json({ error }, {
    status: 400, headers: { "Cache-Control": "no-store" },
  });
  const allowed = new Set(["anno", "tavola"]);
  for (const key of params.keys()) {
    if (!allowed.has(key) || params.getAll(key).length !== 1) {
      return invalid(`Parametro sconosciuto o ripetuto: ${key}.`);
    }
  }
  const anno = params.get("anno");
  if (anno !== null && !/^(201[5-9]|202[0-5])$/.test(anno)) {
    return invalid("Parametro anno non canonico: usare 2015-2025.");
  }
  const tavola = params.get("tavola");
  if (tavola !== null && !TABLE_IDS.has(tavola)) {
    return invalid("Parametro tavola non canonico: usare a1, a2, a3 o a4.");
  }
  try {
    return Response.json(queryIstatPermessiCostruire({
      year: anno !== null ? Number(anno) : undefined,
      table: tavola === null ? undefined : tavola as "a1" | "a2" | "a3" | "a4",
    }), { headers: { "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400" } });
  } catch (error) {
    return invalid(error instanceof Error ? error.message : "Richiesta non valida.");
  }
}
