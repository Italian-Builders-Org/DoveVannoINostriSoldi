import type { NextRequest } from "next/server";
import { queryAifaSpesaConsumi } from "@/lib/aifa-spesa-consumi-snapshot";

const CACHE_CONTROL = "public, max-age=3600, stale-while-revalidate=86400";

export function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const invalid = (error: string) =>
    Response.json({ error }, { status: 400, headers: { "Cache-Control": "no-store" } });

  const allowed = new Set(["anno", "regione", "classe", "atc"]);
  for (const key of params.keys()) {
    if (!allowed.has(key) || params.getAll(key).length !== 1) {
      return invalid(`Parametro sconosciuto o ripetuto: ${key}.`);
    }
  }

  const anno = params.get("anno");
  if (anno !== null && !/^\d{4}$/.test(anno)) {
    return invalid("Il parametro anno deve essere un anno a quattro cifre.");
  }
  const regione = params.get("regione");
  if (regione !== null && !/^\d{3}$/.test(regione)) {
    return invalid("Il parametro regione accetta il codice ISTAT a tre cifre, per esempio 030.");
  }
  const atc = params.get("atc");
  if (atc !== null && !/^[A-Za-z]\d{2}$/.test(atc)) {
    return invalid("Il parametro atc accetta un codice di II livello, per esempio C09.");
  }
  const classe = params.get("classe");
  if (classe !== null && !/^[A-Za-z-]{1,5}$/.test(classe)) {
    return invalid("Il parametro classe accetta A, C, C-bis, Cnn, H oppure N.");
  }

  // Una richiesta senza filtri restituirebbe tutte le 21.208 righe: la superficie
  // resta limitata per contratto, quindi si rifiuta invece di servire un payload
  // non delimitato.
  if (anno === null && regione === null && classe === null && atc === null) {
    return invalid(
      "Specificare almeno un filtro fra anno, regione, classe e atc: la serie completa non viene servita in un'unica risposta.",
    );
  }

  try {
    return Response.json(
      queryAifaSpesaConsumi({
        year: anno !== null ? Number(anno) : undefined,
        regionCode: regione ?? undefined,
        class: classe ?? undefined,
        atc2: atc ?? undefined,
      }),
      { headers: { "Cache-Control": CACHE_CONTROL } },
    );
  } catch (error) {
    return invalid(error instanceof Error ? error.message : "Richiesta non valida.");
  }
}
