import type { NextRequest } from "next/server";
import { queryInpsCigFondiSolidarieta } from "@/lib/inps-cig-fondi-solidarieta-snapshot";

const CACHE_CONTROL = "public, max-age=3600, stale-while-revalidate=86400";

export function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const invalid = (error: string) =>
    Response.json({ error }, { status: 400, headers: { "Cache-Control": "no-store" } });

  const allowed = new Set(["anno", "mese", "regione", "gestione", "ramo"]);
  for (const key of params.keys()) {
    if (!allowed.has(key) || params.getAll(key).length !== 1) {
      return invalid(`Parametro sconosciuto o ripetuto: ${key}.`);
    }
  }

  const anno = params.get("anno");
  if (anno !== null && anno !== "2023" && anno !== "2024") {
    return invalid("Parametro anno non canonico: usare 2023 oppure 2024.");
  }

  try {
    return Response.json(
      queryInpsCigFondiSolidarieta({
        year: anno !== null ? Number(anno) : undefined,
        month: params.get("mese") ?? undefined,
        region: params.get("regione") ?? undefined,
        fundManagement: params.get("gestione") ?? undefined,
        sector: params.get("ramo") ?? undefined,
      }),
      { headers: { "Cache-Control": CACHE_CONTROL } },
    );
  } catch (error) {
    return invalid(error instanceof Error ? error.message : "Richiesta non valida.");
  }
}
