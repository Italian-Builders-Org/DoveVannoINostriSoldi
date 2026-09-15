import type { NextRequest } from "next/server";
import { queryInpsAssegnoUnico } from "@/lib/inps-assegno-unico-snapshot";

const CACHE_CONTROL = "public, max-age=3600, stale-while-revalidate=86400";

export function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const invalid = (error: string) =>
    Response.json({ error }, { status: 400, headers: { "Cache-Control": "no-store" } });

  const allowed = new Set(["anno", "tabella", "provincia", "regione"]);
  for (const key of params.keys()) {
    if (!allowed.has(key) || params.getAll(key).length !== 1) {
      return invalid(`Parametro sconosciuto o ripetuto: ${key}.`);
    }
  }

  const anno = params.get("anno");
  if (anno !== null && !/^202[2-4]$/.test(anno)) {
    return invalid("Parametro anno non canonico: usare 2022-2024.");
  }
  const tabella = params.get("tabella");
  if (tabella !== null && !/^(nuclei|figli_disabilita)$/.test(tabella)) {
    return invalid("Parametro tabella: usare nuclei oppure figli_disabilita.");
  }

  try {
    return Response.json(
      queryInpsAssegnoUnico({
        year: anno !== null ? Number(anno) : undefined,
        table: tabella ?? undefined,
        province: params.get("provincia") ?? undefined,
        region: params.get("regione") ?? undefined,
      }),
      { headers: { "Cache-Control": CACHE_CONTROL } },
    );
  } catch (error) {
    return invalid(error instanceof Error ? error.message : "Richiesta non valida.");
  }
}
