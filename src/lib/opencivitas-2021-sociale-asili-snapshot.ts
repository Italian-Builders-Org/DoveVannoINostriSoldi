import "server-only";
import snapshotJson from "@/data/generated/opencivitas-2021-sociale-asili.json";
import {
  assertOpenCivitas2021SocialeAsiliSnapshot,
  type OpenCivitas2021SocialeAsiliSnapshot,
} from "@/lib/data/opencivitas-2021-sociale-asili-contract";
import { resolveOpenCivitasRegionName } from "@/lib/region-query";

export const openCivitas2021SocialeAsiliSnapshot: OpenCivitas2021SocialeAsiliSnapshot =
  assertOpenCivitas2021SocialeAsiliSnapshot(snapshotJson);

export function queryOpenCivitas2021SocialeAsili(filters: {
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
      "Specificare regione o codice ISTAT Comune: lo snapshot Sociale/asili 2021 completo non viene servito in un'unica risposta.",
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

  const matches = openCivitas2021SocialeAsiliSnapshot.municipalities.filter(
    (item) => (!region || item.region === region) && (!code || item.istatCode === code),
  );
  if (region && matches.length === 0 && !code) {
    throw new Error(`Nessun Comune RSO per la regione ${regionInput}.`);
  }

  return {
    datasetId: "opencivitas_sociale_asili_2021",
    family: "FC70SOCNID",
    function: "SOCIALE E NIDO",
    referenceYear: openCivitas2021SocialeAsiliSnapshot.referenceYear,
    publishedAt: openCivitas2021SocialeAsiliSnapshot.publishedAt,
    modifiedAt: openCivitas2021SocialeAsiliSnapshot.modifiedAt,
    pagination: {
      total: matches.length,
      offset,
      limit,
      returned: matches.slice(offset, offset + limit).length,
    },
    data: matches.slice(offset, offset + limit),
    coverage: openCivitas2021SocialeAsiliSnapshot.coverage,
    methodology: openCivitas2021SocialeAsiliSnapshot.methodology,
    provenance: openCivitas2021SocialeAsiliSnapshot.source,
    caveats: [
      "Snapshot distinto da OpenCivitas FC70TOT 2021 (servizi totali) e da FC80SOCNID 2022.",
      "Non sommare né confrontare in silenzio funzioni o annualità diverse.",
      "La differenza spesa storica − spesa standard non è spreco.",
      "RSS e Province autonome sono fuori perimetro.",
      "9 Comuni con spesa storica vuota nella fonte restano esclusi. Canistro (066017) resta fuori perché la spesa storica è pubblicata in notazione scientifica: nessuna imputazione a zero.",
    ],
  };
}
