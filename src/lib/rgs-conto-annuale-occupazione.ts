import "server-only";

import { formatStaffCount, formatStaffDelta } from "@/lib/rgs-conto-annuale-occupazione-format";
import { computeStaffPeakSummary } from "@/lib/staff-series-chart";
import type { IntegratedDatasetMetadata } from "@/lib/integrated-public-view";
import { ENTE_DATASET_ID, TIPOLOGIA_DATASET_ID } from "@/lib/rgs-conto-annuale-occupazione-constants";
import {
  getOccupazioneCorpusPublicRows,
  getOccupazioneHubIndex,
  getOccupazioneSearchIndex,
  occupationHubMetadata,
  type OccupazioneHubIndex,
  type OccupazioneSearchEntry,
} from "@/lib/rgs-conto-annuale-occupazione-hub";
import {
  getOccupazioneInstitutionSummary,
  resolveComuneInstitutionCode,
  resolveInstitutionCodeFromDenominazione,
  type OccupazioneInstitutionSummary,
} from "@/lib/rgs-conto-annuale-occupazione-resolve";
import { getOccupazioneShardInstitution } from "@/lib/rgs-conto-annuale-occupazione-shards";

export { ENTE_DATASET_ID, TIPOLOGIA_DATASET_ID };
export type { OccupazioneHubIndex as OccupazioneIndex, OccupazioneInstitutionSummary, OccupazioneSearchEntry };

export {
  getOccupazioneCorpusPublicRows,
  getOccupazioneInstitutionSummary,
  resolveComuneInstitutionCode,
  resolveInstitutionCodeFromDenominazione,
};

/** @deprecated Prefer {@link getOccupazioneHubIndex} for hub-only aggregates. */
export function getOccupazioneIndex(): OccupazioneHubIndex {
  return getOccupazioneHubIndex();
}

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

export function searchOccupazioneInstitutions(query: string, limit = 12): readonly OccupazioneSearchEntry[] {
  const trimmed = query.trim().toLocaleUpperCase("it-IT");
  if (trimmed.length < 2) return [];
  return getOccupazioneSearchIndex()
    .filter((institution) => {
      if (institution.code === trimmed) return true;
      return institution.name.toLocaleUpperCase("it-IT").includes(trimmed);
    })
    .slice(0, limit);
}

export { formatStaffCount, formatStaffDelta };

function occupationDatasetMetadata(): IntegratedDatasetMetadata {
  const hub = occupationHubMetadata();
  return {
    id: ENTE_DATASET_ID,
    title: "Conto Annuale · occupazione per istituzione · 2010-2024",
    domain: "personnel",
    authority: "official-primary",
    licenseStatus: hub.licenseStatus,
    publication: "rows",
    evidenceLabel: "documented-fact",
    sourceRows: getOccupazioneCorpusPublicRows(),
    publicRows: getOccupazioneCorpusPublicRows(),
    rowsWithPublicSource: getOccupazioneCorpusPublicRows(),
    headers: ["Anno", "Codice istituzione", "Ente", "Tipo istituzione", ...PERMANENT_HEADERS, ...FLEXIBLE_HEADERS, "URL fonte"],
    caveats: hub.caveats,
    sourceMetadata: hub.sourceMetadata,
    provenanceHref: `/dati/${ENTE_DATASET_ID}`,
    queryable: true,
    publicationNote: "Righe pubblicate con fonte puntuale per ogni anno.",
    reuseNote: "Attribuzione MEF-RGS, OpenBDAP; proiezione DVNS.",
  };
}

export async function loadInstitutionStaffView(code: string): Promise<InstitutionStaffView | null> {
  const institution = getOccupazioneShardInstitution(code);
  if (!institution || institution.series.length === 0) return null;
  const points: StaffYearPoint[] = institution.series.map(([year, name, permanent, flexible, sourceUrl]) => ({
    year,
    name,
    permanent,
    flexible,
    sourceUrl,
  }));
  if (points.some((point, index) => index > 0 && point.year <= points[index - 1]!.year)) {
    throw new Error("Serie istituzionale non ordinata.");
  }
  const hub = getOccupazioneHubIndex();
  const latest = points.at(-1)!;
  const baseline = points.find((point) => point.year === hub.baselineYear) ?? null;
  const peakSummary = computeStaffPeakSummary(points);
  return {
    code,
    latestName: institution.name,
    type: institution.type,
    bdap: institution.bdap,
    nameVariants: institution.nameVariants,
    points,
    summary: {
      latestPermanent: latest.permanent,
      baselinePermanent: baseline?.permanent ?? null,
      deltaBaseline: baseline ? latest.permanent - baseline.permanent : null,
      peakPermanent: peakSummary.peakPermanent,
      peakYear: peakSummary.peakYear,
      deltaPeak: peakSummary.deltaPeak,
      latestFlexible: latest.flexible,
    },
    dataset: occupationDatasetMetadata(),
  };
}
