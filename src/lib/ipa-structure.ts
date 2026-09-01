import { fetchOfficialSource } from "@/lib/data/source-fetch";
import {
  normalizeIpaHomogeneousArea,
  normalizeIpaOrganizationUnit,
  type IpaHomogeneousArea,
  type IpaOrganizationUnit,
} from "@/lib/data/ipa-structure-contract";

const IPA_DATASTORE_SEARCH =
  "https://indicepa.gov.it/ipa-dati/api/3/action/datastore_search";

export const IPA_UO_RESOURCE_ID = "b0aa1f6c-f135-4c8a-b416-396fed4e1a5d";
export const IPA_AOO_RESOURCE_ID = "cdaded04-f84e-4193-a720-47d6d5f422aa";
export const IPA_UO_DATASET_URL =
  "https://www.indicepa.gov.it/ipa-dati/dataset/unita-organizzative";
export const IPA_AOO_DATASET_URL =
  "https://www.indicepa.gov.it/ipa-dati/dataset/aree-organizzative-omogenee";

type RawRecord = Record<string, unknown>;

type DatastoreResponse = {
  success?: boolean;
  result?: {
    total?: number;
    records?: RawRecord[];
  };
};

export type { IpaHomogeneousArea, IpaOrganizationUnit } from "@/lib/data/ipa-structure-contract";

export type IpaOrganizationStructure = {
  codiceIpa: string;
  unitaOrganizzative: {
    total: number;
    offset: number;
    nextOffset: number | null;
    records: IpaOrganizationUnit[];
    truncated: boolean;
  };
  areeOrganizzativeOmogenee: {
    total: number;
    offset: number;
    nextOffset: number | null;
    records: IpaHomogeneousArea[];
    truncated: boolean;
  };
  observedAt: string;
};

async function fetchRecords(
  resourceId: string,
  codiceIpa: string,
  limit: number,
  offset: number,
  sortField: string,
  signal?: AbortSignal,
) {
  const params = new URLSearchParams({
    resource_id: resourceId,
    limit: String(limit),
    offset: String(offset),
    sort: `${sortField} asc`,
    filters: JSON.stringify({ Codice_IPA: codiceIpa }),
  });
  const url = `${IPA_DATASTORE_SEARCH}?${params.toString()}`;
  const response = await fetchOfficialSource("ipa-struttura", url, {
    kind: "data",
    headers: { Accept: "application/json" },
    tags: ["dataset:ipa-structure", `entity:${codiceIpa}`],
    signal,
  });

  if (!response.ok) throw new Error(`IPA struttura upstream HTTP ${response.status}`);

  const payload = (await response.json()) as DatastoreResponse;
  if (!payload.success || !Array.isArray(payload.result?.records)) {
    throw new Error("Risposta struttura IPA non valida");
  }

  return {
    total: typeof payload.result.total === "number" ? payload.result.total : 0,
    records: payload.result.records,
  };
}

export async function getIpaOrganizationStructure(
  codiceIpa: string,
  limit = 250,
  offset = 0,
  options: { signal?: AbortSignal } = {},
): Promise<IpaOrganizationStructure> {
  const normalized = codiceIpa.trim().slice(0, 100);
  if (!normalized) throw new Error("Codice IPA mancante");

  const safeLimit = Math.min(Math.max(Math.trunc(limit), 1), 500);
  const safeOffset = Math.min(Math.max(Math.trunc(offset), 0), 100_000);
  const [units, areas] = await Promise.all([
    fetchRecords(IPA_UO_RESOURCE_ID, normalized, safeLimit, safeOffset, "Descrizione_uo", options.signal),
    fetchRecords(IPA_AOO_RESOURCE_ID, normalized, safeLimit, safeOffset, "Denominazione_aoo", options.signal),
  ]);

  const normalizedUnits = units.records
    .map(normalizeIpaOrganizationUnit)
    .sort((a, b) => a.denominazione.localeCompare(b.denominazione, "it"));
  const normalizedAreas = areas.records
    .map(normalizeIpaHomogeneousArea)
    .sort((a, b) => a.denominazione.localeCompare(b.denominazione, "it"));

  return {
    codiceIpa: normalized,
    unitaOrganizzative: {
      total: units.total,
      offset: safeOffset,
      nextOffset: safeOffset + normalizedUnits.length < units.total
        ? safeOffset + normalizedUnits.length
        : null,
      records: normalizedUnits,
      truncated: units.total > normalizedUnits.length,
    },
    areeOrganizzativeOmogenee: {
      total: areas.total,
      offset: safeOffset,
      nextOffset: safeOffset + normalizedAreas.length < areas.total
        ? safeOffset + normalizedAreas.length
        : null,
      records: normalizedAreas,
      truncated: areas.total > normalizedAreas.length,
    },
    observedAt: new Date().toISOString(),
  };
}
