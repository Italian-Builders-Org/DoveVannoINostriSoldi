import type { NextRequest } from "next/server";
import { getRealEstateRegionPoints, REGION_CODE_PATTERN } from "@/lib/real-estate-map-points";

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const invalid = (error: string) => Response.json({ error }, {
    status: 400, headers: { "Cache-Control": "no-store" },
  });
  for (const key of params.keys()) {
    if (key !== "regione" || params.getAll(key).length !== 1) {
      return invalid(`Parametro sconosciuto o ripetuto: ${key}.`);
    }
  }
  const regione = params.get("regione");
  if (regione === null || !REGION_CODE_PATTERN.test(regione)) {
    return invalid("Parametro regione non canonico: usare il codice ISTAT a due cifre, da 01 a 20.");
  }
  return Response.json(await getRealEstateRegionPoints(regione), { headers: { "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400" } });
}
