import "server-only";
import { join } from "node:path";

import { readJsonSnapshot } from "@/lib/data/read-json-snapshot";
import rawMeta from "@/data/generated/pnrr-childcare.meta.json";
import {
  assertPnrrChildcareReconciliation,
  assertPnrrChildcareData,
  assertPnrrChildcareMeta,
  type PnrrChildcareProject,
} from "@/lib/data/pnrr-childcare-contract";

export const pnrrChildcareData = assertPnrrChildcareData(
  readJsonSnapshot(join(process.cwd(), "src/data/generated/pnrr-childcare.data.json"), 24 * 1024 * 1024),
);
export const pnrrChildcareMeta = assertPnrrChildcareMeta(rawMeta);

if (pnrrChildcareData.referenceDate !== pnrrChildcareMeta.referenceDate) {
  throw new Error("Snapshot PNRR asili: data e metadati hanno date di riferimento diverse");
}
if (pnrrChildcareData.projects.length !== pnrrChildcareMeta.coverage.uniqueProjects) {
  throw new Error("Snapshot PNRR asili: conteggio progetti non riconciliato");
}
assertPnrrChildcareReconciliation(pnrrChildcareData, pnrrChildcareMeta);

const projectsByCup = new Map(pnrrChildcareData.projects.map((project) => [project.cup, project]));
const projectsByImplementerTaxCode = new Map<string, PnrrChildcareProject[]>();
for (const project of pnrrChildcareData.projects) {
  const taxCode = project.implementer.taxCode?.trim();
  if (!taxCode) continue;
  const projects = projectsByImplementerTaxCode.get(taxCode) ?? [];
  projects.push(project);
  projectsByImplementerTaxCode.set(taxCode, projects);
}

export type PnrrChildcareQuery = {
  cup?: string;
  query?: string;
  region?: string;
  province?: string;
  limit?: number;
  offset?: number;
};

export class PnrrChildcareQueryError extends Error {
  readonly code: "invalid" | "not_found";

  constructor(
    message: string,
    code: "invalid" | "not_found" = "invalid",
  ) {
    super(message);
    this.name = "PnrrChildcareQueryError";
    this.code = code;
  }
}

function normalizedSearch(value: string): string {
  return value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLocaleLowerCase("it-IT").trim();
}

function normalizedCup(value: string): string {
  if (typeof value !== "string") throw new PnrrChildcareQueryError("CUP non valido: testo atteso.");
  const cup = value.trim().toUpperCase();
  if (!/^[A-Z0-9]{15}$/.test(cup)) throw new PnrrChildcareQueryError("CUP non valido: sono richiesti 15 caratteri alfanumerici.");
  return cup;
}

function boundedFilter(value: string | undefined, field: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new PnrrChildcareQueryError(`${field} deve essere testo.`);
  const normalized = value.trim();
  if (normalized.length > 200) throw new PnrrChildcareQueryError(`${field} supera il limite di 200 caratteri.`);
  return normalized || undefined;
}

function matchesTerritory(name: string | null, code: string | null, query: string): boolean {
  return [name, code].some((value) => value !== null && normalizedSearch(value) === query);
}

function boundedInteger(value: number | undefined, fallback: number, minimum: number, maximum: number, field: string): number {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new PnrrChildcareQueryError(`${field} deve essere un intero tra ${minimum} e ${maximum}.`);
  }
  return value;
}

function searchable(project: PnrrChildcareProject): string {
  return normalizedSearch([
    project.cup,
    project.title,
    project.summary,
    project.implementer.name,
    ...project.locations.flatMap((location) => [
      location.region,
      location.regionCode,
      location.province,
      location.provinceCode,
      location.municipality,
      location.municipalityCode,
    ]),
  ].filter(Boolean).join(" "));
}

export function getPnrrChildcareProject(rawCup: string): PnrrChildcareProject | null {
  return projectsByCup.get(normalizedCup(rawCup)) ?? null;
}

export function getPnrrChildcareProjectsByImplementerTaxCode(
  rawTaxCode: string,
): readonly PnrrChildcareProject[] {
  const taxCode = rawTaxCode.trim();
  if (!/^\d{11}$/.test(taxCode)) return [];
  return projectsByImplementerTaxCode.get(taxCode) ?? [];
}

export function awardeesForTender(project: PnrrChildcareProject, tender: PnrrChildcareProject["tenders"][number]) {
  const tenderKey = [tender.cig, tender.internalProcedureCode, tender.userProcedureCode];
  return project.awardees.filter((awardee) =>
    tenderKey.some((value) => value !== null) &&
    awardee.cig === tender.cig &&
    awardee.internalProcedureCode === tender.internalProcedureCode &&
    awardee.userProcedureCode === tender.userProcedureCode);
}

export function queryPnrrChildcare(query: PnrrChildcareQuery = {}) {
  const limit = boundedInteger(query.limit, 24, 1, 100, "limit");
  const offset = boundedInteger(query.offset, 0, 0, 100_000, "offset");
  if (query.cup && (query.query || query.region || query.province)) {
    throw new PnrrChildcareQueryError("Con cup non usare anche q, region o province.");
  }
  let matches: PnrrChildcareProject[];
  if (query.cup) {
    const cup = normalizedCup(query.cup);
    const project = projectsByCup.get(cup);
    if (!project) throw new PnrrChildcareQueryError(`Nessun progetto trovato per il CUP ${cup}.`, "not_found");
    matches = [project];
  } else {
    const term = boundedFilter(query.query, "q");
    const region = boundedFilter(query.region, "region");
    const province = boundedFilter(query.province, "province");
    const normalizedTerm = term ? normalizedSearch(term) : null;
    const normalizedRegion = region ? normalizedSearch(region) : null;
    const normalizedProvince = province ? normalizedSearch(province) : null;
    matches = pnrrChildcareData.projects.filter((project) =>
      (!normalizedTerm || searchable(project).includes(normalizedTerm)) &&
      (!normalizedRegion || project.locations.some((location) => matchesTerritory(location.region, location.regionCode, normalizedRegion))) &&
      (!normalizedProvince || project.locations.some((location) => matchesTerritory(location.province, location.provinceCode, normalizedProvince))));
  }
  const page = matches.slice(offset, offset + limit);
  return {
    dataset: "pnrr_asili" as const,
    referenceDate: pnrrChildcareData.referenceDate,
    query: { ...query, limit, offset },
    pagination: { total: matches.length, limit, offset, returned: page.length },
    data: page,
    coverage: pnrrChildcareMeta.coverage,
    totals: pnrrChildcareMeta.totals,
    methodology: pnrrChildcareMeta.methodology,
    provenance: pnrrChildcareMeta.source,
  };
}
