import "server-only";

import spec from "../../scripts/etl/specs/mim-school-services.source.json";
import { selectIntegratedDataset, type IntegratedDatasetMetadata } from "@/lib/integrated-public-view";
import type { MefIrpefTerritoryRecord } from "@/lib/mef-irpef-snapshot";

type MunicipalIdentity = Extract<MefIrpefTerritoryRecord["territory"], { level: "municipality" }>;

export const schoolServicesSource = {
  datasetId: spec.datasetId,
  schoolYear: spec.schoolYearLabel,
  dataAsOf: spec.dataAsOf,
  landingUrl: spec.source.landingUrl,
} as const;

export type MunicipalitySchoolServices =
  | Readonly<{
      status: "available";
      data: Readonly<{
        istatCode: string;
        cadastralCode: string;
        schoolYear: string;
        dataAsOf: string;
        schoolSites: number;
        otherRegistryCodes: number;
        rowId: string;
        dataset: IntegratedDatasetMetadata;
      }>;
    }>
  | Readonly<{
      status: "not_found" | "out_of_scope";
      reason: "no_matching_record" | "outside_source_scope";
      message: string;
    }>;

function count(value: string | null | undefined): number {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]*)$/.test(value)) {
    throw new Error("Conteggio delle sedi scolastiche non valido.");
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed > spec.expected.sourceRecords) {
    throw new Error("Conteggio delle sedi scolastiche fuori perimetro.");
  }
  return parsed;
}

/** Join only the municipality identity already reconciled between IPA and MEF. */
export async function getMunicipalitySchoolServices(
  identity: MunicipalIdentity | null,
): Promise<MunicipalitySchoolServices> {
  if (!identity || !/^[0-9]{6}$/.test(identity.code) || !/^[A-Z][0-9]{3}$/.test(identity.cadastralCode)) {
    return {
      status: "not_found",
      reason: "no_matching_record",
      message: "Identità comunale non riconciliata: non è possibile collegare l’anagrafe delle scuole.",
    };
  }
  if (Object.hasOwn(spec.excludedRegions, identity.regionCode)) {
    return {
      status: "out_of_scope",
      reason: "outside_source_scope",
      message: "Il file MIM delle scuole statali esclude Aosta, Trento e Bolzano. Per questo territorio il conteggio non è disponibile.",
    };
  }
  const result = await selectIntegratedDataset({
    datasetId: spec.datasetId,
    q: identity.code,
    limit: 100,
  });
  if (
    result.dataset.publicRows !== spec.expected.municipalities ||
    result.dataset.headers.join("\n") !== spec.publicHeaders.join("\n") ||
    !result.pagination.exhausted
  ) {
    throw new Error("Vista delle sedi scolastiche incompleta o schema divergente.");
  }
  const matches = result.rows.filter((row) => row.cells["Codice ISTAT comune"] === identity.code);
  if (matches.length > 1) throw new Error("Più record scolastici per lo stesso Comune.");
  const row = matches[0];
  if (!row || row.cells["Codice catastale"] !== identity.cadastralCode) {
    return {
      status: "not_found",
      reason: "no_matching_record",
      message: "Nessun record MIM collegabile a questo Comune nel file 2026/27. Non significa che sul territorio non esistano scuole.",
    };
  }
  if (row.cells["Anno scolastico"] !== spec.schoolYearLabel) {
    throw new Error("Anno scolastico divergente nella vista comunale.");
  }
  return {
    status: "available",
    data: {
      istatCode: identity.code,
      cadastralCode: identity.cadastralCode,
      schoolYear: spec.schoolYearLabel,
      dataAsOf: spec.dataAsOf,
      schoolSites: count(row.cells["Sedi scolastiche statali"]),
      otherRegistryCodes: count(row.cells["Altri codici anagrafici"]),
      rowId: row.id,
      dataset: result.dataset,
    },
  };
}
