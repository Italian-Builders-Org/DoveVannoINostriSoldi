import type { NextRequest } from "next/server";
import { queryEurostatTaxag } from "@/lib/eurostat-taxag-snapshot";

export function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const invalid = (error: string) => Response.json({ error }, {
    status: 400, headers: { "Cache-Control": "no-store" },
  });
  const allowed = new Set(["anno", "settore", "voce"]);
  for (const key of params.keys()) {
    if (!allowed.has(key) || params.getAll(key).length !== 1) {
      return invalid(`Parametro sconosciuto o ripetuto: ${key}.`);
    }
  }
  const anno = params.get("anno");
  if (anno !== null && !/^(201[4-9]|202[0-5])$/.test(anno)) {
    return invalid("Parametro anno non canonico: usare 2014-2025.");
  }
  const settore = params.get("settore");
  const voce = params.get("voce");
  try {
    return Response.json(queryEurostatTaxag({
      year: anno !== null ? Number(anno) : undefined,
      sector: settore ?? undefined,
      tax: voce ?? undefined,
    }), { headers: { "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400" } });
  } catch (error) {
    return invalid(error instanceof Error ? error.message : "Richiesta non valida.");
  }
}
