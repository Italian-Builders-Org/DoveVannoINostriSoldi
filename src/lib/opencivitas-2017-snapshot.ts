import "server-only";
import snapshotJson from "@/data/generated/opencivitas-2017.json";
import {
  assertOpenCivitas2017Snapshot,
  type OpenCivitas2017Snapshot,
} from "@/lib/data/opencivitas-2017-contract";
import { resolveOpenCivitasRegionName } from "@/lib/region-query";

export const openCivitas2017Snapshot: OpenCivitas2017Snapshot =
  assertOpenCivitas2017Snapshot(snapshotJson);

export function queryOpenCivitas2017(filters: {
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
    throw new Error("Specificare regione o codice ISTAT Comune: lo snapshot 2017 completo non viene servito in un'unica risposta.");
  }

  const regionInput = filters.region?.trim();
  if (regionInput !== undefined && !regionInput) throw new Error("La regione non può essere vuota.");
  const region = regionInput ? resolveOpenCivitasRegionName(regionInput) : null;
  if (regionInput && !region) throw new Error(`Regione OpenCivitas non riconosciuta: ${regionInput}.`);
  const code = filters.code?.trim();
  if (code !== undefined && !/^\d{6}$/.test(code)) {
    throw new Error("Il codice ISTAT Comune deve avere sei cifre.");
  }

  const matches = openCivitas2017Snapshot.municipalities.filter(
    (item) => (!region || item.region === region) && (!code || item.istatCode === code),
  );
  if (region && matches.length === 0 && !code) throw new Error(`Nessun Comune RSO per la regione ${regionInput}.`);
  const data = matches.slice(offset, offset + limit);

  return {
    datasetId: "opencivitas_fabbisogni_2017",
    family: "FC40TOT",
    referenceYear: openCivitas2017Snapshot.referenceYear,
    publishedAt: openCivitas2017Snapshot.publishedAt,
    modifiedAt: openCivitas2017Snapshot.modifiedAt,
    pagination: { total: matches.length, offset, limit, returned: data.length },
    data,
    coverage: openCivitas2017Snapshot.coverage,
    methodology: openCivitas2017Snapshot.methodology,
    provenance: openCivitas2017Snapshot.source,
    caveats: [
      "Snapshot distinto dalle annualità OpenCivitas 2018, 2019, 2021 e 2022.",
      "Non sommare né confrontare in silenzio le annualità.",
      "La differenza spesa storica − spesa standard non è spreco.",
      "RSS e Province autonome sono fuori perimetro.",
    ],
  };
}
