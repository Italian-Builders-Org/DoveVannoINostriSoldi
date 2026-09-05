import { querySiopeMunicipalReceipts } from "@/lib/siope-receipts";

const PARAMETERS = new Set(["anno", "regione", "codice", "q", "limit", "offset"]);
function integer(value: string | null, field: string): number | undefined {
  if (value === null) return undefined;
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value))) {
    throw new Error(`${field}: intero non negativo richiesto.`);
  }
  return Number(value);
}

export function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    for (const key of params.keys()) {
      if (!PARAMETERS.has(key)) throw new Error(`Parametro non supportato: ${key}.`);
      if (params.getAll(key).length !== 1) throw new Error(`Parametro duplicato: ${key}.`);
    }
    const data = querySiopeMunicipalReceipts({
      year: integer(params.get("anno"), "anno"),
      region: params.get("regione") ?? undefined,
      code: params.get("codice") ?? undefined,
      query: params.get("q") ?? undefined,
      limit: integer(params.get("limit"), "limit"),
      offset: integer(params.get("offset"), "offset"),
    });
    return Response.json(data, {
      headers: {
        "Cache-Control": "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400",
        "X-Data-Source": "SIOPE+IPA+ISTAT",
        "X-Data-Period": `${data.period.year}-${String(data.period.endMonth).padStart(2, "0")}`,
      },
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Richiesta non valida." }, {
      status: 400,
      headers: { "Cache-Control": "no-store" },
    });
  }
}
