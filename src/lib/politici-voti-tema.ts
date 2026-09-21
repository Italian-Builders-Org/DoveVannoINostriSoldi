import {
  parseCameraAttiVotiSnapshot,
} from "@/lib/data/camera-atti-voti-contract";
import {
  parseSenatoAttiVotiSnapshot,
} from "@/lib/data/senato-atti-voti-contract";
import {
  findRepublicPerson,
  getRepubblicaGraph,
  type RepublicActVote,
} from "@/lib/politici-repubblica";
import {
  VOTE_THEMES,
  type VoteThemeDefinition,
} from "@/lib/politici-voti-tema-catalog";
import cameraAttiVotiJson from "@/data/generated/camera-atti-voti-xix.json";
import senatoAttiVotiJson from "@/data/generated/senato-atti-voti-xix.json";

export { VOTE_THEMES, type VoteThemeDefinition } from "@/lib/politici-voti-tema-catalog";

const cameraSnapshot = parseCameraAttiVotiSnapshot(cameraAttiVotiJson);
const senatoSnapshot = parseSenatoAttiVotiSnapshot(senatoAttiVotiJson);
const cameraVoteById = new Map(cameraSnapshot.finalVotes.map((vote) => [vote.id, vote]));
const senatoVoteById = new Map(senatoSnapshot.finalVotes.map((vote) => [vote.id, vote]));

export type ThemeVoteRow = {
  voteId: string;
  actId: string;
  actNumber: string;
  actTitle: string;
  officialPage: string;
  date: string;
  approved: boolean;
  confidenceVote: boolean;
  favorevoli: number;
  contrari: number;
  astenuti: number;
  ownVote: RepublicActVote;
  matchedNeedles: string[];
};

export type ThemeVoteSummary = {
  totale: number;
  favorevoli: number;
  contrari: number;
  astenuti: number;
  nonVotato: number;
  altro: number;
};

export type ThemeOptionStats = VoteThemeDefinition & {
  chamberVotes: number;
  expressedVotes: number;
  nonVotato: number;
};

export type ThemeYearBucket = {
  year: string;
  events: number;
  cameraEvents: number;
  senatoEvents: number;
  favorevoli: number;
  contrari: number;
  astenuti: number;
  nonVotato: number;
};

export type ThemeVotesResult = {
  personId: string;
  chamber: "camera" | "senato";
  theme: VoteThemeDefinition | null;
  query: string | null;
  periodLabel: string;
  observedDate: string;
  sourceUrl: string;
  sourceLabel: string;
  licenseLabel: string;
  summary: ThemeVoteSummary;
  votes: ThemeVoteRow[];
  years: ThemeYearBucket[];
  themes: ThemeOptionStats[];
  caveats: string[];
};

export type ThemeEventVoter = {
  personId: string;
  name: string;
  groupLabel: string | null;
  ownVote: RepublicActVote;
};

export type ThemeHistoryEventBase = {
  voteId: string;
  chamber: "camera" | "senato";
  actId: string;
  actNumber: string;
  actTitle: string;
  officialPage: string;
  date: string;
  approved: boolean;
  confidenceVote: boolean;
  favorevoli: number;
  contrari: number;
  astenuti: number;
  matchedNeedles: string[];
};

export type ThemeHistoryEvent = ThemeHistoryEventBase & {
  /** Voti individuali espressi nel perimetro filtrato (F/C/A). */
  voters: {
    favorevoli: ThemeEventVoter[];
    contrari: ThemeEventVoter[];
    astenuti: ThemeEventVoter[];
  };
};

export type ThemeHistoryMember = {
  personId: string;
  name: string;
  chamber: "camera" | "senato";
  groupLabel: string | null;
  summary: ThemeVoteSummary;
  expressedVotes: number;
  years: ThemeYearBucket[];
};

export type ThemeChamberFilter = "tutti" | "camera" | "senato";

export type ThemeHistoryResult = {
  theme: VoteThemeDefinition | null;
  query: string | null;
  personQuery: string | null;
  chamber: ThemeChamberFilter;
  expressedOnly: boolean;
  periodLabel: string;
  observedDate: string;
  cameraSourceUrl: string;
  cameraSourceLabel: string;
  senatoSourceUrl: string;
  senatoSourceLabel: string;
  events: ThemeHistoryEvent[];
  years: ThemeYearBucket[];
  members: ThemeHistoryMember[];
  themes: Array<VoteThemeDefinition & { chamberVotes: number }>;
  caveats: string[];
};

type IndexedVote = {
  event: ThemeHistoryEventBase;
  votesByNumericId: Readonly<Record<string, string>>;
};

function stripMarkup(value: string): string {
  return value.replace(/<[^>]+>/gu, " ").replace(/\s+/gu, " ").trim();
}

function normalizeNeedle(value: string): string {
  return value
    .normalize("NFKD")
    .replaceAll(/\p{M}/gu, "")
    .toLocaleLowerCase("it-IT")
    .replaceAll(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function titleMatches(title: string, needles: readonly string[]): string[] {
  const haystack = normalizeNeedle(stripMarkup(title));
  if (!haystack) return [];
  const tokens = haystack.split(/\s+/u).filter(Boolean);
  return needles.filter((needle) => {
    const n = normalizeNeedle(needle);
    if (!n) return false;
    const parts = n.split(/\s+/u).filter(Boolean);
    if (parts.length > 1) {
      const pattern = parts.map(escapeRegExp).join("\\s+");
      return new RegExp(`(?:^|\\s)${pattern}(?:$|\\s)`, "u").test(haystack);
    }
    const stem = parts[0]!;
    return tokens.some((token) => token === stem || (stem.length >= 4 && token.startsWith(stem)));
  });
}

function emptySummary(): ThemeVoteSummary {
  return { totale: 0, favorevoli: 0, contrari: 0, astenuti: 0, nonVotato: 0, altro: 0 };
}

function accumulate(summary: ThemeVoteSummary, ownVote: RepublicActVote): void {
  summary.totale += 1;
  if (ownVote === "F") summary.favorevoli += 1;
  else if (ownVote === "C") summary.contrari += 1;
  else if (ownVote === "A") summary.astenuti += 1;
  else if (ownVote === "N" || ownVote === "P" || ownVote === "M" || ownVote === "non-rilevato") summary.nonVotato += 1;
  else summary.altro += 1;
}

function yearOf(date: string): string | null {
  const match = /^(\d{4})-/u.exec(date);
  return match?.[1] ?? null;
}

function emptyYearBucket(year: string): ThemeYearBucket {
  return {
    year,
    events: 0,
    cameraEvents: 0,
    senatoEvents: 0,
    favorevoli: 0,
    contrari: 0,
    astenuti: 0,
    nonVotato: 0,
  };
}

function accumulateYear(
  bucket: ThemeYearBucket,
  ownVote: RepublicActVote | null,
  chamber: "camera" | "senato" | null,
): void {
  bucket.events += 1;
  if (chamber === "camera") bucket.cameraEvents += 1;
  if (chamber === "senato") bucket.senatoEvents += 1;
  if (ownVote === "F") bucket.favorevoli += 1;
  else if (ownVote === "C") bucket.contrari += 1;
  else if (ownVote === "A") bucket.astenuti += 1;
  else if (ownVote === "N" || ownVote === "P" || ownVote === "M" || ownVote === "non-rilevato") bucket.nonVotato += 1;
}

function yearsFromRows(
  rows: ReadonlyArray<{ date: string; ownVote: RepublicActVote; chamber?: "camera" | "senato" }>,
): ThemeYearBucket[] {
  const byYear = new Map<string, ThemeYearBucket>();
  for (const row of rows) {
    const year = yearOf(row.date);
    if (!year) continue;
    const bucket = byYear.get(year) ?? emptyYearBucket(year);
    accumulateYear(bucket, row.ownVote, row.chamber ?? null);
    byYear.set(year, bucket);
  }
  return [...byYear.values()].sort((left, right) => right.year.localeCompare(left.year));
}

function yearsFromEvents(events: readonly ThemeHistoryEvent[]): ThemeYearBucket[] {
  const byYear = new Map<string, ThemeYearBucket>();
  for (const event of events) {
    const year = yearOf(event.date);
    if (!year) continue;
    const bucket = byYear.get(year) ?? emptyYearBucket(year);
    accumulateYear(bucket, null, event.chamber);
    byYear.set(year, bucket);
  }
  return [...byYear.values()].sort((left, right) => right.year.localeCompare(left.year));
}

function sortVotes(rows: ThemeVoteRow[]): ThemeVoteRow[] {
  return [...rows].sort((left, right) => {
    const byDate = right.date.localeCompare(left.date);
    if (byDate !== 0) return byDate;
    return left.actNumber.localeCompare(right.actNumber, "it");
  });
}

function summarizeRows(rows: readonly ThemeVoteRow[]): ThemeVoteSummary {
  const summary = emptySummary();
  for (const vote of rows) accumulate(summary, vote.ownVote);
  return summary;
}

function expressedCount(summary: ThemeVoteSummary): number {
  return summary.favorevoli + summary.contrari + summary.astenuti;
}

/** Index matching final votes once; reuse vote maps for every parliamentarian. */
function indexChamberVotes(
  chamber: "camera" | "senato",
  needles: readonly string[],
): IndexedVote[] {
  if (needles.length === 0) return [];
  const indexed: IndexedVote[] = [];
  if (chamber === "camera") {
    for (const act of cameraSnapshot.acts) {
      if (!act.title || act.finalVoteIds.length === 0) continue;
      const matched = titleMatches(act.title, needles);
      if (matched.length === 0) continue;
      for (const voteId of act.finalVoteIds) {
        const vote = cameraVoteById.get(voteId);
        if (!vote) continue;
        indexed.push({
          event: {
            voteId: vote.id,
            chamber: "camera",
            actId: act.id,
            actNumber: act.number,
            actTitle: stripMarkup(act.title),
            officialPage: act.officialPage,
            date: vote.date,
            approved: vote.approved,
            confidenceVote: vote.confidenceVote,
            favorevoli: vote.favorevoli,
            contrari: vote.contrari,
            astenuti: vote.astenuti,
            matchedNeedles: matched,
          },
          votesByNumericId: vote.votes,
        });
      }
    }
    return indexed;
  }
  for (const act of senatoSnapshot.acts) {
    if (!act.title || act.finalVoteIds.length === 0) continue;
    const matched = titleMatches(act.title, needles);
    if (matched.length === 0) continue;
    for (const voteId of act.finalVoteIds) {
      const vote = senatoVoteById.get(voteId);
      if (!vote) continue;
      indexed.push({
        event: {
          voteId: vote.id,
          chamber: "senato",
          actId: act.id,
          actNumber: act.number,
          actTitle: stripMarkup(act.title ?? `Disegno ${act.number}`),
          officialPage: act.officialPage,
          date: vote.date,
          approved: vote.approved,
          confidenceVote: false,
          favorevoli: vote.favorevoli,
          contrari: vote.contrari,
          astenuti: vote.astenuti,
          matchedNeedles: matched,
        },
        votesByNumericId: vote.votes,
      });
    }
  }
  return indexed;
}

function cameraRows(numericId: string, needles: readonly string[]): ThemeVoteRow[] {
  return indexChamberVotes("camera", needles).map((item) => ({
    ...item.event,
    ownVote: (item.votesByNumericId[numericId] ?? "non-rilevato") as RepublicActVote,
    confidenceVote: item.event.confidenceVote,
  }));
}

function senatoRows(numericId: string, needles: readonly string[]): ThemeVoteRow[] {
  return indexChamberVotes("senato", needles).map((item) => ({
    ...item.event,
    ownVote: (item.votesByNumericId[numericId] ?? "non-rilevato") as RepublicActVote,
    confidenceVote: false,
  }));
}

function themeStatsForPerson(
  chamber: "camera" | "senato",
  numericId: string,
): ThemeOptionStats[] {
  return VOTE_THEMES.map((theme) => {
    const indexed = indexChamberVotes(chamber, theme.needles);
    const summary = emptySummary();
    for (const item of indexed) {
      accumulate(summary, (item.votesByNumericId[numericId] ?? "non-rilevato") as RepublicActVote);
    }
    return {
      ...theme,
      chamberVotes: indexed.length,
      expressedVotes: expressedCount(summary),
      nonVotato: summary.nonVotato,
    };
  });
}

let cachedThemeInventory: Array<VoteThemeDefinition & { chamberVotes: number }> | null = null;

function chamberThemeInventory(): Array<VoteThemeDefinition & { chamberVotes: number }> {
  if (cachedThemeInventory) return cachedThemeInventory;
  cachedThemeInventory = VOTE_THEMES.map((theme) => ({
    ...theme,
    chamberVotes:
      indexChamberVotes("camera", theme.needles).length
      + indexChamberVotes("senato", theme.needles).length,
  }));
  return cachedThemeInventory;
}

function resolveNeedles(themeId: string | null, queryRaw: string | null): {
  theme: VoteThemeDefinition | null;
  needles: string[];
} | null {
  const theme = themeId ? VOTE_THEMES.find((item) => item.id === themeId) ?? null : null;
  if (themeId && !theme) return null;
  const queryNeedles = queryRaw && normalizeNeedle(queryRaw).length >= 3
    ? [normalizeNeedle(queryRaw)]
    : [];
  return {
    theme,
    needles: theme ? [...theme.needles, ...queryNeedles] : queryNeedles,
  };
}

function numericIdFor(personId: string, chamber: "camera" | "senato"): string | null {
  if (chamber === "camera" && personId.startsWith("dep-")) return personId.slice("dep-".length);
  if (chamber === "senato" && personId.startsWith("sen-s")) return personId.slice("sen-s".length);
  return null;
}

const CAVEATS = [
  "I temi raggruppano votazioni finali il cui titolo ufficiale contiene le parole chiave del tema: non sono una classificazione ufficiale di Camera o Senato.",
  "Sono incluse solo le votazioni finali sugli atti di iniziativa parlamentare già nello snapshot della XIX legislatura; i disegni a prima firma del Governo restano fuori perimetro.",
  "Una ricerca senza votazioni finali collegate non prova assenza di attività sul tema: molte proposte non arrivano al voto d’aula nello snapshot.",
  "Il voto individuale segue i codici ufficiali della fonte; «non ha votato» / «non rilevato» non equivale a un giudizio di merito e non va confuso con il conteggio delle votazioni in aula sul tema.",
] as const;

export function listVoteThemesForChamber(chamber: "camera" | "senato") {
  return VOTE_THEMES.map((theme) => ({
    ...theme,
    chamberVotes: indexChamberVotes(chamber, theme.needles).length,
  }));
}

export function getRepubblicaThemeVotes(options: {
  personId: string;
  themeId?: string | null;
  query?: string | null;
}): ThemeVotesResult | null {
  const person = findRepublicPerson(options.personId);
  if (!person || (person.chamberId !== "camera" && person.chamberId !== "senato")) return null;

  const chamber = person.chamberId;
  const themeId = options.themeId?.trim() || null;
  const queryRaw = options.query?.trim() || null;
  const resolved = resolveNeedles(themeId, queryRaw);
  if (!resolved) return null;
  const { theme, needles } = resolved;
  const numericId = numericIdFor(person.id, chamber);
  if (!numericId) return null;

  const votes = needles.length === 0
    ? []
    : sortVotes(chamber === "camera" ? cameraRows(numericId, needles) : senatoRows(numericId, needles));

  const summary = summarizeRows(votes);
  const source = chamber === "camera" ? cameraSnapshot.provenance : senatoSnapshot.provenance;
  const period = chamber === "camera" ? cameraSnapshot.period : senatoSnapshot.period;

  return {
    personId: person.id,
    chamber,
    theme,
    query: queryRaw,
    periodLabel: period.label,
    observedDate: period.observedDate,
    sourceUrl: source.landingUrl,
    sourceLabel: source.title,
    licenseLabel: source.license,
    summary,
    votes,
    years: yearsFromRows(votes.map((vote) => ({ date: vote.date, ownVote: vote.ownVote, chamber }))),
    themes: themeStatsForPerson(chamber, numericId),
    caveats: [...CAVEATS],
  };
}

export function getThemeVoteHistory(options: {
  themeId?: string | null;
  query?: string | null;
  personQuery?: string | null;
  chamber?: ThemeChamberFilter | null;
  expressedOnly?: boolean | null;
}): ThemeHistoryResult | null {
  const themeId = options.themeId?.trim() || null;
  const queryRaw = options.query?.trim() || null;
  const personQueryRaw = options.personQuery?.trim() || null;
  const chamber: ThemeChamberFilter = options.chamber === "camera" || options.chamber === "senato"
    ? options.chamber
    : "tutti";
  const personTokens = personQueryRaw
    ? normalizeNeedle(personQueryRaw).split(/\s+/u).filter(Boolean)
    : [];
  // Default: only expressed voters, unless searching a name (include absences) or explicitly disabled.
  const expressedOnly = options.expressedOnly === false
    ? false
    : options.expressedOnly === true
      ? true
      : personTokens.length === 0;

  const resolved = resolveNeedles(themeId, queryRaw);
  if (!resolved) return null;
  const { theme, needles } = resolved;

  const cameraIndexed = chamber === "senato" ? [] : indexChamberVotes("camera", needles);
  const senatoIndexed = chamber === "camera" ? [] : indexChamberVotes("senato", needles);
  const indexedByKey = new Map<string, IndexedVote>();
  for (const item of [...cameraIndexed, ...senatoIndexed]) {
    indexedByKey.set(`${item.event.chamber}:${item.event.voteId}`, item);
  }

  const graph = getRepubblicaGraph();
  const groups = new Map(graph.groups.map((group) => [group.id, group]));
  const members: ThemeHistoryMember[] = [];
  const votersByEvent = new Map<string, ThemeHistoryEvent["voters"]>();

  function ensureVoters(key: string): ThemeHistoryEvent["voters"] {
    const existing = votersByEvent.get(key);
    if (existing) return existing;
    const created = { favorevoli: [], contrari: [], astenuti: [] } satisfies ThemeHistoryEvent["voters"];
    votersByEvent.set(key, created);
    return created;
  }

  function pushVoter(
    bucket: ThemeHistoryEvent["voters"],
    ownVote: RepublicActVote,
    voter: ThemeEventVoter,
  ): void {
    if (ownVote === "F") bucket.favorevoli.push(voter);
    else if (ownVote === "C") bucket.contrari.push(voter);
    else if (ownVote === "A") bucket.astenuti.push(voter);
  }

  for (const person of graph.people) {
    if (person.chamberId !== "camera" && person.chamberId !== "senato") continue;
    if (chamber !== "tutti" && person.chamberId !== chamber) continue;
    const numericId = numericIdFor(person.id, person.chamberId);
    if (!numericId) continue;
    if (personTokens.length > 0) {
      const haystack = normalizeNeedle(person.displayName);
      if (!personTokens.every((token) => haystack.includes(token))) continue;
    }

    const indexed = person.chamberId === "camera" ? cameraIndexed : senatoIndexed;
    if (indexed.length === 0) continue;

    const summary = emptySummary();
    const yearRows: Array<{ date: string; ownVote: RepublicActVote; chamber: "camera" | "senato" }> = [];
    const group = person.groupId ? groups.get(person.groupId) : null;
    const groupLabel = group?.shortLabel ?? group?.label ?? null;

    for (const item of indexed) {
      const ownVote = (item.votesByNumericId[numericId] ?? "non-rilevato") as RepublicActVote;
      accumulate(summary, ownVote);
      yearRows.push({ date: item.event.date, ownVote, chamber: person.chamberId });
    }
    const expressed = expressedCount(summary);
    if (expressedOnly && expressed === 0) continue;

    for (const item of indexed) {
      const ownVote = (item.votesByNumericId[numericId] ?? "non-rilevato") as RepublicActVote;
      pushVoter(
        ensureVoters(`${item.event.chamber}:${item.event.voteId}`),
        ownVote,
        {
          personId: person.id,
          name: person.displayName,
          groupLabel,
          ownVote,
        },
      );
    }

    members.push({
      personId: person.id,
      name: person.displayName,
      chamber: person.chamberId,
      groupLabel,
      summary,
      expressedVotes: expressed,
      years: yearsFromRows(yearRows),
    });
  }

  members.sort((left, right) =>
    right.expressedVotes - left.expressedVotes
    || left.name.localeCompare(right.name, "it", { sensitivity: "base" })
    || left.personId.localeCompare(right.personId));

  for (const bucket of votersByEvent.values()) {
    for (const list of [bucket.favorevoli, bucket.contrari, bucket.astenuti]) {
      list.sort((left, right) => left.name.localeCompare(right.name, "it", { sensitivity: "base" })
        || left.personId.localeCompare(right.personId));
    }
  }

  const events = [...indexedByKey.values()]
    .map((item) => ({
      ...item.event,
      voters: votersByEvent.get(`${item.event.chamber}:${item.event.voteId}`)
        ?? { favorevoli: [], contrari: [], astenuti: [] },
    }))
    .sort((left, right) => {
      const byDate = right.date.localeCompare(left.date);
      if (byDate !== 0) return byDate;
      return left.actNumber.localeCompare(right.actNumber, "it");
    });

  const observedDates = [cameraSnapshot.period.observedDate, senatoSnapshot.period.observedDate]
    .sort();

  return {
    theme,
    query: queryRaw,
    personQuery: personQueryRaw,
    chamber,
    expressedOnly,
    periodLabel: cameraSnapshot.period.label,
    observedDate: observedDates.at(-1) ?? cameraSnapshot.period.observedDate,
    cameraSourceUrl: cameraSnapshot.provenance.landingUrl,
    cameraSourceLabel: cameraSnapshot.provenance.title,
    senatoSourceUrl: senatoSnapshot.provenance.landingUrl,
    senatoSourceLabel: senatoSnapshot.provenance.title,
    events,
    years: yearsFromEvents(events),
    members,
    themes: chamberThemeInventory(),
    caveats: [...CAVEATS],
  };
}

/** Exposed for tests: person rows without re-scanning acts when indexed. */
export function __testOnly_indexSize(themeId: string, chamber: "camera" | "senato"): number {
  const theme = VOTE_THEMES.find((item) => item.id === themeId);
  if (!theme) return 0;
  return indexChamberVotes(chamber, theme.needles).length;
}
