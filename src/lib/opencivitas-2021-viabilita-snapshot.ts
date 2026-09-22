import "server-only";
import snapshotJson from "@/data/generated/opencivitas-2021-viabilita.json";
import {
  assertOpenCivitas2021ViabilitaSnapshot,
  type OpenCivitas2021ViabilitaSnapshot,
} from "@/lib/data/opencivitas-2021-viabilita-contract";
import { resolveOpenCivitasRegionName } from "@/lib/region-query";

export const openCivitas2021ViabilitaSnapshot: OpenCivitas2021ViabilitaSnapshot =
  assertOpenCivitas2021ViabilitaSnapshot(snapshotJson);

export function queryOpenCivitas2021Viabilita(filters: {
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
      "Specificare regione o codice ISTAT Comune: lo snapshot Viabilità 2021 completo non viene servito in un'unica risposta.",
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

  const matches = openCivitas2021ViabilitaSnapshot.municipalities.filter(
    (item) => (!region || item.region === region) && (!code || item.istatCode === code),
  );
  if (region && matches.length === 0 && !code) {
    throw new Error(`Nessun Comune RSO per la regione ${regionInput}.`);
  }

  return {
    datasetId: "opencivitas_viabilita_2021",
    family: "FC70TERRVIAB",
    function: "TERR_VIAB",
    referenceYear: openCivitas2021ViabilitaSnapshot.referenceYear,
    publishedAt: openCivitas2021ViabilitaSnapshot.publishedAt,
    modifiedAt: openCivitas2021ViabilitaSnapshot.modifiedAt,
    pagination: {
      total: matches.length,
      offset,
      limit,
      returned: matches.slice(offset, offset + limit).length,
    },
    data: matches.slice(offset, offset + limit),
    coverage: openCivitas2021ViabilitaSnapshot.coverage,
    methodology: openCivitas2021ViabilitaSnapshot.methodology,
    provenance: openCivitas2021ViabilitaSnapshot.source,
    caveats: [
      "Snapshot distinto da OpenCivitas FC70TOT 2021 (servizi totali) e da FC80TERRVIAB 2022.",
      "Non sommare né confrontare in silenzio funzioni o annualità diverse.",
      "La differenza spesa storica − spesa standard non è spreco.",
      "RSS e Province autonome sono fuori perimetro.",
      "14 Comuni con spesa storica vuota nella fonte restano esclusi: nessuna imputazione a zero.",
    ],
  };
}
