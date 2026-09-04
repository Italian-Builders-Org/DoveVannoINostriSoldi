import "server-only";

import type { IpaEntity } from "@/lib/ipa";

import detail2024 from "@/data/generated/siope-municipal-detail-2024.json";
import detail2025 from "@/data/generated/siope-municipal-detail-2025.json";
import detail2026 from "@/data/generated/siope-municipal-detail.json";
import { partialMonthOf } from "@/lib/siope-calendar";
import { getSiopeMunicipalSnapshot } from "@/lib/siope-snapshot";
import {
  eurosPerSquareKilometreCents,
  getMunicipalityGeographyByTaxCodeIfNameAgrees,
  type MunicipalityGeography,
} from "@/lib/municipality-geography";

const TITLE_ORDER = ["0", "1", "2", "3", "4", "5", "7"] as const;
const EXPECTED_COLUMNS = [
  "taxCode",
  "codiceIpa",
  "name",
  "province",
  "region",
  "population",
  "totalCents",
  "titleCents",
] as const;
const CANONICAL_IPA_CODE = /^[A-Za-z0-9_]+$/;

export type SiopeMunicipalityTitle = Readonly<{
  code: string;
  label: string;
  amountCents: number;
}>;

export type SiopeMunicipalityYear = Readonly<{
  year: number;
  latestMonth: number;
  completeness: "complete" | "partial";
  observedAt: string;
  hasMovements: boolean;
  totalCents: number | null;
  population: number | null;
  perCapitaCents: number | null;
  perSquareKmCents: number | null;
  geography: MunicipalityGeography | null;
  titles: readonly SiopeMunicipalityTitle[];
}>;

export type SiopeMunicipalityDetail = Readonly<{
  taxCode: string;
  codiceIpa: string | null;
  name: string;
  province: string;
  region: string | null;
  years: readonly SiopeMunicipalityYear[];
}>;

type PackedRow = readonly [
  taxCode: string,
  codiceIpa: string | null,
  name: string,
  province: string,
  region: string | null,
  population: number | null,
  totalCents: number | null,
  titleCents: readonly number[] | null,
];

type ValidatedArtifact = Readonly<{
  year: number;
  latestMonth: number;
  generatedAt: string;
  titleLabels: Readonly<Record<string, string>>;
  rows: readonly PackedRow[];
}>;

function object(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${field}: oggetto atteso`);
  }
  return value as Record<string, unknown>;
}

function integer(value: unknown, field: string, minimum = 0): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) {
    throw new Error(`${field}: intero sicuro atteso`);
  }
  return value as number;
}

function text(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${field}: testo atteso`);
  return value;
}

function optionalText(value: unknown, field: string): string | null {
  return value === null ? null : text(value, field);
}

function assertStringArray(value: unknown, expected: readonly string[], field: string) {
  if (!Array.isArray(value) || value.length !== expected.length) {
    throw new Error(`${field}: elenco inatteso`);
  }
  for (const [index, item] of value.entries()) {
    if (item !== expected[index]) throw new Error(`${field}[${index}]: valore inatteso`);
  }
}

function validateArtifact(value: unknown, expectedYear: number): ValidatedArtifact {
  const artifact = object(value, `SIOPE dettaglio ${expectedYear}`);
  if (artifact.schemaVersion !== 1 || artifact.scope !== "municipality-detail") {
    throw new Error(`SIOPE dettaglio ${expectedYear}: contratto v1 atteso`);
  }
  if (artifact.year !== expectedYear) throw new Error(`SIOPE dettaglio ${expectedYear}: anno inatteso`);
  const latestMonth = integer(artifact.latestMonth, `SIOPE dettaglio ${expectedYear}.latestMonth`, 1);
  if (latestMonth > 12) throw new Error(`SIOPE dettaglio ${expectedYear}: mese oltre dicembre`);
  const generatedAt = text(artifact.generatedAt, `SIOPE dettaglio ${expectedYear}.generatedAt`);
  if (Number.isNaN(new Date(generatedAt).getTime())) throw new Error(`SIOPE dettaglio ${expectedYear}: data non valida`);
  assertStringArray(artifact.titleOrder, TITLE_ORDER, `SIOPE dettaglio ${expectedYear}.titleOrder`);
  assertStringArray(artifact.columns, EXPECTED_COLUMNS, `SIOPE dettaglio ${expectedYear}.columns`);
  const labels = object(artifact.titleLabels, `SIOPE dettaglio ${expectedYear}.titleLabels`);
  for (const code of TITLE_ORDER) text(labels[code], `SIOPE dettaglio ${expectedYear}.titleLabels.${code}`);

  if (!Array.isArray(artifact.municipalities)) throw new Error(`SIOPE dettaglio ${expectedYear}: righe attese`);
  const seen = new Set<string>();
  const seenIpaCodes = new Set<string>();
  let withMovements = 0;
  let withPopulation = 0;
  let withRegion = 0;
  let withIpaIdentifier = 0;
  let totalCents = 0;
  const rows = artifact.municipalities.map((raw, index): PackedRow => {
    if (!Array.isArray(raw) || raw.length !== EXPECTED_COLUMNS.length) {
      throw new Error(`SIOPE dettaglio ${expectedYear}.municipalities[${index}]: otto colonne attese`);
    }
    const taxCode = text(raw[0], `SIOPE dettaglio ${expectedYear}.municipalities[${index}].taxCode`);
    if (!/^\d{11}$/.test(taxCode) || seen.has(taxCode)) {
      throw new Error(`SIOPE dettaglio ${expectedYear}: codice fiscale non valido o duplicato ${taxCode}`);
    }
    seen.add(taxCode);
    const codiceIpa = optionalText(raw[1], `SIOPE dettaglio ${expectedYear}.municipalities[${index}].codiceIpa`);
    if (codiceIpa !== null) {
      if (
        codiceIpa !== codiceIpa.trim() ||
        !CANONICAL_IPA_CODE.test(codiceIpa) ||
        seenIpaCodes.has(codiceIpa)
      ) {
        throw new Error(`SIOPE dettaglio ${expectedYear}: Codice IPA non canonico o duplicato ${codiceIpa}`);
      }
      seenIpaCodes.add(codiceIpa);
      withIpaIdentifier += 1;
    }
    const name = text(raw[2], `SIOPE dettaglio ${expectedYear}.municipalities[${index}].name`);
    const province = text(raw[3], `SIOPE dettaglio ${expectedYear}.municipalities[${index}].province`);
    const region = optionalText(raw[4], `SIOPE dettaglio ${expectedYear}.municipalities[${index}].region`);
    if (region !== null) withRegion += 1;
    const population = raw[5] === null ? null : integer(raw[5], `SIOPE dettaglio ${expectedYear}.municipalities[${index}].population`, 2);
    if (population !== null) withPopulation += 1;
    if ((raw[6] === null) !== (raw[7] === null)) {
      throw new Error(`SIOPE dettaglio ${expectedYear}: totale e Titoli devono essere entrambi presenti o assenti`);
    }
    if (raw[6] === null) return [taxCode, codiceIpa, name, province, region, population, null, null];
    const total = integer(raw[6], `SIOPE dettaglio ${expectedYear}.municipalities[${index}].totalCents`);
    if (!Array.isArray(raw[7]) || raw[7].length !== TITLE_ORDER.length) {
      throw new Error(`SIOPE dettaglio ${expectedYear}: sette Titoli attesi per ${taxCode}`);
    }
    const titles = raw[7].map((amount, titleIndex) =>
      integer(amount, `SIOPE dettaglio ${expectedYear}.${taxCode}.titles[${titleIndex}]`));
    if (titles.reduce((sum, amount) => sum + amount, 0) !== total) {
      throw new Error(`SIOPE dettaglio ${expectedYear}: Titoli non riconciliati per ${taxCode}`);
    }
    withMovements += 1;
    totalCents += total;
    return [taxCode, codiceIpa, name, province, region, population, total, titles];
  });

  const coverage = object(artifact.coverage, `SIOPE dettaglio ${expectedYear}.coverage`);
  if (
    coverage.activeMunicipalities !== rows.length ||
    coverage.withMovements !== withMovements ||
    coverage.withoutMovements !== rows.length - withMovements ||
    coverage.withPopulation !== withPopulation ||
    coverage.withRegion !== withRegion ||
    coverage.withIpaIdentifier !== withIpaIdentifier
  ) {
    throw new Error(`SIOPE dettaglio ${expectedYear}: copertura non riconciliata`);
  }
  const snapshot = getSiopeMunicipalSnapshot(expectedYear);
  if (
    snapshot.latestMonth !== latestMonth ||
    snapshot.source.observedAt !== generatedAt ||
    Math.round(snapshot.totalPaid * 100) !== totalCents
  ) {
    throw new Error(`SIOPE dettaglio ${expectedYear}: totale o periodo divergente dallo snapshot nazionale`);
  }
  return { year: expectedYear, latestMonth, generatedAt, titleLabels: labels as Record<string, string>, rows };
}

const artifacts = [
  validateArtifact(detail2026, 2026),
  validateArtifact(detail2025, 2025),
  validateArtifact(detail2024, 2024),
];

const rowsByYearAndTaxCode = new Map(
  artifacts.map((artifact) => [artifact.year, new Map(artifact.rows.map((row) => [row[0], row]))]),
);
const taxCodeByIpaCode = new Map<string, string>();
for (const artifact of artifacts) {
  for (const row of artifact.rows) {
    if (row[1] && !taxCodeByIpaCode.has(row[1])) taxCodeByIpaCode.set(row[1], row[0]);
  }
}

export function getSiopeMunicipalityDetail(rawTaxCode: string): SiopeMunicipalityDetail | null {
  const taxCode = rawTaxCode.trim();
  if (!/^\d{11}$/.test(taxCode)) return null;
  const identity = artifacts
    .map((artifact) => rowsByYearAndTaxCode.get(artifact.year)?.get(taxCode))
    .find((row): row is PackedRow => row !== undefined);
  if (!identity) return null;

  return {
    taxCode,
    codiceIpa: identity[1],
    name: identity[2],
    province: identity[3],
    region: identity[4],
    years: artifacts.map((artifact): SiopeMunicipalityYear => {
      const row = rowsByYearAndTaxCode.get(artifact.year)?.get(taxCode);
      const geography = getMunicipalityGeographyByTaxCodeIfNameAgrees(artifact.year, taxCode, identity[2]);
      if (!row) {
        return {
          year: artifact.year,
          latestMonth: artifact.latestMonth,
          completeness: partialMonthOf(artifact.year, artifact.latestMonth, artifact.generatedAt) === null ? "complete" : "partial",
          observedAt: artifact.generatedAt,
          hasMovements: false,
          totalCents: null,
          population: null,
          perCapitaCents: null,
          perSquareKmCents: null,
          geography,
          titles: [],
        };
      }
      const titles = row[7]?.map((amount, index) => ({
        code: TITLE_ORDER[index],
        label: artifact.titleLabels[TITLE_ORDER[index]],
        amountCents: amount,
      })) ?? [];
      return {
        year: artifact.year,
        latestMonth: artifact.latestMonth,
        completeness: partialMonthOf(artifact.year, artifact.latestMonth, artifact.generatedAt) === null ? "complete" : "partial",
        observedAt: artifact.generatedAt,
        hasMovements: row[6] !== null,
        totalCents: row[6],
        population: row[5],
        perCapitaCents: row[6] !== null && row[5] !== null ? Math.round(row[6] / row[5]) : null,
        perSquareKmCents: eurosPerSquareKilometreCents(
          row[6],
          geography?.surfaceSquareMetres ?? null,
        ),
        geography,
        titles,
      };
    }),
  };
}

/** Resolve the latest committed municipal identity without request-time I/O. */
export function getSiopeMunicipalityDetailByIpaCode(rawCode: string): SiopeMunicipalityDetail | null {
  const code = rawCode.trim();
  if (!CANONICAL_IPA_CODE.test(code)) return null;
  const taxCode = taxCodeByIpaCode.get(code);
  return taxCode ? getSiopeMunicipalityDetail(taxCode) : null;
}

export type SiopeMunicipalityPeerObservation = Readonly<{
  taxCode: string;
  name: string;
  province: string;
  region: string | null;
  totalCents: number;
  perCapitaCents: number | null;
  perSquareKmCents: number;
  geography: MunicipalityGeography;
}>;

export type SiopeMunicipalityPeerCoverage = Readonly<{
  activeMunicipalities: number;
  withMovements: number;
  withoutMovements: number;
  withGeography: number;
  withMovementsAndGeography: number;
  withMovementsWithoutGeography: number;
}>;

export function getSiopeMunicipalityPeerCoverage(year: number): SiopeMunicipalityPeerCoverage {
  const artifact = artifacts.find((item) => item.year === year);
  if (!artifact) {
    return {
      activeMunicipalities: 0,
      withMovements: 0,
      withoutMovements: 0,
      withGeography: 0,
      withMovementsAndGeography: 0,
      withMovementsWithoutGeography: 0,
    };
  }

  let withMovements = 0;
  let withGeography = 0;
  let withMovementsAndGeography = 0;
  for (const row of artifact.rows) {
    const hasMovements = row[6] !== null;
    const geography = getMunicipalityGeographyByTaxCodeIfNameAgrees(year, row[0], row[2]);
    const hasGeography = geography !== null;
    if (hasMovements) withMovements += 1;
    if (hasGeography) withGeography += 1;
    if (hasMovements && eurosPerSquareKilometreCents(row[6], geography?.surfaceSquareMetres ?? null) !== null) {
      withMovementsAndGeography += 1;
    }
  }
  return {
    activeMunicipalities: artifact.rows.length,
    withMovements,
    withoutMovements: artifact.rows.length - withMovements,
    withGeography,
    withMovementsAndGeography,
    withMovementsWithoutGeography: withMovements - withMovementsAndGeography,
  };
}

export function getSiopeMunicipalityPeerObservations(year: number): readonly SiopeMunicipalityPeerObservation[] {
  const artifact = artifacts.find((item) => item.year === year);
  if (!artifact) return [];
  return artifact.rows.flatMap((row) => {
    const geography = getMunicipalityGeographyByTaxCodeIfNameAgrees(year, row[0], row[2]);
    const perSquareKmCents = eurosPerSquareKilometreCents(
      row[6],
      geography?.surfaceSquareMetres ?? null,
    );
    if (row[6] === null || !geography || perSquareKmCents === null) return [];
    return [{
      taxCode: row[0],
      name: row[2],
      province: row[3],
      region: row[4],
      totalCents: row[6],
      perCapitaCents: row[5] === null ? null : Math.round(row[6] / row[5]),
      perSquareKmCents,
      geography,
    }];
  });
}

export const siopeMunicipalityDetailCoverage = artifacts.map((artifact) => ({
  year: artifact.year,
  municipalities: artifact.rows.length,
}));

/**
 * Public paths of the municipal profile pages, enumerated from the committed
 * SIOPE detail snapshots without request-time I/O. The ETL publishes
 * `codiceIpa` only when the official registries map the municipality's tax
 * code to exactly one Codice IPA, so rows without an unambiguous Codice IPA
 * carry `null` and are excluded here explicitly. Every identifier used below
 * has already passed the fail-closed contract of `validateArtifact`.
 */
export function getMunicipalityEntityPublicPaths(): readonly `/enti/${string}`[] {
  const codes = new Set<string>();
  for (const artifact of artifacts) {
    for (const row of artifact.rows) {
      if (row[1] !== null) codes.add(row[1]);
    }
  }
  return [...codes]
    .sort((left, right) => left.localeCompare(right, "en"))
    .map((code) => `/enti/${encodeURIComponent(code)}` as const);
}

/** Minimal IPA-compatible identities for offline municipal keyword search. */
export function getMunicipalitySearchEntities(): readonly IpaEntity[] {
  const latest = artifacts[0];
  const byIpa = new Map<string, IpaEntity>();
  for (const row of latest.rows) {
    const codiceIpa = row[1];
    if (!codiceIpa || byIpa.has(codiceIpa)) continue;
    byIpa.set(codiceIpa, {
      codiceIpa,
      denominazione: row[2],
      codiceFiscale: row[0],
      tipologia: "Comune",
      codiceCategoria: null,
      codiceNatura: null,
      codiceAteco: null,
      inLiquidazione: null,
      codiceMiur: null,
      codiceIstat: null,
      acronimo: null,
      responsabile: { nome: null, cognome: null, titolo: null },
      sede: {
        codiceComuneIstat: null,
        codiceCatastaleComune: null,
        cap: null,
        indirizzo: null,
      },
      email: [],
      sitoIstituzionale: null,
      social: { facebook: null, linkedin: null, twitter: null, youtube: null },
      dataAggiornamento: null,
    });
  }
  return [...byIpa.values()];
}
