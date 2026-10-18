import "server-only";

import { join } from "node:path";
import { readJsonSnapshot } from "@/lib/data/read-json-snapshot";
import { OCCUPAZIONE_INDEX_DIR } from "@/lib/rgs-conto-annuale-occupazione-paths";

export type OccupazioneInstitutionSummary = Readonly<{
  code: string;
  name: string;
  type: string;
  bdap: string | null;
  permanentLatest: number;
  flexibleLatest: number;
  permanentBaseline: number | null;
  peakPermanent: number;
  peakYear: number;
}>;

type OccupazioneResolveNames = Readonly<{
  schemaVersion: 1;
  comuneNameToCode: Readonly<Record<string, string>>;
  exactNameToCode: Readonly<Record<string, string>>;
}>;

type OccupazioneByCodeIndex = Readonly<{
  schemaVersion: 1;
  byCode: Readonly<Record<string, OccupazioneInstitutionSummary>>;
}>;

const resolveNames = readJsonSnapshot(join(OCCUPAZIONE_INDEX_DIR, "resolve.json"), 1024 * 1024) as OccupazioneResolveNames;

if (resolveNames.schemaVersion !== 1) {
  throw new Error("Indice resolve occupazione: schema divergente.");
}

let byCodeIndex: OccupazioneByCodeIndex | null = null;

function loadByCodeIndex(): OccupazioneByCodeIndex {
  if (byCodeIndex) return byCodeIndex;
  byCodeIndex = readJsonSnapshot(join(OCCUPAZIONE_INDEX_DIR, "by-code.json"), 4 * 1024 * 1024) as OccupazioneByCodeIndex;
  if (byCodeIndex.schemaVersion !== 1 || typeof byCodeIndex.byCode !== "object") {
    throw new Error("Indice by-code occupazione: schema divergente.");
  }
  return byCodeIndex;
}

export function resolveComuneInstitutionCode(rawName: string): string | null {
  const key = rawName.trim().toLocaleUpperCase("it-IT");
  if (!key) return null;
  const direct = resolveNames.comuneNameToCode[key];
  if (direct) return direct;
  const withPrefix = `COMUNE DI ${key.replace(/^COMUNE\s+DI\s+/i, "").trim()}`;
  return resolveNames.comuneNameToCode[withPrefix] ?? null;
}

export function resolveInstitutionCodeFromDenominazione(rawName: string): string | null {
  const comune = resolveComuneInstitutionCode(rawName);
  if (comune) return comune;
  const key = rawName.trim().toLocaleUpperCase("it-IT");
  if (!key) return null;
  return resolveNames.exactNameToCode[key] ?? null;
}

export function getOccupazioneInstitutionSummary(code: string): OccupazioneInstitutionSummary | null {
  if (!/^[1-9]\d*$/.test(code)) return null;
  return loadByCodeIndex().byCode[code] ?? null;
}
