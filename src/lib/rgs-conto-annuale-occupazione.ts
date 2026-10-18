import "server-only";

import { join } from "node:path";
import { readJsonSnapshot } from "@/lib/data/read-json-snapshot";
import { decimal, integer } from "@/lib/format";
import type { IntegratedDatasetMetadata } from "@/lib/integrated-public-view";

export const ENTE_DATASET_ID = "rgs-conto-annuale-occupazione-ente-2010-2024";
export const TIPOLOGIA_DATASET_ID = "rgs-conto-annuale-occupazione-tipologia-2010-2024";

const PERMANENT_HEADERS = [
  "Numero Dipendenti Donne Tempo Pieno",
  "Numero Dipendenti Uomini Tempo Pieno",
  "Numero Dipendenti Donne Part time Inf. 50%",
  "Numero Dipendenti Uomini Part time Inf. 50%",
  "Numero Dipendenti Donne Part time Sup. 50%",
  "Numero Dipendenti Uomini Part time Sup. 50%",
] as const;

const FLEXIBLE_HEADERS = [
  "Numero Dipendenti Donne Tempo Determinato",
  "Numero Dipendenti Uomini Tempo Determinato",
  "Numero Dipendenti Donne Formazione Lavoro",
  "Numero Dipendenti Uomini Formazione Lavoro",
  "Numero Dipendenti Donne Lavoro Interinale",
  "Numero Dipendenti Uomini Lavoro Interinale",
  "Numero Dipendenti Donne Lavoro Socialmente Utile",
  "Numero Dipendenti Uomini Lavoro Socialmente Utile",
] as const;

type IndexInstitution = Readonly<{
  code: string;
  name: string;
  type: string;
  bdap: string | null;
  permanentLatest: number;
  flexibleLatest: number;
  permanentBaseline: number | null;
  peakPermanent: number;
  peakYear: number;
  nameVariants: readonly string[];
  series: readonly (readonly [number, string, number, number, string])[];
}>;

type OccupazioneIndex = Readonly<{
  schemaVersion: 1;
  datasetId: string;
  tipologiaDatasetId: string;
  years: readonly number[];
  baselineYear: number;
  latestYear: number;
  institutionCount: number;
  publicRows: number;
  searchableCount: number;
  catalogSha256: string;
  rowsSha256: string;
  sourceMetadata: IntegratedDatasetMetadata["sourceMetadata"];
  caveats: readonly string[];
  licenseStatus: IntegratedDatasetMetadata["licenseStatus"];
  nationalSeries: readonly Readonly<{ year: number; permanent: number; flexible: number; types: number }>[];
  typeTotalsLatest: readonly Readonly<{ type: string; permanent: number; flexible: number; institutions: number }>[];
  growth: readonly Readonly<{ code: string; name: string; type: string; baseline: number; latest: number; delta: number }>[];
  shrink: readonly Readonly<{ code: string; name: string; type: string; baseline: number; latest: number; delta: number }>[];
  comuneNameToCode: Readonly<Record<string, string>>;
  institutions: readonly IndexInstitution[];
}>;

export type StaffYearPoint = Readonly<{
  year: number;
  name: string;
  permanent: number;
  flexible: number;
  sourceUrl: string;
}>;

export type InstitutionStaffView = Readonly<{
  code: string;
  latestName: string;
  type: string;
  bdap: string | null;
  nameVariants: readonly string[];
  points: readonly StaffYearPoint[];
  summary: Readonly<{
    latestPermanent: number;
    baselinePermanent: number | null;
    deltaBaseline: number | null;
    peakPermanent: number;
    peakYear: number;
    deltaPeak: number | null;
    latestFlexible: number;
  }>;
  dataset: IntegratedDatasetMetadata;
}>;

const index = readJsonSnapshot(
  join(process.cwd(), "src/data/generated/rgs-conto-annuale-occupazione-ente-index/index.json"),
  32 * 1024 * 1024,
) as OccupazioneIndex;

if (index.schemaVersion !== 1 || index.datasetId !== ENTE_DATASET_ID) {
  throw new Error("Indice Conto Annuale occupazione: schema o dataset divergenti.");
}

function parseMeasure(raw: string | null, decimalYear: boolean): number {
  if (raw === null || raw.trim() === "") {
    throw new Error("Misura mancante nel corpus integrato.");
  }
  const trimmed = raw.trim();
  if (decimalYear) {
    if (!/^(?:0|[1-9]\d*)\.\d{2}$/.test(trimmed)) throw new Error(`Misura decimale non valida: ${trimmed}`);
    return Number(trimmed);
  }
  if (!/^(?:0|[1-9]\d*)$/.test(trimmed)) throw new Error(`Misura intera non valida: ${trimmed}`);
  return Number(trimmed);
}

export function sumPermanentFromCells(cells: Readonly<Record<string, string | null>>, year: number): number {
  const decimalYear = year >= 2021;
  return PERMANENT_HEADERS.reduce(
    (sum, header) => sum + parseMeasure(cells[header], decimalYear),
    0,
  );
}

export function sumFlexibleFromCells(cells: Readonly<Record<string, string | null>>, year: number): number {
  const decimalYear = year >= 2021;
  const total = FLEXIBLE_HEADERS.reduce(
    (sum, header) => sum + parseMeasure(cells[header], decimalYear),
    0,
  );
  return Math.round(total * 100) / 100;
}

export function getOccupazioneIndex(): OccupazioneIndex {
  return index;
}

export function searchOccupazioneInstitutions(query: string, limit = 12): readonly IndexInstitution[] {
  const trimmed = query.trim().toLocaleUpperCase("it-IT");
  if (trimmed.length < 2) return [];
  const matches = index.institutions.filter((institution) => {
    if (institution.code === trimmed) return true;
    if (institution.name.toLocaleUpperCase("it-IT").includes(trimmed)) return true;
    return institution.nameVariants.some((name) => name.toLocaleUpperCase("it-IT").includes(trimmed));
  });
  return matches.slice(0, limit);
}

export function getOccupazioneInstitutionSummary(code: string): IndexInstitution | null {
  if (!/^[1-9]\d*$/.test(code)) return null;
  return index.institutions.find((institution) => institution.code === code) ?? null;
}

export function resolveComuneInstitutionCode(rawName: string): string | null {
  const key = rawName.trim().toLocaleUpperCase("it-IT");
  if (!key) return null;
  const direct = index.comuneNameToCode[key];
  if (direct) return direct;
  const withPrefix = `COMUNE DI ${key.replace(/^COMUNE\s+DI\s+/i, "").trim()}`;
  return index.comuneNameToCode[withPrefix] ?? null;
}

export function resolveInstitutionCodeFromDenominazione(rawName: string): string | null {
  const comune = resolveComuneInstitutionCode(rawName);
  if (comune) return comune;
  const key = rawName.trim().toLocaleUpperCase("it-IT");
  if (!key) return null;
  const matches = index.institutions.filter(
    (institution) =>
      institution.name.toLocaleUpperCase("it-IT") === key ||
      institution.nameVariants.some((name) => name.toLocaleUpperCase("it-IT") === key),
  );
  if (matches.length === 1) return matches[0]!.code;
  return null;
}

export function formatStaffCount(value: number): string {
  return Number.isInteger(value) ? integer(value) : decimal(value, 2);
}

export function formatStaffDelta(value: number): string {
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  return `${sign}${formatStaffCount(Math.abs(value))}`;
}

function pointsFromIndexSeries(summary: IndexInstitution): StaffYearPoint[] {
  return summary.series.map(([year, name, permanent, flexible, sourceUrl]) => ({
    year,
    name,
    permanent,
    flexible,
    sourceUrl,
  }));
}

export async function loadInstitutionStaffView(code: string): Promise<InstitutionStaffView | null> {
  const summary = getOccupazioneInstitutionSummary(code);
  if (!summary || summary.series.length === 0) return null;
  const points = pointsFromIndexSeries(summary);
  if (points.some((point, index) => index > 0 && point.year <= points[index - 1]!.year)) {
    throw new Error("Serie istituzionale non ordinata.");
  }
  const latest = points.at(-1)!;
  const baseline = points.find((point) => point.year === index.baselineYear) ?? null;
  let peak = latest;
  for (const point of points) {
    if (point.permanent > peak.permanent) peak = point;
  }
  return {
    code,
    latestName: summary.name,
    type: summary.type,
    bdap: summary.bdap,
    nameVariants: summary.nameVariants,
    points,
    summary: {
      latestPermanent: latest.permanent,
      baselinePermanent: baseline?.permanent ?? null,
      deltaBaseline: baseline ? latest.permanent - baseline.permanent : null,
      peakPermanent: peak.permanent,
      peakYear: peak.year,
      deltaPeak: latest.permanent - peak.permanent,
      latestFlexible: latest.flexible,
    },
    dataset: occupationDatasetMetadata(),
  };
}

function occupationDatasetMetadata(): IntegratedDatasetMetadata {
  return {
    id: ENTE_DATASET_ID,
    title: "Conto Annuale · occupazione per istituzione · 2010-2024",
    domain: "personnel",
    authority: "official-primary",
    licenseStatus: index.licenseStatus,
    publication: "rows",
    evidenceLabel: "documented-fact",
    sourceRows: index.publicRows,
    publicRows: index.publicRows,
    rowsWithPublicSource: index.publicRows,
    headers: ["Anno", "Codice istituzione", "Ente", "Tipo istituzione", ...PERMANENT_HEADERS, ...FLEXIBLE_HEADERS, "URL fonte"],
    caveats: index.caveats,
    sourceMetadata: index.sourceMetadata,
    provenanceHref: `/dati/${ENTE_DATASET_ID}`,
    queryable: true,
    publicationNote: "Righe pubblicate con fonte puntuale per ogni anno.",
    reuseNote: "Attribuzione MEF-RGS, OpenBDAP; proiezione DVNS.",
  };
}
