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
const projectsByLocationMunicipality = new Map<string, PnrrChildcareProject[]>();
const implementerTaxCodesByEntityName = new Map<string, Set<string>>();

function normalizedTerritoryName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleUpperCase("it-IT")
    .replace(/['’`]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function entityNameKeys(rawName: string): readonly string[] {
  const normalized = normalizedTerritoryName(rawName);
  if (!normalized) return [];
  const keys = new Set<string>([normalized]);
  const stripped = normalized
    .replace(/^COMUNE DI\s+/, "")
    .replace(/^CITTA['’]?\s+DI\s+/, "")
    .replace(/^CITTA\s+DI\s+/, "")
    .trim();
  if (stripped) keys.add(stripped);
  if (stripped === "ROMA" || normalized === "ROMA CAPITALE") {
    keys.add("ROMA");
    keys.add("ROMA CAPITALE");
  }
  return [...keys];
}

for (const project of pnrrChildcareData.projects) {
  const taxCode = project.implementer.taxCode?.trim();
  if (taxCode) {
    const projects = projectsByImplementerTaxCode.get(taxCode) ?? [];
    projects.push(project);
    projectsByImplementerTaxCode.set(taxCode, projects);
    if (project.implementer.name) {
      for (const key of entityNameKeys(project.implementer.name)) {
        const codes = implementerTaxCodesByEntityName.get(key) ?? new Set<string>();
        codes.add(taxCode);
        implementerTaxCodesByEntityName.set(key, codes);
      }
    }
  }
  for (const location of project.locations) {
    if (!location.municipality) continue;
    for (const key of entityNameKeys(location.municipality)) {
      const projects = projectsByLocationMunicipality.get(key) ?? [];
      projects.push(project);
      projectsByLocationMunicipality.set(key, projects);
    }
  }
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

// Only validated snapshot references enter this index; user queries are never retained.
// A new snapshot/module has new project references and builds its own index.
const searchableProjects = new WeakMap<PnrrChildcareProject, string>();

function searchable(project: PnrrChildcareProject): string {
  const cached = searchableProjects.get(project);
  if (cached !== undefined) return cached;
  const value = normalizedSearch([
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
  searchableProjects.set(project, value);
  return value;
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

/**
 * Official ReGiS/Italia Domani often publish a municipal CF that differs from
 * the current SIOPE/IPA fiscal code (e.g. Roma Capitale). Resolve alternate
 * implementer codes by exact entity-name match on the committed snapshot.
 */
export function getPnrrImplementerTaxCodesForMunicipality(
  taxCode: string,
  entityName: string,
): readonly string[] {
  const codes = new Set<string>();
  const primary = taxCode.trim();
  if (/^\d{11}$/.test(primary)) codes.add(primary);
  for (const key of entityNameKeys(entityName)) {
    for (const code of implementerTaxCodesByEntityName.get(key) ?? []) codes.add(code);
  }
  return [...codes].sort();
}

/**
 * Childcare projects localised on the municipality by official place name.
 * Municipality codes in the snapshot are not ISTAT-6; name match is the
 * fail-closed join available without inventing geography.
 */
export function getPnrrChildcareProjectsForMunicipality(input: Readonly<{
  taxCode: string;
  entityName: string;
}>): readonly PnrrChildcareProject[] {
  const byCup = new Map<string, PnrrChildcareProject>();
  for (const code of getPnrrImplementerTaxCodesForMunicipality(input.taxCode, input.entityName)) {
    for (const project of projectsByImplementerTaxCode.get(code) ?? []) {
      byCup.set(project.cup, project);
    }
  }
  for (const key of entityNameKeys(input.entityName)) {
    for (const project of projectsByLocationMunicipality.get(key) ?? []) {
      byCup.set(project.cup, project);
    }
  }
  return [...byCup.values()].sort((left, right) => left.cup.localeCompare(right.cup, "en"));
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
