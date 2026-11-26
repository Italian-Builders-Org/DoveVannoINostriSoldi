import rawList from "@/data/generated/svizzera-frontalieri-comuni-20km.json";

/**
 * Comuni within 20 km of the Swiss border, from the official list of the
 * Italy-Switzerland cross-border workers agreement (Annex B of the mutual
 * agreement of 22 December 2023, in force from 1 January 2024).
 *
 * Residents of these Comuni may work in Switzerland and be taxed there: that
 * income does not reach, or only partly reaches, the IRPEF returns the MEF
 * aggregates by Comune (issue #869). The flag explains a known limit of the
 * MEF figures; it does not correct or estimate them, and being in the list
 * says nothing about how many residents actually work across the border.
 *
 * The list is built and reconciled offline by
 * scripts/etl/svizzera_frontalieri_comuni_20km.py.
 */

type Row = readonly [istatCode: string, name: string, provinceCode: string, listedAs: string];

type BorderList = Readonly<{
  schemaVersion: number;
  datasetId: string;
  source: Readonly<{
    owner: string;
    title: string;
    url: string;
    landingUrl: string;
    authoritativeTitle: string;
    authoritativeUrl: string;
    signedAt: string;
    effectiveFrom: string;
    legalBasis: string;
    acquiredAt: string;
  }>;
  listedRows: number;
  previousCodes: Readonly<Record<string, string>>;
  columns: readonly string[];
  rows: readonly Row[];
}>;

const MUNICIPALITY_CODE = /^\d{6}$/;
const list = rawList as unknown as BorderList;

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Elenco dei Comuni di confine con la Svizzera non valido: ${message}`);
}

invariant(list.schemaVersion === 1 && list.datasetId === "svizzera-frontalieri-comuni-20km", "dataset inatteso");
invariant(list.source.url.startsWith("https://www.estv.admin.ch/"), "fonte non ufficiale");
invariant(list.source.effectiveFrom === "2024-01-01", "decorrenza inattesa");
invariant(list.columns.join(",") === "istatCode,name,provinceCode,listedAs", "colonne inattese");
invariant(list.rows.length > 0 && list.rows.length <= list.listedRows, "numero di Comuni incoerente");

const codes = new Set<string>();
for (const [code] of list.rows) {
  invariant(MUNICIPALITY_CODE.test(code) && !codes.has(code), `codice ${code}`);
  codes.add(code);
}
for (const [previous, current] of Object.entries(list.previousCodes)) {
  invariant(MUNICIPALITY_CODE.test(previous) && codes.has(current), `successione ${previous}`);
  // Sources older than a merger still publish the previous code of the same place.
  codes.add(previous);
}

export const swissBorderZoneSource = list.source;

/** True when the ISTAT code (current, or of a Comune merged since the list) is in the official list. */
export function isInSwissBorderZone(code: string): boolean {
  const normalized = code.trim();
  return MUNICIPALITY_CODE.test(normalized) && codes.has(normalized);
}

/** Number of current Comuni in the list. */
export function swissBorderZoneSize(): number {
  return list.rows.length;
}
