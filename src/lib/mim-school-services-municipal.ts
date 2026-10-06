import "server-only";

import { join } from "node:path";
import { readJsonSnapshot } from "@/lib/data/read-json-snapshot";
import { schoolServicesSource } from "@/lib/mim-school-services-source";

type MunicipalIndex = Readonly<{
  schemaVersion: 1;
  datasetId: string;
  schoolYear: string;
  dataAsOf: string;
  landingUrl: string;
  municipalityCount: number;
  municipalities: Readonly<Record<string, Readonly<{ c: string; s: number; o: number }>>>;
}>;

export type ComuniSchoolServices =
  | Readonly<{
      status: "available";
      data: Readonly<{
        istatCode: string;
        cadastralCode: string;
        schoolYear: string;
        dataAsOf: string;
        schoolSites: number;
        otherRegistryCodes: number;
      }>;
    }>
  | Readonly<{
      status: "not_found" | "out_of_scope";
      reason: "no_matching_record" | "outside_source_scope";
      message: string;
    }>;

const index = readJsonSnapshot(
  join(process.cwd(), "src/data/generated/mim-school-services-municipal.json"),
  512 * 1024,
) as MunicipalIndex;

if (index.schemaVersion !== 1 || index.datasetId !== schoolServicesSource.datasetId) {
  throw new Error("Indice comunale MIM: schema o dataset divergenti.");
}
if (index.schoolYear !== schoolServicesSource.schoolYear || index.dataAsOf !== schoolServicesSource.dataAsOf) {
  throw new Error("Indice comunale MIM: periodo divergente dalla specifica.");
}
if (index.municipalityCount !== Object.keys(index.municipalities).length) {
  throw new Error("Indice comunale MIM: conteggio comuni divergente.");
}

/**
 * Compact municipal projection of MIM school sites. Safe for /comuni NFT:
 * does not open the integrated corpus or source-ledger.
 */
export function getMunicipalitySchoolServicesFromIndex(
  istatCode: string | null,
  cadastralCode: string | null,
): ComuniSchoolServices {
  if (!istatCode || !/^\d{6}$/.test(istatCode) || !cadastralCode || !/^[A-Z][0-9]{3}$/.test(cadastralCode)) {
    return {
      status: "not_found",
      reason: "no_matching_record",
      message: "Identità comunale non riconciliata: non è possibile collegare l'anagrafe delle scuole.",
    };
  }
  const row = index.municipalities[istatCode];
  if (!row) {
    return {
      status: "not_found",
      reason: "no_matching_record",
      message: "Nessun record MIM collegabile a questo Comune nel file 2026/27. Non significa che sul territorio non esistano scuole.",
    };
  }
  if (row.c !== cadastralCode) {
    return {
      status: "not_found",
      reason: "no_matching_record",
      message: "Il codice catastale MEF non coincide con il record MIM per questo codice ISTAT.",
    };
  }
  if (!Number.isSafeInteger(row.s) || row.s < 0 || !Number.isSafeInteger(row.o) || row.o < 0) {
    throw new Error("Indice comunale MIM: conteggi non validi.");
  }
  return {
    status: "available",
    data: {
      istatCode,
      cadastralCode,
      schoolYear: index.schoolYear,
      dataAsOf: index.dataAsOf,
      schoolSites: row.s,
      otherRegistryCodes: row.o,
    },
  };
}
