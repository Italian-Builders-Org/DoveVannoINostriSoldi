import "server-only";

import type { IntegratedDatasetMetadata } from "@/lib/integrated-public-view";
import { ENTE_DATASET_ID } from "@/lib/rgs-conto-annuale-occupazione-constants";
import {
  getOccupazioneCorpusPublicRows,
  getOccupazioneHubIndex,
  occupationHubMetadata,
} from "@/lib/rgs-conto-annuale-occupazione-summary";
import { getOccupazioneShardInstitution } from "@/lib/rgs-conto-annuale-occupazione-shards";
import { computeStaffPeakSummary } from "@/lib/staff-series-chart";

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

export type OccupazioneInstitutionHeadline = Readonly<{
  name: string;
  type: string;
}>;

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

/** Title/metadata for detail routes: reads only the institution shard, not resolve/by-code. */
export function getOccupazioneInstitutionHeadline(code: string): OccupazioneInstitutionHeadline | null {
  const institution = getOccupazioneShardInstitution(code);
  if (!institution || institution.series.length === 0) return null;
  return { name: institution.name, type: institution.type };
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
