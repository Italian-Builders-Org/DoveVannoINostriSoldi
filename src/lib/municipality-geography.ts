import "server-only";

import rawSnapshot from "@/data/generated/istat-municipality-geography.json";

export type MunicipalityGeography = Readonly<{
  year: number;
  referenceDate: string;
  istatCode: string;
  taxCode: string | null;
  regionCode: string;
  name: string;
  surfaceSquareMetres: number;
  surfaceSquareKilometres: number;
  residentPopulation: number | null;
  populationYear: number | null;
  densityPerSquareKilometre: number | null;
  altimetricZone: number | null;
  altimetricZoneLabel: string | null;
  altitudeMetres: number | null;
  coastal: boolean;
  island: boolean;
  degreeUrbanization: number | null;
  degreeUrbanizationLabel: string | null;
}>;

type PackedRow = readonly [
  istatCode: string,
  taxCode: string | null,
  regionCode: string,
  name: string,
  surfaceSquareMetres: number,
  residentPopulation: number | null,
  populationYear: number | null,
  altimetricZone: number | null,
  altitudeMetres: number | null,
  coastal: boolean,
  island: boolean,
  degreeUrbanization: number | null,
];

const ALTITUDE_LABELS: Readonly<Record<number, string>> = {
  1: "Montagna interna",
  2: "Montagna litoranea",
  3: "Collina interna",
  4: "Collina litoranea",
  5: "Pianura",
};

const URBANIZATION_LABELS: Readonly<Record<number, string>> = {
  1: "Città o zona densamente popolata",
  2: "Città minore o zona a densità intermedia",
  3: "Zona rurale o scarsamente popolata",
};

const EXPECTED_COLUMNS = [
  "istatCode",
  "taxCode",
  "regionCode",
  "name",
  "surfaceSquareMetres",
  "residentPopulation",
  "populationYear",
  "altimetricZone",
  "altitudeMetres",
  "coastal",
  "island",
  "degreeUrbanization",
] as const;

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Snapshot geografico ISTAT non valido: ${message}`);
}

type GeographySnapshot = Readonly<{
  schemaVersion: number;
  datasetId: string;
  generatedAt: string;
  source: typeof rawSnapshot.source;
  columns: readonly string[];
  years: Array<{ year: number; referenceDate: string; municipalities: number; rows: PackedRow[] }>;
}>;

const snapshot = rawSnapshot as unknown as GeographySnapshot;

invariant(snapshot.schemaVersion === 1, "schemaVersion inattesa");
invariant(snapshot.datasetId === "istat-municipality-geography", "dataset inatteso");
invariant(
  snapshot.columns.length === EXPECTED_COLUMNS.length &&
    snapshot.columns.every((column, index) => column === EXPECTED_COLUMNS[index]),
  "colonne inattese",
);

const indexes = new Map<number, { byIstat: Map<string, PackedRow>; byTaxCode: Map<string, PackedRow> }>();
for (const year of snapshot.years) {
  invariant(year.rows.length === year.municipalities && year.rows.length > 7_800, `copertura ${year.year}`);
  const byIstat = new Map<string, PackedRow>();
  const byTaxCode = new Map<string, PackedRow>();
  for (const row of year.rows) {
    invariant(/^\d{6}$/.test(row[0]) && !byIstat.has(row[0]), `codice ISTAT ${year.year}/${row[0]}`);
    invariant(Number.isSafeInteger(row[4]) && row[4] > 0, `superficie ${year.year}/${row[0]}`);
    byIstat.set(row[0], row);
    if (row[1] && /^\d{11}$/.test(row[1])) {
      invariant(!byTaxCode.has(row[1]), `codice fiscale duplicato ${year.year}/${row[1]}`);
      byTaxCode.set(row[1], row);
    }
  }
  indexes.set(year.year, { byIstat, byTaxCode });
}

export const availableMunicipalityGeographyYears = snapshot.years.map((year) => year.year);
export const municipalityGeographySource = snapshot.source;

function unpack(year: number, referenceDate: string, row: PackedRow): MunicipalityGeography {
  const squareKilometres = row[4] / 1_000_000;
  return {
    year,
    referenceDate,
    istatCode: row[0],
    taxCode: row[1],
    regionCode: row[2],
    name: row[3],
    surfaceSquareMetres: row[4],
    surfaceSquareKilometres: squareKilometres,
    residentPopulation: row[5],
    populationYear: row[6],
    densityPerSquareKilometre: row[5] === null ? null : row[5] / squareKilometres,
    altimetricZone: row[7],
    altimetricZoneLabel: row[7] === null ? null : ALTITUDE_LABELS[row[7]] ?? `Zona ${row[7]}`,
    altitudeMetres: row[8],
    coastal: row[9],
    island: row[10],
    degreeUrbanization: row[11],
    degreeUrbanizationLabel: row[11] === null ? null : URBANIZATION_LABELS[row[11]] ?? `Classe ${row[11]}`,
  };
}

function yearRecord(year: number) {
  return snapshot.years.find((item) => item.year === year) ?? null;
}

export function getMunicipalityGeographyByIstatCode(year: number, code: string): MunicipalityGeography | null {
  const record = yearRecord(year);
  const row = indexes.get(year)?.byIstat.get(code.trim());
  return record && row ? unpack(year, record.referenceDate, row) : null;
}

export function getMunicipalityGeographyByTaxCode(year: number, taxCode: string): MunicipalityGeography | null {
  const record = yearRecord(year);
  const row = indexes.get(year)?.byTaxCode.get(taxCode.trim());
  return record && row ? unpack(year, record.referenceDate, row) : null;
}

function normalizeMunicipalityName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLocaleUpperCase("it-IT")
    .replace(/^COMUNE\s+(DI|DEL|DELLA|DELLO|DEI|DEGLI|DELLE)\s+/u, "")
    .replace(/\s+CAPITALE$/u, "")
    .replace(/[''`´]/g, "")
    .replace(/[^A-Z0-9/-]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function compactMunicipalityName(name: string): string {
  return normalizeMunicipalityName(name).replace(/[ /-]/g, "");
}

function italianIstatNameCandidates(istatName: string): string[] {
  const normalized = normalizeMunicipalityName(istatName);
  const candidates = [normalized];
  for (const part of normalized.split("/")) {
    const trimmed = part.trim();
    if (trimmed) candidates.push(trimmed);
    const hyphen = trimmed.lastIndexOf("-");
    if (hyphen >= 3 && trimmed.length - hyphen - 1 >= 3) {
      candidates.push(trimmed.slice(0, hyphen).trim());
    }
  }
  return candidates;
}

function siopeNameCandidates(siopeName: string): string[] {
  const normalized = normalizeMunicipalityName(siopeName);
  const candidates = [normalized];
  const epithet = normalized.match(/^(.*)\s-\s[A-Z0-9]+$/);
  if (epithet?.[1]) candidates.push(epithet[1].trim());
  return candidates;
}

function compactedNamesAgree(left: string, right: string): boolean {
  if (left === right) return true;
  const delta = left.length - right.length;
  if (delta > 1 || delta < -1) {
    const [shorter, longer] = left.length < right.length ? [left, right] : [right, left];
    return shorter.length >= 8 && longer.startsWith(shorter);
  }
  const [a, b] = left.length <= right.length ? [left, right] : [right, left];
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i += 1;
      j += 1;
      continue;
    }
    edits += 1;
    if (edits > 1) return false;
    if (a.length === b.length) {
      i += 1;
      j += 1;
    } else {
      j += 1;
    }
  }
  return edits + (b.length - j) <= 1;
}

/**
 * ISTAT SITUAS report 61 has a known COD_COM_FISCALE rotation in the Fermo
 * and Salerno clusters. A tax-code hit is usable only when the SIOPE name
 * still identifies the same municipality; otherwise the join must fail closed.
 */
export function municipalityNamesAgree(siopeName: string, istatName: string): boolean {
  const istatCandidates = italianIstatNameCandidates(istatName).map(compactMunicipalityName);
  return siopeNameCandidates(siopeName).some((candidate) => {
    const left = compactMunicipalityName(candidate);
    return Boolean(left) && istatCandidates.some((right) => compactedNamesAgree(left, right));
  });
}

export function getMunicipalityGeographyByTaxCodeIfNameAgrees(
  year: number,
  taxCode: string,
  siopeName: string,
): MunicipalityGeography | null {
  const geography = getMunicipalityGeographyByTaxCode(year, taxCode);
  if (!geography || !municipalityNamesAgree(siopeName, geography.name)) return null;
  return geography;
}

export function eurosPerSquareKilometreCents(
  amountCents: number | null,
  surfaceSquareMetres: number | null,
): number | null {
  if (amountCents === null || surfaceSquareMetres === null || surfaceSquareMetres <= 0) return null;
  const sign = amountCents < 0 ? -1 : 1;
  return sign * Math.floor((Math.abs(amountCents) / surfaceSquareMetres) * 1_000_000 + 0.5);
}

/**
 * Calculate one aggregate €/km² value only when every amount has a valid
 * geography denominator. A partial numerator/denominator pair is not a
 * national metric: returning null keeps the coverage boundary visible.
 */
export function aggregateEurosPerSquareKilometreCents(
  rows: ReadonlyArray<Readonly<{ amountCents: number; surfaceSquareMetres: number | null }>>,
): number | null {
  if (rows.length === 0) return null;
  if (rows.some((row) =>
    !Number.isSafeInteger(row.amountCents) ||
    row.surfaceSquareMetres === null ||
    !Number.isSafeInteger(row.surfaceSquareMetres) ||
    row.surfaceSquareMetres <= 0,
  )) {
    return null;
  }
  const amountCents = rows.reduce((total, row) => total + row.amountCents, 0);
  const surfaceSquareMetres = rows.reduce((total, row) => total + (row.surfaceSquareMetres ?? 0), 0);
  if (!Number.isSafeInteger(amountCents) || !Number.isSafeInteger(surfaceSquareMetres)) return null;
  return eurosPerSquareKilometreCents(amountCents, surfaceSquareMetres);
}

export function populationBand(population: number | null): string | null {
  if (population === null) return null;
  if (population < 1_000) return "Meno di 1.000 abitanti";
  if (population < 5_000) return "1.000–4.999 abitanti";
  if (population < 20_000) return "5.000–19.999 abitanti";
  if (population < 50_000) return "20.000–49.999 abitanti";
  if (population < 100_000) return "50.000–99.999 abitanti";
  if (population < 250_000) return "100.000–249.999 abitanti";
  if (population < 500_000) return "250.000–499.999 abitanti";
  return "500.000 abitanti o più";
}

export function surfaceBand(surfaceSquareMetres: number): string {
  const km2 = surfaceSquareMetres / 1_000_000;
  if (km2 < 10) return "Meno di 10 km²";
  if (km2 < 50) return "10–49,99 km²";
  if (km2 < 200) return "50–199,99 km²";
  if (km2 < 500) return "200–499,99 km²";
  return "500 km² o più";
}

export type RegionGeography = Readonly<{
  year: number;
  regionCode: string;
  municipalities: number;
  surfaceSquareMetres: number;
  surfaceSquareKilometres: number;
  residentPopulation: number;
  densityPerSquareKilometre: number;
  coastalMunicipalities: number;
  islandMunicipalities: number;
}>;

export function getRegionGeography(year: number, regionCode: string): RegionGeography | null {
  const record = yearRecord(year);
  if (!record) return null;
  const rows = record.rows.filter((row) => {
    if (regionCode === "21") return row[0].startsWith("022");
    if (regionCode === "22") return row[0].startsWith("021");
    return row[2] === regionCode;
  });
  if (rows.length === 0) return null;
  const surfaceSquareMetres = rows.reduce((sum, row) => sum + row[4], 0);
  const residentPopulation = rows.reduce((sum, row) => sum + (row[5] ?? 0), 0);
  const surfaceSquareKilometres = surfaceSquareMetres / 1_000_000;
  return {
    year,
    regionCode,
    municipalities: rows.length,
    surfaceSquareMetres,
    surfaceSquareKilometres,
    residentPopulation,
    densityPerSquareKilometre: residentPopulation / surfaceSquareKilometres,
    coastalMunicipalities: rows.filter((row) => row[9]).length,
    islandMunicipalities: rows.filter((row) => row[10]).length,
  };
}

export function municipalityGeographyRows(year: number): readonly MunicipalityGeography[] {
  const record = yearRecord(year);
  return record ? record.rows.map((row) => unpack(year, record.referenceDate, row)) : [];
}
