import type { RepublicActVote } from "@/lib/politici-repubblica";

export type RepublicVoteTone = "for" | "against" | "abstain" | "neutral";

export type RepublicVoteStateCounts = {
  favorevoli: number;
  contrari: number;
  astenuti: number;
  mancatePartecipazioni: number;
  presenzeSenzaVoto: number;
  missioniOCongedi: number;
  votiSegreti: number;
  datiNonRilevati: number;
  /** `null` means the snapshots do not provide historical mandate coverage. */
  fuoriMandato: number | null;
};

export type RepublicVoteCountKey = Exclude<keyof RepublicVoteStateCounts, "fuoriMandato">;

export const REPUBLIC_VOTE_COUNT_KEYS = [
  "favorevoli",
  "contrari",
  "astenuti",
  "mancatePartecipazioni",
  "presenzeSenzaVoto",
  "missioniOCongedi",
  "votiSegreti",
  "datiNonRilevati",
] as const satisfies readonly RepublicVoteCountKey[];

export const REPUBLIC_VOTE_COUNT_META = [
  { key: "favorevoli", label: "Favorevoli", shortLabel: "F" },
  { key: "contrari", label: "Contrari", shortLabel: "C" },
  { key: "astenuti", label: "Astenuti", shortLabel: "A" },
  { key: "mancatePartecipazioni", label: "Mancata partecipazione", shortLabel: "NP" },
  { key: "presenzeSenzaVoto", label: "Presente senza voto", shortLabel: "P" },
  { key: "missioniOCongedi", label: "Missione o congedo", shortLabel: "M" },
  { key: "votiSegreti", label: "Voto segreto", shortLabel: "VS" },
  { key: "datiNonRilevati", label: "Dato non rilevato", shortLabel: "NR" },
  { key: "fuoriMandato", label: "Fuori mandato", shortLabel: "FM" },
] as const;

export const REPUBLIC_VOTE_STATE_META = {
  F: { countKey: "favorevoli", label: "Favorevole", tone: "for" },
  C: { countKey: "contrari", label: "Contrario", tone: "against" },
  A: { countKey: "astenuti", label: "Astenuto/a", tone: "abstain" },
  N: { countKey: "mancatePartecipazioni", label: "Non ha votato", tone: "neutral" },
  V: { countKey: "votiSegreti", label: "Voto segreto", tone: "neutral" },
  P: { countKey: "presenzeSenzaVoto", label: "Presente non votante", tone: "neutral" },
  M: { countKey: "missioniOCongedi", label: "In congedo o missione", tone: "neutral" },
  "non-rilevato": {
    countKey: "datiNonRilevati",
    label: "Voto non rilevato nella fonte",
    tone: "neutral",
  },
} as const satisfies Record<RepublicActVote, {
  countKey: RepublicVoteCountKey;
  label: string;
  tone: RepublicVoteTone;
}>;

export const OWN_VOTE_LABELS = Object.fromEntries(
  Object.entries(REPUBLIC_VOTE_STATE_META).map(([code, state]) => [code, state.label]),
) as Record<RepublicActVote, string>;

export function isRepublicActVote(value: unknown): value is RepublicActVote {
  return typeof value === "string" && Object.hasOwn(REPUBLIC_VOTE_STATE_META, value);
}

export function emptyRepublicVoteStateCounts(): RepublicVoteStateCounts {
  return {
    favorevoli: 0,
    contrari: 0,
    astenuti: 0,
    mancatePartecipazioni: 0,
    presenzeSenzaVoto: 0,
    missioniOCongedi: 0,
    votiSegreti: 0,
    datiNonRilevati: 0,
    fuoriMandato: null,
  };
}

export function addRepublicVoteState(
  counts: RepublicVoteStateCounts,
  vote: RepublicActVote,
): void {
  counts[REPUBLIC_VOTE_STATE_META[vote].countKey] += 1;
}

export function countRepublicVoteStates(counts: RepublicVoteStateCounts): number {
  return REPUBLIC_VOTE_COUNT_KEYS.reduce((total, key) => total + counts[key], 0)
    + (counts.fuoriMandato ?? 0);
}

export function isRepublicVoteStateCounts(
  value: unknown,
): value is RepublicVoteStateCounts & Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return REPUBLIC_VOTE_COUNT_KEYS.every((key) => Number.isSafeInteger(record[key]) && Number(record[key]) >= 0)
    && (record.fuoriMandato === null
      || (Number.isSafeInteger(record.fuoriMandato) && Number(record.fuoriMandato) >= 0));
}

export function compactRepublicVoteStateCounts(counts: RepublicVoteStateCounts): string {
  return REPUBLIC_VOTE_COUNT_META
    .filter(({ key }) => counts[key] !== null && Number(counts[key]) > 0)
    .map(({ key, shortLabel }) => `${shortLabel} ${counts[key]}`)
    .join(" · ");
}

export function republicVoteTone(vote: RepublicActVote): RepublicVoteTone {
  return REPUBLIC_VOTE_STATE_META[vote].tone;
}
