import type { NextRequest } from "next/server";
import { queryInpsIntegrazioniSalariali } from "@/lib/inps-integrazioni-salariali-snapshot";

const CACHE_CONTROL = "public, max-age=3600, stale-while-revalidate=86400";

export function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const invalid = (error: string) =>
    Response.json({ error }, { status: 400, headers: { "Cache-Control": "no-store" } });

  const allowed = new Set(["anno", "tabella", "mese", "regione", "tipo"]);
  for (const key of params.keys()) {
    if (!allowed.has(key) || params.getAll(key).length !== 1) {
      return invalid(`Parametro sconosciuto o ripetuto: ${key}.`);
    }
  }

  const anno = params.get("anno");
  if (anno !== null && anno !== "2023") {
    return invalid("Parametro anno non canonico: usare 2023.");
  }
  const tabella = params.get("tabella");
  if (tabella !== null && !/^(lavoratori|domande|mensilita)$/.test(tabella)) {
    return invalid("Parametro tabella: usare lavoratori, domande oppure mensilita.");
  }

  try {
    return Response.json(
      queryInpsIntegrazioniSalariali({
        year: anno !== null ? Number(anno) : undefined,
        table: tabella ?? undefined,
        month: params.get("mese") ?? undefined,
        region: params.get("regione") ?? undefined,
        interventionType: params.get("tipo") ?? undefined,
      }),
      { headers: { "Cache-Control": CACHE_CONTROL } },
    );
  } catch (error) {
    return invalid(error instanceof Error ? error.message : "Richiesta non valida.");
  }
}
