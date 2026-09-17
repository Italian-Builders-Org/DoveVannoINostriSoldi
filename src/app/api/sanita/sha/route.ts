import type { NextRequest } from "next/server";
import { queryEurostatShaHealth } from "@/lib/eurostat-sha-health-snapshot";

export function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const invalid = (error: string) => Response.json({ error }, {
    status: 400, headers: { "Cache-Control": "no-store" },
  });
  const allowed = new Set(["anno", "schema"]);
  for (const key of params.keys()) {
    if (!allowed.has(key) || params.getAll(key).length !== 1) {
      return invalid(`Parametro sconosciuto o ripetuto: ${key}.`);
    }
  }
  const anno = params.get("anno");
  if (anno !== null && !/^(201[4-9]|202[0-5])$/.test(anno)) {
    return invalid("Parametro anno non canonico: usare 2014-2025.");
  }
  const schema = params.get("schema");
  try {
    return Response.json(queryEurostatShaHealth({
      year: anno !== null ? Number(anno) : undefined,
      scheme: schema ?? undefined,
    }), { headers: { "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400" } });
  } catch (error) {
    return invalid(error instanceof Error ? error.message : "Richiesta non valida.");
  }
}
