import "server-only";

import { graphPersonId } from "@/lib/parlamento-giudiziario-format";
export { OUTCOME_LABELS, graphPersonId, formatSentenceMonths, formatEuroCents } from "@/lib/parlamento-giudiziario-format";
import snapshotJson from "@/data/generated/parlamento-giudiziario-xix.json";
import {
  parseParlamentoGiudiziarioSnapshot,
  type GiudiziarioCase,
  type GiudiziarioOutcome,
  type ParlamentoGiudiziarioSnapshot,
} from "@/lib/data/parlamento-giudiziario-contract";

/**
 * Single domain module for the judicial snapshot: the page and API route both
 * read from here. The snapshot is not exposed through the MCP catalog.
 */

let cached: ParlamentoGiudiziarioSnapshot | null = null;

export function getParlamentoGiudiziario(): ParlamentoGiudiziarioSnapshot {
  cached ??= parseParlamentoGiudiziarioSnapshot(snapshotJson);
  return cached;
}

const OUTCOME_ORDER: Record<GiudiziarioOutcome, number> = {
  condannato: 0,
  contabile: 1,
  esito_ignoto: 2,
  non_condannato: 3,
};

/** Cases of one person, most serious documented outcome first. */
export function casesForMember(memberId: string): GiudiziarioCase[] {
  return getParlamentoGiudiziario()
    .cases.filter((item) => item.memberId === memberId)
    .sort(
      (left, right) =>
        OUTCOME_ORDER[left.outcomeBucket] - OUTCOME_ORDER[right.outcomeBucket] ||
        right.statusAsOf.localeCompare(left.statusAsOf),
    );
}

export type MemberJudicialSummary = {
  memberId: string;
  /** What the marker on the graph says: presence of documented proceedings, never a severity score. */
  hasDocumentedCase: boolean;
  convictions: number;
  accounting: number;
  cleared: number;
  undocumentedOutcome: number;
};

export function summaryForMember(memberId: string): MemberJudicialSummary | null {
  const cases = casesForMember(memberId);
  if (cases.length === 0) {
    return null;
  }
  return {
    memberId,
    hasDocumentedCase: true,
    convictions: cases.filter((item) => item.outcomeBucket === "condannato").length,
    accounting: cases.filter((item) => item.outcomeBucket === "contabile").length,
    cleared: cases.filter((item) => item.outcomeBucket === "non_condannato").length,
    undocumentedOutcome: cases.filter((item) => item.outcomeBucket === "esito_ignoto").length,
  };
}

/** Member ids with at least one documented proceeding, for the graph marker. */
export function membersWithDocumentedCases(): ReadonlySet<string> {
  return new Set(getParlamentoGiudiziario().cases.map((item) => item.memberId));
}

/** Graph person ids with at least one documented proceeding, for the marker on the node. */
export function graphPeopleWithDocumentedCases(): string[] {
  const ids = new Set<string>();
  for (const item of getParlamentoGiudiziario().cases) {
    const id = graphPersonId(item.memberId);
    if (id) {
      ids.add(id);
    }
  }
  return [...ids].sort();
}

export function casesByGraphPerson(): Record<string, GiudiziarioCase[]> {
  const grouped: Record<string, GiudiziarioCase[]> = {};
  for (const item of getParlamentoGiudiziario().cases) {
    const id = graphPersonId(item.memberId);
    if (!id) {
      continue;
    }
    (grouped[id] ??= []).push(item);
  }
  for (const list of Object.values(grouped)) {
    list.sort(
      (left, right) =>
        OUTCOME_ORDER[left.outcomeBucket] - OUTCOME_ORDER[right.outcomeBucket] ||
        right.statusAsOf.localeCompare(left.statusAsOf),
    );
  }
  return grouped;
}

export function judicialCoverageNote(): string {
  const { coverage } = getParlamentoGiudiziario();
  const searched = coverage.membersSearched ?? 0;
  return (
    `Ricerca documentata su ${searched} dei ${coverage.membersExamined} parlamentari della legislatura, ` +
    `aggiornata al ${coverage.checkedAt}. L'assenza di procedimenti per una persona significa che la ricerca ` +
    "non ne ha trovati, non che non ne esistano."
  );
}

const CONVICTION_BUCKETS = new Set(["condannato", "contabile"]);

/**
 * Documented convictions for the atlante list: penal and Court of Auditors
 * convictions only. Non-conviction outcomes stay out of this view so the list
 * never reads as a full judicial dossier.
 */
export function documentedConvictions(): GiudiziarioCase[] {
  return getParlamentoGiudiziario()
    .cases.filter((item) => CONVICTION_BUCKETS.has(item.outcomeBucket))
    .sort(
      (left, right) =>
        OUTCOME_ORDER[left.outcomeBucket] - OUTCOME_ORDER[right.outcomeBucket] ||
        left.displayName.localeCompare(right.displayName, "it") ||
        right.statusAsOf.localeCompare(left.statusAsOf) ||
        left.caseId.localeCompare(right.caseId),
    );
}
