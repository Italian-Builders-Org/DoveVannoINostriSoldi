import type { NextRequest } from "next/server";
import { queryMefTaxGapNazionale } from "@/lib/mef-tax-gap-nazionale-snapshot";

export function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const invalid = (error: string) => Response.json({ error }, {
    status: 400, headers: { "Cache-Control": "no-store" },
  });
  const allowed = new Set(["anno", "imposta"]);
  for (const key of params.keys()) {
    if (!allowed.has(key) || params.getAll(key).length !== 1) {
      return invalid(`Parametro sconosciuto o ripetuto: ${key}.`);
    }
  }
  const anno = params.get("anno");
  if (anno !== null && !/^(2018|2019|2020|2021|2022)$/.test(anno)) {
    return invalid("Parametro anno non canonico: usare 2018-2022.");
  }
  const imposta = params.get("imposta");
  try {
    return Response.json(queryMefTaxGapNazionale({
      year: anno !== null ? Number(anno) : undefined,
      tax: imposta ?? undefined,
    }), { headers: { "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400" } });
  } catch (error) {
    return invalid(error instanceof Error ? error.message : "Richiesta non valida.");
  }
}
