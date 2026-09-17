import type { NextRequest } from "next/server";
import { queryEuVatGapItaly } from "@/lib/eu-vat-gap-italy-snapshot";

export function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const invalid = (error: string) => Response.json({ error }, {
    status: 400, headers: { "Cache-Control": "no-store" },
  });
  const allowed = new Set(["anno"]);
  for (const key of params.keys()) {
    if (!allowed.has(key) || params.getAll(key).length !== 1) {
      return invalid(`Parametro sconosciuto o ripetuto: ${key}.`);
    }
  }
  const anno = params.get("anno");
  if (anno !== null && !/^(2019|202[0-4])$/.test(anno)) {
    return invalid("Parametro anno non canonico: usare 2019-2024.");
  }
  try {
    return Response.json(queryEuVatGapItaly({
      year: anno !== null ? Number(anno) : undefined,
    }), { headers: { "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400" } });
  } catch (error) {
    return invalid(error instanceof Error ? error.message : "Richiesta non valida.");
  }
}
