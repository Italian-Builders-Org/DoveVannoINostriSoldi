import "server-only";

import { formatStaffCount, formatStaffDelta } from "@/lib/rgs-conto-annuale-occupazione-format";
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
import {
  loadInstitutionStaffView,
  type InstitutionStaffView,
  type StaffYearPoint,
} from "@/lib/rgs-conto-annuale-occupazione-detail";

export { ENTE_DATASET_ID, TIPOLOGIA_DATASET_ID };
export type { OccupazioneHubIndex as OccupazioneIndex, OccupazioneInstitutionSummary, OccupazioneSearchEntry };
export type { InstitutionStaffView, StaffYearPoint };

export {
  getOccupazioneCorpusPublicRows,
  getOccupazioneInstitutionSummary,
  loadInstitutionStaffView,
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
