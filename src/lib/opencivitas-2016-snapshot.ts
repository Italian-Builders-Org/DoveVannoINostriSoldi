import "server-only";
import { join } from "node:path";
import { readJsonSnapshot } from "@/lib/data/read-json-snapshot";
import {
  assertOpenCivitas2016Snapshot,
  type OpenCivitas2016Snapshot,
} from "@/lib/data/opencivitas-2016-contract";
import { resolveOpenCivitasRegionName } from "@/lib/region-query";

export const openCivitas2016Snapshot: OpenCivitas2016Snapshot =
  assertOpenCivitas2016Snapshot(readJsonSnapshot(
    join(process.cwd(), "src/data/generated/opencivitas-2016.json"),
    2 * 1024 * 1024,
  ));

export function queryOpenCivitas2016(filters: {
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
    throw new Error("Specificare regione o codice ISTAT Comune: lo snapshot 2016 completo non viene servito in un'unica risposta.");
  }

  const regionInput = filters.region?.trim();
  if (regionInput !== undefined && !regionInput) throw new Error("La regione non può essere vuota.");
  const region = regionInput ? resolveOpenCivitasRegionName(regionInput) : null;
  if (regionInput && !region) throw new Error(`Regione OpenCivitas non riconosciuta: ${regionInput}.`);
  const code = filters.code?.trim();
  if (code !== undefined && !/^\d{6}$/.test(code)) {
    throw new Error("Il codice ISTAT Comune deve avere sei cifre.");
  }

  const matches = openCivitas2016Snapshot.municipalities.filter(
    (item) => (!region || item.region === region) && (!code || item.istatCode === code),
  );
  if (region && matches.length === 0 && !code) throw new Error(`Nessun Comune RSO per la regione ${regionInput}.`);
  const data = matches.slice(offset, offset + limit);

  return {
    datasetId: "opencivitas_fabbisogni_2016",
    family: "FC30TOT",
    referenceYear: openCivitas2016Snapshot.referenceYear,
    publishedAt: openCivitas2016Snapshot.publishedAt,
    modifiedAt: openCivitas2016Snapshot.modifiedAt,
    pagination: { total: matches.length, offset, limit, returned: data.length },
    data,
    coverage: openCivitas2016Snapshot.coverage,
    methodology: openCivitas2016Snapshot.methodology,
    provenance: openCivitas2016Snapshot.source,
    caveats: [
      "Snapshot distinto dalle annualità OpenCivitas 2015, 2017, 2018, 2019, 2021 e 2022.",
      "Non sommare né confrontare in silenzio le annualità.",
      "Nel 2016 il fabbisogno standard è riproporzionato sul totale nazionale della spesa storica: la differenza aggregata è nulla per costruzione e non va letta come risultato.",
      "La differenza spesa storica − spesa standard non è spreco.",
      "RSS e Province autonome sono fuori perimetro.",
    ],
  };
}
