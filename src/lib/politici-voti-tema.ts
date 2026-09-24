import { z } from "zod";
import {
  parseCameraAttiVotiSnapshot,
} from "@/lib/data/camera-atti-voti-contract";
import {
  parseSenatoAttiVotiSnapshot,
} from "@/lib/data/senato-atti-voti-contract";
import { parsePoliticiCameraSnapshot } from "@/lib/data/politici-camera-contract";
import { parsePoliticiSenatoSnapshot } from "@/lib/data/politici-senato-contract";
import {
  findRepublicPerson,
  getRepubblicaGraph,
  type RepublicActVote,
} from "@/lib/politici-repubblica";
import {
  addRepublicVoteState,
  emptyRepublicVoteStateCounts,
  REPUBLIC_VOTE_STATE_META,
  type RepublicVoteStateCounts,
} from "@/lib/politici-vote-states";
import {
  VOTE_THEMES,
  type VoteThemeDefinition,
} from "@/lib/politici-voti-tema-catalog";
import cameraAttiVotiJson from "@/data/generated/camera-atti-voti-xix.json";
import cameraPeopleJson from "@/data/generated/politici-camera-xix.json";
import senatoAttiVotiJson from "@/data/generated/senato-atti-voti-xix.json";
import senatoPeopleJson from "@/data/generated/politici-senato-xix.json";
import curatedComparisonsJson from "@/data/politici-confronti-curati.json";

export { VOTE_THEMES, type VoteThemeDefinition } from "@/lib/politici-voti-tema-catalog";

const cameraSnapshot = parseCameraAttiVotiSnapshot(cameraAttiVotiJson);
const cameraPeopleSnapshot = parsePoliticiCameraSnapshot(cameraPeopleJson);
const senatoSnapshot = parseSenatoAttiVotiSnapshot(senatoAttiVotiJson);
const senatoPeopleSnapshot = parsePoliticiSenatoSnapshot(senatoPeopleJson);
const cameraVoteById = new Map(cameraSnapshot.finalVotes.map((vote) => [vote.id, vote]));
const senatoVoteById = new Map(senatoSnapshot.finalVotes.map((vote) => [vote.id, vote]));
const senatoActsByVoteId = new Map<string, typeof senatoSnapshot.acts>();
for (const act of senatoSnapshot.acts) {
  for (const voteId of act.finalVoteIds) {
    const linked = senatoActsByVoteId.get(voteId) ?? [];
    linked.push(act);
    senatoActsByVoteId.set(voteId, linked);
  }
}
const cameraMembershipsByDeputy = Map.groupBy(
  cameraPeopleSnapshot.groupMemberships,
  (membership) => membership.deputyId,
);
const senatoMembershipsBySenator = Map.groupBy(
  senatoPeopleSnapshot.groupMemberships,
  (membership) => membership.senatorId,
);
const senatoNamesByGroup = Map.groupBy(
  senatoPeopleSnapshot.groupNames,
  (name) => name.groupId,
);

const curatedCatalogSchema = z.object({
  schemaVersion: z.literal(1),
  allowedPositionHosts: z.array(z.string().regex(/^[a-z0-9.-]+\.[a-z]{2,}$/u)).min(1),
  comparisons: z.array(z.object({
    id: z.string().regex(/^[a-z0-9-]+$/u),
    chamber: z.enum(["camera", "senato"]),
    subject: z.object({ kind: z.enum(["person", "group"]), id: z.string().trim().min(1) }).strict(),
    position: z.object({
      date: z.iso.date(),
      summary: z.string().trim().min(1),
      sourceLabel: z.string().trim().min(1),
      sourceUrl: z.url(),
    }).strict(),
    actId: z.string().min(1),
    voteId: z.string().min(1),
    voteSourceUrl: z.url(),
  }).strict()).min(1),
}).strict();

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
  linkedActs?: ThemeLinkedAct[];
};

export type ThemeLinkedAct = {
  id: string;
  number: string;
  title: string;
  officialPage: string;
};

export type ThemeVoteSummary = RepublicVoteStateCounts & {
  totale: number;
};

export type ThemeOptionStats = VoteThemeDefinition & {
  chamberVotes: number;
  expressedVotes: number;
};

export type ThemeYearBucket = RepublicVoteStateCounts & {
  year: string;
  events: number;
  cameraEvents: number;
  senatoEvents: number;
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
  linkedActs?: ThemeLinkedAct[];
};

export type ThemeHistoryEvent = ThemeHistoryEventBase & {
  /** Voti individuali espressi nel perimetro filtrato (F/C/A). */
  voters: {
    favorevoli: ThemeEventVoter[];
    contrari: ThemeEventVoter[];
    astenuti: ThemeEventVoter[];
  };
  groupVotes: ThemeGroupVote[];
};

export type ThemeGroupVote = {
  groupId: string | null;
  groupLabel: string;
  favorevoli: number;
  contrari: number;
  astenuti: number;
};

export type ThemeHistoryMember = {
  personId: string;
  name: string;
  chamber: "camera" | "senato";
  groupLabel: string | null;
  summary: ThemeVoteSummary;
  expressedVotes: number;
  years: ThemeYearBucket[];
  otherVotes: Record<string, Exclude<RepublicActVote, "F" | "C" | "A" | "non-rilevato">>;
};

export type ThemeChamberFilter = "tutti" | "camera" | "senato";

export type ThemeHistoryCoverage = Record<"camera" | "senato", {
  periodLabel: string;
  observedDate: string;
  acquiredAt: string;
  included: number;
  excluded: number;
}>;

export type ThemeHistoryResult = {
  theme: VoteThemeDefinition | null;
  query: string | null;
  personQuery: string | null;
  chamber: ThemeChamberFilter;
  expressedOnly: boolean;
  coverage: ThemeHistoryCoverage;
  cameraSourceUrl: string;
  cameraSourceLabel: string;
  senatoSourceUrl: string;
  senatoSourceLabel: string;
  senatoGroupSourceUrl: string;
  senatoGroupSourceLabel: string;
  events: ThemeHistoryEvent[];
  comparisons: CuratedComparison[];
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

function titleMatches(
  title: string,
  needles: readonly string[],
  refineNeedles: readonly string[] = [],
): string[] {
  const haystack = normalizeNeedle(stripMarkup(title));
  if (!haystack) return [];
  const tokens = haystack.split(/\s+/u).filter(Boolean);
  const matchesNeedle = (needle: string): boolean => {
    const n = normalizeNeedle(needle);
    if (!n) return false;
    const parts = n.split(/\s+/u).filter(Boolean);
    if (parts.length > 1) {
      const pattern = parts.map(escapeRegExp).join("\\s+");
      return new RegExp(`(?:^|\\s)${pattern}(?:$|\\s)`, "u").test(haystack);
    }
    const stem = parts[0]!;
    return tokens.some((token) => token === stem || (stem.length >= 4 && token.startsWith(stem)));
  };
  if (refineNeedles.length > 0 && !refineNeedles.every(matchesNeedle)) return [];
  return needles.filter(matchesNeedle);
}

function emptySummary(): ThemeVoteSummary {
  return { totale: 0, ...emptyRepublicVoteStateCounts() };
}

function accumulate(summary: ThemeVoteSummary, ownVote: RepublicActVote): void {
  summary.totale += 1;
  addRepublicVoteState(summary, ownVote);
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
    ...emptyRepublicVoteStateCounts(),
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
  if (ownVote !== null) addRepublicVoteState(bucket, ownVote);
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

function cameraGroupAt(numericId: string, date: string): string | null {
  const matches = (cameraMembershipsByDeputy.get(`d${numericId}_19`) ?? [])
    .filter((membership) => membership.startDate <= date
      && (membership.endDate === null || date < membership.endDate));
  return matches.length === 1 ? matches[0]!.groupId : null;
}

function senatoGroupAt(numericId: string, date: string): string | null {
  const matches = new Set((senatoMembershipsBySenator.get(numericId) ?? [])
    .filter((membership) => membership.startDate <= date
      && (membership.endDate === null || date <= membership.endDate))
    .map((membership) => membership.groupId));
  return matches.size === 1 ? [...matches][0]! : null;
}

function senatoGroupLabel(groupId: string | null, date: string, compact = false): string {
  const labels = (senatoNamesByGroup.get(groupId ?? "") ?? [])
    .filter((name) => name.startDate <= date && (name.endDate === null || date <= name.endDate));
  if (labels.length !== 1) return "Gruppo non determinato";
  return (compact ? labels[0]!.shortLabel : labels[0]!.label) ?? labels[0]!.label;
}

function trustedHost(url: string, owners: readonly string[]): boolean {
  const parsed = new URL(url);
  const host = parsed.hostname.toLowerCase();
  return parsed.protocol === "https:"
    && owners.some((owner) => host === owner || host.endsWith(`.${owner}`));
}

export function parseCuratedComparisonCatalog(input: unknown) {
  const catalog = curatedCatalogSchema.parse(input);
  const ids = new Set<string>();
  const sources = new Set<string>();
  return catalog.comparisons.map((record) => {
    if (ids.has(record.id)) throw new Error(`Confronto curato duplicato: ${record.id}`);
    ids.add(record.id);
    const sourceKey = `${record.chamber}:${record.subject.kind}:${record.subject.id}:${record.voteId}:${record.position.sourceUrl}`;
    if (sources.has(sourceKey)) throw new Error(`Fonte duplicata nel confronto ${record.id}`);
    sources.add(sourceKey);
    if (!trustedHost(record.position.sourceUrl, catalog.allowedPositionHosts)
      || !trustedHost(record.voteSourceUrl, [record.chamber === "camera" ? "camera.it" : "senato.it"])) {
      throw new Error(`Fonte non ammessa nel confronto ${record.id}`);
    }

    const acts = record.chamber === "camera" ? cameraSnapshot.acts : senatoSnapshot.acts;
    const vote = (record.chamber === "camera" ? cameraVoteById : senatoVoteById).get(record.voteId);
    const act = acts.find((item) => item.id === record.actId);
    if (!vote || !act?.finalVoteIds.includes(record.voteId)) {
      throw new Error(`Atto o votazione non risolti nel confronto ${record.id}`);
    }

    let label: string;
    let voteState: "F" | "C" | "A" | null = null;
    if (record.subject.kind === "person") {
      if (record.chamber === "camera") {
        const person = cameraPeopleSnapshot.deputies.find((item) => `dep-${item.numericId}` === record.subject.id);
        if (!person) throw new Error(`Persona non risolta nel confronto ${record.id}`);
        label = person.displayName;
        const state = vote.votes[person.numericId];
        if (state === "F" || state === "C" || state === "A") voteState = state;
      } else {
        const person = senatoPeopleSnapshot.senators.find((item) => `sen-${item.id}` === record.subject.id);
        if (!person) throw new Error(`Persona non risolta nel confronto ${record.id}`);
        label = person.displayName;
        const state = vote.votes[person.id.slice(1)];
        if (state === "F" || state === "C" || state === "A") voteState = state;
      }
      if (!voteState) throw new Error(`Voto personale non espresso nel confronto ${record.id}`);
    } else {
      const group = record.chamber === "camera"
        ? cameraPeopleSnapshot.groups.find((item) => item.id === record.subject.id)
        : senatoPeopleSnapshot.groups.find((item) => item.id === record.subject.id);
      if (!group || !Object.entries(vote.votes).some(([numericId, state]) =>
        (state === "F" || state === "C" || state === "A")
        && (record.chamber === "camera" ? cameraGroupAt(numericId, vote.date) : senatoGroupAt(numericId, vote.date)) === record.subject.id)) {
        throw new Error(`Gruppo senza voti espressi nel confronto ${record.id}`);
      }
      label = record.chamber === "camera" ? group.label : senatoGroupLabel(group.id, vote.date);
    }
    return { ...record, subject: { ...record.subject, label }, voteState };
  });
}

export type CuratedComparison = ReturnType<typeof parseCuratedComparisonCatalog>[number];
const curatedComparisons = parseCuratedComparisonCatalog(curatedComparisonsJson);

/** Index matching final votes once; reuse vote maps for every parliamentarian. */
const fixedThemeVoteIndexes = new Map<string, readonly IndexedVote[]>();

function indexChamberVotes(
  chamber: "camera" | "senato",
  needles: readonly string[],
  refineNeedles: readonly string[] = [],
): readonly IndexedVote[] {
  if (needles.length === 0) return [];
  const fixedTheme = refineNeedles.length === 0
    ? VOTE_THEMES.find((theme) => theme.needles === needles)
    : null;
  const cacheKey = fixedTheme ? `${chamber}:${fixedTheme.id}` : null;
  const cached = cacheKey ? fixedThemeVoteIndexes.get(cacheKey) : undefined;
  if (cached) return cached;
  const indexed = new Map<string, IndexedVote>();
  const finish = () => {
    const result = [...indexed.values()];
    if (cacheKey) fixedThemeVoteIndexes.set(cacheKey, result);
    return result;
  };
  if (chamber === "camera") {
    for (const act of cameraSnapshot.acts) {
      if (!act.title || act.finalVoteIds.length === 0) continue;
      const matched = titleMatches(act.title, needles, refineNeedles);
      if (matched.length === 0) continue;
      for (const voteId of act.finalVoteIds) {
        const vote = cameraVoteById.get(voteId);
        if (!vote) continue;
        indexed.set(vote.id, {
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
    return finish();
  }
  for (const act of senatoSnapshot.acts) {
    if (!act.title || act.finalVoteIds.length === 0) continue;
    const matched = titleMatches(act.title, needles, refineNeedles);
    if (matched.length === 0) continue;
    for (const voteId of act.finalVoteIds) {
      const vote = senatoVoteById.get(voteId);
      if (!vote) continue;
      const previous = indexed.get(vote.id);
      if (previous) {
        previous.event.matchedNeedles = [...new Set([...previous.event.matchedNeedles, ...matched])];
        continue;
      }
      indexed.set(vote.id, {
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
          linkedActs: (senatoActsByVoteId.get(voteId) ?? []).map((linked) => ({
            id: linked.id,
            number: linked.number,
            title: stripMarkup(linked.title ?? `Disegno ${linked.number}`),
            officialPage: linked.officialPage,
          })),
        },
        votesByNumericId: vote.votes,
      });
    }
  }
  return finish();
}

function personRows(
  chamber: "camera" | "senato",
  numericId: string,
  needles: readonly string[],
  refineNeedles: readonly string[] = [],
): ThemeVoteRow[] {
  return indexChamberVotes(chamber, needles, refineNeedles).map((item) => ({
    ...item.event,
    ownVote: (item.votesByNumericId[numericId] ?? "non-rilevato") as RepublicActVote,
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
  needles: readonly string[];
  refineNeedles: string[];
} | null {
  const theme = themeId ? VOTE_THEMES.find((item) => item.id === themeId) ?? null : null;
  if (themeId && !theme) return null;
  const queryNeedles = queryRaw && normalizeNeedle(queryRaw).length >= 3
    ? [normalizeNeedle(queryRaw)]
    : [];
  // Theme needles are OR'd; a free-text `q` with a theme *refines* (AND), it does not widen.
  if (theme) {
    return { theme, needles: theme.needles, refineNeedles: queryNeedles };
  }
  return { theme: null, needles: queryNeedles, refineNeedles: [] };
}

function numericIdFor(personId: string, chamber: "camera" | "senato"): string | null {
  if (chamber === "camera" && personId.startsWith("dep-")) return personId.slice("dep-".length);
  if (chamber === "senato" && personId.startsWith("sen-s")) return personId.slice("sen-s".length);
  return null;
}

const CAVEATS = [
  "I temi raggruppano votazioni finali il cui titolo ufficiale contiene le parole chiave del tema: non sono una classificazione ufficiale di Camera o Senato.",
  "Gli snapshot della XIX legislatura includono votazioni finali su atti parlamentari e governativi verificati; al Senato restano fuori gli altri tipi di iniziativa e gli atti senza una fase Senato ammissibile.",
  "Una ricerca senza votazioni finali collegate non prova assenza di attività sul tema: molte proposte non arrivano al voto d’aula nello snapshot.",
  "Il voto individuale segue i codici ufficiali della fonte: mancata partecipazione, presenza senza voto, missione o congedo e dato non rilevato restano stati distinti.",
  "Se una persona non compare nelle liste nominali della votazione, il dato resta «non rilevato»: non viene trasformato in assenza o mancata partecipazione.",
  "Gli snapshot non includono uno storico completo dei mandati: «fuori mandato» resta non disponibile, distinto dallo zero e dal dato non rilevato.",
  "La distribuzione per gruppo usa le appartenenze ufficiali alla data del voto: Camera e Senato conservano le rispettive semantiche temporali. Le denominazioni Camera vengono dal roster corrente e possono riflettere nomi successivi; quelle Senato sono storiche.",
  "La distribuzione conta tutti i voti nominali, anche di ex parlamentari; l'elenco delle persone mostra soltanto il roster corrente nel perimetro dei filtri. Il gruppo nell'elenco è corrente, quello accanto a un voto è storico.",
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
  const { theme, needles, refineNeedles } = resolved;
  const numericId = numericIdFor(person.id, chamber);
  if (!numericId) return null;

  const votes = needles.length === 0
    ? []
    : sortVotes(personRows(chamber, numericId, needles, refineNeedles));

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
  // Default: only expressed voters, unless searching a name (include every state) or explicitly disabled.
  const expressedOnly = options.expressedOnly === false
    ? false
    : options.expressedOnly === true
      ? true
      : personTokens.length === 0;

  const resolved = resolveNeedles(themeId, queryRaw);
  if (!resolved) return null;
  const { theme, needles, refineNeedles } = resolved;

  const cameraIndexed = chamber === "senato" ? [] : indexChamberVotes("camera", needles, refineNeedles);
  const senatoIndexed = chamber === "camera" ? [] : indexChamberVotes("senato", needles, refineNeedles);
  const indexedByKey = new Map<string, IndexedVote>();
  for (const item of [...cameraIndexed, ...senatoIndexed]) {
    indexedByKey.set(`${item.event.chamber}:${item.event.voteId}`, item);
  }

  const graph = getRepubblicaGraph();
  const groups = new Map(graph.groups.map((group) => [group.id, group]));
  const members: ThemeHistoryMember[] = [];
  const votersByEvent = new Map<string, ThemeHistoryEvent["voters"]>();

  function historicalCameraGroupLabel(groupId: string | null, compact = false): string {
    if (groupId === null) return "Gruppo non determinato";
    const group = groups.get(`camera-${groupId}`);
    return (compact ? group?.shortLabel : group?.label) ?? "Gruppo non determinato";
  }

  function groupAt(chamber: "camera" | "senato", numericId: string, date: string): string | null {
    return chamber === "camera" ? cameraGroupAt(numericId, date) : senatoGroupAt(numericId, date);
  }

  function groupLabelAt(chamber: "camera" | "senato", groupId: string | null, date: string, compact = false): string {
    return chamber === "camera"
      ? historicalCameraGroupLabel(groupId, compact)
      : senatoGroupLabel(groupId, date, compact);
  }

  function groupVotes(item: IndexedVote): ThemeGroupVote[] {
    const buckets = new Map<string, ThemeGroupVote>();
    for (const [numericId, vote] of Object.entries(item.votesByNumericId)) {
      if (vote !== "F" && vote !== "C" && vote !== "A") continue;
      const groupId = groupAt(item.event.chamber, numericId, item.event.date);
      const key = groupId ?? "unknown";
      const bucket = buckets.get(key) ?? {
        groupId,
        groupLabel: groupLabelAt(item.event.chamber, groupId, item.event.date),
        favorevoli: 0,
        contrari: 0,
        astenuti: 0,
      };
      bucket[REPUBLIC_VOTE_STATE_META[vote].countKey] += 1;
      buckets.set(key, bucket);
    }
    return [...buckets.values()].sort((left, right) => (
      (right.favorevoli + right.contrari + right.astenuti)
      - (left.favorevoli + left.contrari + left.astenuti)
      || left.groupLabel.localeCompare(right.groupLabel, "it")
    ));
  }

  function emptyVoters(): ThemeHistoryEvent["voters"] {
    return {
      favorevoli: [],
      contrari: [],
      astenuti: [],
    };
  }

  function ensureVoters(key: string): ThemeHistoryEvent["voters"] {
    const existing = votersByEvent.get(key);
    if (existing) return existing;
    const created = emptyVoters();
    votersByEvent.set(key, created);
    return created;
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
    const otherVotes: ThemeHistoryMember["otherVotes"] = {};
    const yearRows: Array<{ date: string; ownVote: RepublicActVote; chamber: "camera" | "senato" }> = [];
    const group = person.groupId ? groups.get(person.groupId) : null;
    const groupLabel = group?.shortLabel ?? group?.label ?? null;

    for (const item of indexed) {
      const ownVote = (item.votesByNumericId[numericId] ?? "non-rilevato") as RepublicActVote;
      accumulate(summary, ownVote);
      if (ownVote !== "F" && ownVote !== "C" && ownVote !== "A" && ownVote !== "non-rilevato") {
        otherVotes[item.event.voteId] = ownVote;
      }
      yearRows.push({ date: item.event.date, ownVote, chamber: person.chamberId });
      if (ownVote === "F" || ownVote === "C" || ownVote === "A") {
        const eventGroupLabel = groupLabelAt(
          person.chamberId,
          groupAt(person.chamberId, numericId, item.event.date),
          item.event.date,
          true,
        );
        const voters = ensureVoters(`${item.event.chamber}:${item.event.voteId}`);
        voters[REPUBLIC_VOTE_STATE_META[ownVote].countKey].push({
          personId: person.id,
          name: person.displayName,
          groupLabel: eventGroupLabel,
          ownVote,
        });
      }
    }
    const expressed = expressedCount(summary);
    if (expressedOnly && expressed === 0) continue;

    members.push({
      personId: person.id,
      name: person.displayName,
      chamber: person.chamberId,
      groupLabel,
      summary,
      expressedVotes: expressed,
      years: yearsFromRows(yearRows),
      otherVotes,
    });
  }

  members.sort((left, right) =>
    right.expressedVotes - left.expressedVotes
    || left.name.localeCompare(right.name, "it", { sensitivity: "base" })
    || left.personId.localeCompare(right.personId));

  for (const bucket of votersByEvent.values()) {
    for (const list of Object.values(bucket)) {
      list.sort((left, right) => left.name.localeCompare(right.name, "it", { sensitivity: "base" })
        || left.personId.localeCompare(right.personId));
    }
  }

  const events = [...indexedByKey.values()]
    .map((item) => ({
      ...item.event,
      groupVotes: groupVotes(item),
      voters: votersByEvent.get(`${item.event.chamber}:${item.event.voteId}`)
        ?? emptyVoters(),
    }))
    .sort((left, right) => {
      const byDate = right.date.localeCompare(left.date);
      if (byDate !== 0) return byDate;
      return left.actNumber.localeCompare(right.actNumber, "it");
    });

  return {
    theme,
    query: queryRaw,
    personQuery: personQueryRaw,
    chamber,
    expressedOnly,
    coverage: {
      camera: {
        periodLabel: cameraSnapshot.period.label,
        observedDate: cameraSnapshot.period.observedDate,
        acquiredAt: cameraSnapshot.provenance.acquiredAt,
        included: cameraSnapshot.coverage.finalVotes,
        excluded: cameraSnapshot.coverage.finalVotesExcluded,
      },
      senato: {
        periodLabel: senatoSnapshot.period.label,
        observedDate: senatoSnapshot.period.observedDate,
        acquiredAt: senatoSnapshot.provenance.acquiredAt,
        included: senatoSnapshot.coverage.finalVotes,
        excluded: senatoSnapshot.coverage.finalVotesOnOtherActs,
      },
    },
    cameraSourceUrl: cameraSnapshot.provenance.landingUrl,
    cameraSourceLabel: cameraSnapshot.provenance.title,
    senatoSourceUrl: senatoSnapshot.provenance.landingUrl,
    senatoSourceLabel: senatoSnapshot.provenance.title,
    senatoGroupSourceUrl: senatoPeopleSnapshot.source.groupHistory.endpointUrl,
    senatoGroupSourceLabel: `Senato · storico gruppi parlamentari (acquisito il ${senatoPeopleSnapshot.source.groupHistory.observedDate})`,
    events,
    comparisons: curatedComparisons.filter((comparison) => events.some((event) =>
      event.chamber === comparison.chamber && event.voteId === comparison.voteId)),
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

export const __testOnly_cameraGroupAt = cameraGroupAt;
export const __testOnly_senatoGroupAt = senatoGroupAt;
