import "server-only";
import snapshotJson from "@/data/generated/opencivitas-2022-istruzione.json";
import {
  assertOpenCivitas2022IstruzioneSnapshot,
  type OpenCivitas2022IstruzioneSnapshot,
} from "@/lib/data/opencivitas-2022-istruzione-contract";
import { resolveOpenCivitasRegionName } from "@/lib/region-query";

export const openCivitas2022IstruzioneSnapshot: OpenCivitas2022IstruzioneSnapshot =
  assertOpenCivitas2022IstruzioneSnapshot(snapshotJson);

export function queryOpenCivitas2022Istruzione(filters: {
  region?: string;
  code?: string;
  limit?: number;
  offset?: number;
}) {
  const limit = filters.limit ?? 20;
  const offset = filters.offset ?? 0;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    throw new Error("limit deve essere un intero tra 1 e 100.");
  }
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > 100_000) {
    throw new Error("offset deve essere un intero tra 0 e 100000.");
  }
  if (filters.region === undefined && filters.code === undefined) {
    throw new Error(
      "Specificare regione o codice ISTAT Comune: lo snapshot Istruzione 2022 completo non viene servito in un'unica risposta.",
    );
  }

  const regionInput = filters.region?.trim();
  if (regionInput !== undefined && !regionInput) {
    throw new Error("La regione non può essere vuota.");
  }
  const region = regionInput ? resolveOpenCivitasRegionName(regionInput) : null;
  if (regionInput && !region) {
    throw new Error(`Regione OpenCivitas non riconosciuta: ${regionInput}.`);
  }
  const code = filters.code?.trim();
  if (code !== undefined && !/^\d{6}$/.test(code)) {
    throw new Error("Il codice ISTAT Comune deve avere sei cifre.");
  }

  const matches = openCivitas2022IstruzioneSnapshot.municipalities.filter(
    (item) => (!region || item.region === region) && (!code || item.istatCode === code),
  );
  if (region && matches.length === 0 && !code) {
    throw new Error(`Nessun Comune RSO per la regione ${regionInput}.`);
  }

  return {
    datasetId: "opencivitas_istruzione_2022",
    family: "FC80ISTRUZ",
    function: "ISTRUZIONE",
    referenceYear: openCivitas2022IstruzioneSnapshot.referenceYear,
    publishedAt: openCivitas2022IstruzioneSnapshot.publishedAt,
    modifiedAt: openCivitas2022IstruzioneSnapshot.modifiedAt,
    pagination: {
      total: matches.length,
      offset,
      limit,
      returned: matches.slice(offset, offset + limit).length,
    },
    data: matches.slice(offset, offset + limit),
    coverage: openCivitas2022IstruzioneSnapshot.coverage,
    methodology: openCivitas2022IstruzioneSnapshot.methodology,
    provenance: openCivitas2022IstruzioneSnapshot.source,
    caveats: [
      "Snapshot distinto da OpenCivitas FC80TOT 2022 (servizi totali), FC80RIFIUTI 2022, FC80TERRVIAB 2022, FC80SOCNID 2022 e dalle altre funzioni 2022.",
      "Non sommare né confrontare in silenzio funzioni o annualità diverse.",
      "La differenza spesa storica − spesa standard non è spreco.",
      "RSS e Province autonome sono fuori perimetro.",
      "6 Comuni con spesa storica vuota nella fonte restano esclusi: nessuna imputazione a zero.",
      "Fascia (GE) pubblica storica e standard a zero e resta esclusa: la differenza percentuale non è definita.",
    ],
  };
}
