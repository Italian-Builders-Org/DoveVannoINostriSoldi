import type { NextRequest } from "next/server";
import { queryInlVigilanza } from "@/lib/inl-vigilanza-snapshot";

const CACHE_CONTROL = "public, max-age=3600, stale-while-revalidate=86400";

export function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const invalid = (error: string) =>
    Response.json({ error }, { status: 400, headers: { "Cache-Control": "no-store" } });

  const allowed = new Set(["anno", "tabella", "territorio", "settore"]);
  for (const key of params.keys()) {
    if (!allowed.has(key) || params.getAll(key).length !== 1) {
      return invalid(`Parametro sconosciuto o ripetuto: ${key}.`);
    }
  }

  const anno = params.get("anno");
  if (anno !== null && anno !== "2025") {
    return invalid("Parametro anno non canonico: usare 2025.");
  }
  const tabella = params.get("tabella");
  if (
    tabella !== null &&
    !/^(inspectionsStarted|inspectionsOutcome|recovery)$/.test(tabella)
  ) {
    return invalid(
      "Parametro tabella: usare inspectionsStarted, inspectionsOutcome oppure recovery.",
    );
  }

  try {
    return Response.json(
      queryInlVigilanza({
        year: anno !== null ? Number(anno) : undefined,
        table: tabella ?? undefined,
        territory: params.get("territorio") ?? undefined,
        sector: params.get("settore") ?? undefined,
      }),
      { headers: { "Cache-Control": CACHE_CONTROL } },
    );
  } catch (error) {
    return invalid(error instanceof Error ? error.message : "Richiesta non valida.");
  }
}
