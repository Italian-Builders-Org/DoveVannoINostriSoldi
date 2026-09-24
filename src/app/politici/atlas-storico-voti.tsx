"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { VOTE_THEMES } from "@/lib/politici-voti-tema-catalog";
import { compareGroupVoteEvents, type GroupChoice } from "@/lib/politici-group-patterns";
import type { RepublicMap } from "@/lib/politici-repubblica";
import type {
  CuratedComparison,
  ThemeEventVoter,
  ThemeGroupVote,
  ThemeHistoryResult,
  ThemeYearBucket,
} from "@/lib/politici-voti-tema";
import {
  compactRepublicVoteStateCounts,
  countRepublicVoteStates,
  isRepublicActVote,
  isRepublicVoteStateCounts,
  OWN_VOTE_LABELS,
  REPUBLIC_VOTE_STATE_META,
  republicVoteTone,
} from "@/lib/politici-vote-states";
import { count, object, requestDeadline, text, type Resource } from "./atlas-data";
import { parseActHeadline } from "./atlas-act-headline";
import { OfficialActLinks, validLinkedActs } from "./atlas-official-acts";
import {
  DEFAULT_THEME_ID,
  countLabel,
  longDate,
  normalizeSearch,
  THEME_CHAMBERS,
  type ThemeChamberFilter,
} from "./atlas-model";
import { Icon, Portrait, SourceLink, Status } from "./atlas-primitives";
import styles from "./politici.module.css";
import extra from "./atlas-enhancements.module.css";

type YearBucket = ThemeYearBucket;
type EventVoter = ThemeEventVoter;
type GroupVote = ThemeGroupVote;
type ThemeHistoryData = ThemeHistoryResult;

const expressedVoteKeys = (["F", "C", "A"] as const)
  .map((code) => REPUBLIC_VOTE_STATE_META[code].countKey);

function validVoters(value: unknown): boolean {
  return object(value) && expressedVoteKeys.every((key) => Array.isArray(value[key])
    && value[key].every((voter) => object(voter)
      && text(voter.personId) && text(voter.name)
      && (voter.groupLabel === null || text(voter.groupLabel))
      && isRepublicActVote(voter.ownVote)
      && REPUBLIC_VOTE_STATE_META[voter.ownVote].countKey === key));
}

function validGroupVotes(value: unknown): boolean {
  return Array.isArray(value) && value.every((group) => object(group)
    && (group.groupId === null || text(group.groupId))
    && text(group.groupLabel)
    && count(group.favorevoli)
    && count(group.contrari)
    && count(group.astenuti));
}

function validComparison(value: unknown): boolean {
  return object(value) && object(value.subject) && object(value.position)
    && text(value.id)
    && (value.chamber === "camera" || value.chamber === "senato")
    && (value.subject.kind === "person" || value.subject.kind === "group")
    && text(value.subject.id) && text(value.subject.label)
    && text(value.position.date) && text(value.position.summary)
    && text(value.position.sourceLabel) && text(value.position.sourceUrl)
    && text(value.actId) && text(value.voteId) && text(value.voteSourceUrl)
    && (value.voteState === null || value.voteState === "F" || value.voteState === "C" || value.voteState === "A");
}

function parseHistory(payload: unknown): ThemeHistoryData {
  if (!object(payload) || payload.ok !== true) throw new Error("invalid");
  const coverage = payload.coverage;
  if (!["cameraSourceUrl", "cameraSourceLabel", "senatoSourceUrl", "senatoSourceLabel", "senatoGroupSourceUrl", "senatoGroupSourceLabel"].every((key) => text(payload[key]))
    || !object(coverage)
    || !(["camera", "senato"] as const).every((chamber) => {
      const item = coverage[chamber];
      return object(item) && ["periodLabel", "observedDate", "acquiredAt"].every((key) => text(item[key]))
        && count(item.included) && count(item.excluded);
    })
    || (payload.chamber !== "tutti" && payload.chamber !== "camera" && payload.chamber !== "senato")
    || typeof payload.expressedOnly !== "boolean"
    || !Array.isArray(payload.events)
    || !Array.isArray(payload.comparisons)
    || !payload.comparisons.every(validComparison)
    || !Array.isArray(payload.years)
    || !Array.isArray(payload.members)
    || !Array.isArray(payload.themes)
    || !Array.isArray(payload.caveats)
    || !payload.caveats.every(text)
    || !payload.events.every((event) => object(event) && validVoters(event.voters)
      && (event.chamber === "camera" || event.chamber === "senato")
      && validLinkedActs(event.linkedActs)
      && validGroupVotes(event.groupVotes))
    || !payload.years.every((year) => object(year) && isRepublicVoteStateCounts(year))
    || !payload.members.every((member) => object(member) && object(member.summary)
      && count(member.summary.totale) && isRepublicVoteStateCounts(member.summary)
      && countRepublicVoteStates(member.summary) === member.summary.totale
      && Array.isArray(member.years) && member.years.every(isRepublicVoteStateCounts)
      && object(member.otherVotes) && Object.values(member.otherVotes).every((vote) => (
        isRepublicActVote(vote) && vote !== "F" && vote !== "C" && vote !== "A" && vote !== "non-rilevato"
      )))) {
    throw new Error("invalid");
  }
  return payload as ThemeHistoryData;
}

function CuratedEvidence({
  comparison,
  event,
}: {
  comparison: CuratedComparison;
  event: ThemeHistoryData["events"][number];
}) {
  const group = comparison.subject.kind === "group"
    ? event.groupVotes.find((item) => item.groupId === comparison.subject.id)
    : null;
  return <aside className={extra.curatedEvidence} aria-label="Posizione e voto documentati">
    <p className={extra.curatedEvidenceEyebrow}>
      Confronto documentato · posizione {comparison.subject.kind === "person" ? "personale" : "del gruppo"}
    </p>
    <p><strong>{comparison.subject.label}</strong> · <time dateTime={comparison.position.date}>{longDate(comparison.position.date)}</time></p>
    <p>{comparison.position.summary}</p>
    <p>
      {comparison.subject.kind === "person" && comparison.voteState
        ? <>Voto finale sull’intero atto: <strong>{OWN_VOTE_LABELS[comparison.voteState]}</strong>.</>
        : group
          ? <>Voti espressi dal gruppo sull’intero atto: {group.favorevoli} favorevoli, {group.contrari} contrari, {group.astenuti} astenuti.</>
          : null}
    </p>
    <div className={extra.curatedEvidenceSources}>
      <SourceLink href={comparison.position.sourceUrl}>Fonte della posizione · {comparison.position.sourceLabel}</SourceLink>
      <SourceLink href={comparison.voteSourceUrl}>Scheda ufficiale del voto</SourceLink>
    </div>
    <small>La posizione riguarda l’atto nel suo insieme; questo confronto non giudica la coerenza né attribuisce un voto alle singole misure.</small>
  </aside>;
}

async function loadHistory(
  themeId: string,
  titleQuery: string,
  personQuery: string,
  chamber: ThemeChamberFilter,
  expressedOnly: boolean,
  signal: AbortSignal,
): Promise<ThemeHistoryData> {
  const params = new URLSearchParams();
  if (themeId) params.set("tema", themeId);
  if (titleQuery.trim().length >= 3) params.set("q", titleQuery.trim());
  if (personQuery.trim()) params.set("persona", personQuery.trim());
  if (chamber === "camera" || chamber === "senato") params.set("ramo", chamber);
  params.set("espressi", expressedOnly ? "1" : "0");
  const deadline = requestDeadline(signal, 20_000);
  try {
    deadline.signal.throwIfAborted();
    const response = await fetch(`/api/politici/voti-tema?${params}`, {
      signal: deadline.signal,
      headers: { Accept: "application/json" },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return parseHistory(await response.json());
  } finally {
    deadline.dispose();
  }
}

function actNumberLabel(chamber: "camera" | "senato", actNumber: string): string {
  if (chamber === "senato" || actNumber.startsWith("S.")) return actNumber;
  return `A.C. ${actNumber}`;
}

function ActHeadline({
  title,
  chamber,
  actNumber,
  approved,
}: {
  title: string;
  chamber: "camera" | "senato";
  actNumber: string;
  approved: boolean;
}) {
  const parsed = parseActHeadline(title);
  return <div className={extra.actHeadline}>
    {parsed.lead ? <p className={extra.actLead}>{parsed.lead}</p> : null}
    <h4 className={extra.actHeadlineTitle}>{parsed.title}</h4>
    <p className={extra.actHeadlineMeta}>
      <span>{actNumberLabel(chamber, actNumber)}</span>
      <span aria-hidden="true">·</span>
      <span data-outcome={approved ? "yes" : "no"}>
        {approved ? "Approvata in aula" : "Non approvata in aula"}
      </span>
    </p>
  </div>;
}

function expressedVoteOnEvent(
  event: ThemeHistoryData["events"][number],
  personId: string,
): "F" | "C" | "A" | null {
  if (event.voters.favorevoli.some((voter) => voter.personId === personId)) return "F";
  if (event.voters.contrari.some((voter) => voter.personId === personId)) return "C";
  if (event.voters.astenuti.some((voter) => voter.personId === personId)) return "A";
  return null;
}

function memberVoteTrail(
  member: ThemeHistoryData["members"][number],
  events: ThemeHistoryData["events"],
) {
  return events
    .filter((event) => event.chamber === member.chamber)
    .map((event) => {
      return {
        voteId: event.voteId,
        date: event.date,
        actNumber: event.actNumber,
        actTitle: event.actTitle,
        officialPage: event.officialPage,
        linkedActs: event.linkedActs,
        approved: event.approved,
        ownVote: expressedVoteOnEvent(event, member.personId)
          ?? member.otherVotes[event.voteId]
          ?? "non-rilevato",
      };
    });
}

function YearBars({ years, mode }: { years: YearBucket[]; mode: "events" | "votes"; }) {
  if (!years.length) return null;
  const max = Math.max(1, ...years.map((year) => (
    mode === "events"
      ? year.events
      : countRepublicVoteStates(year)
  )));
  return <ol className={extra.yearBars} aria-label="Andamento per anno">
    {years.map((year) => {
      const value = mode === "events"
        ? year.events
        : countRepublicVoteStates(year);
      const width = Math.max(4, Math.round((value / max) * 100));
      return <li key={year.year}>
        <span className={extra.yearLabel}>{year.year}</span>
        <span className={extra.yearTrack} aria-hidden="true">
          <span className={extra.yearFill} style={{ width: `${width}%` }} />
        </span>
        <span className={extra.yearMeta}>
          {mode === "events"
            ? `${countLabel(year.events, "votazione", "votazioni")} · Camera ${year.cameraEvents} · Senato ${year.senatoEvents}`
            : compactRepublicVoteStateCounts(year)}
        </span>
      </li>;
    })}
  </ol>;
}

function VoterGroup({
  label,
  tone,
  people,
  onSelectPerson,
}: {
  label: string;
  tone: "for" | "against" | "abstain";
  people: EventVoter[];
  onSelectPerson: (personId: string) => void;
}) {
  const [open, setOpen] = useState(people.length <= 12);
  if (!people.length) return null;
  return <details className={extra.voterGroup} open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary>
      <span className={extra.themeVotePill} data-tone={tone}>{label}</span>
      <span className={styles.tag}>{people.length}</span>
    </summary>
    {open ? <ul className={extra.voterList}>
      {people.map((voter) => (
        <li key={voter.personId}>
          <button type="button" onClick={() => onSelectPerson(voter.personId)}>
            <strong>{voter.name}</strong>
            {voter.groupLabel ? <span>{voter.groupLabel}</span> : null}
          </button>
        </li>
      ))}
    </ul> : null}
  </details>;
}

function GroupVotes({ groups, chamber }: { groups: GroupVote[]; chamber: "camera" | "senato" }) {
  if (!groups.length) return null;
  return <details className={extra.voterGroup}>
    <summary>
      <span className={extra.themeVotePill} data-tone="neutral">Voti espressi per gruppo · {chamber === "camera" ? "Camera intera" : "Senato intero"}</span>
      <span className={styles.tag}>{groups.length}</span>
    </summary>
    <dl className={extra.groupVoteList}>
      {groups.map((group) => <div key={group.groupId ?? "unknown"}>
        <dt>{group.groupLabel}</dt>
        <dd>Favorevoli {group.favorevoli} · Contrari {group.contrari} · Astenuti {group.astenuti}</dd>
      </div>)}
    </dl>
  </details>;
}

function groupChoiceLabel(choice: GroupChoice): string {
  if (choice === "pareggio") return "Parità interna";
  if (choice === "non-determinato") return "Non determinabile";
  return OWN_VOTE_LABELS[choice];
}

function GroupPatternComparison({ data, initialGroupId }: { data: ThemeHistoryData; initialGroupId: string | null }) {
  const [selectedA, setSelectedA] = useState<string | null>(null);
  const [selectedB, setSelectedB] = useState("");
  const [selectedYear, setSelectedYear] = useState("");
  const chamber = data.chamber;
  const chamberEvents = data.events.filter((event) => event.chamber === chamber);
  const groupsById = new Map<string, { id: string; label: string; date: string }>();
  for (const event of chamberEvents) {
    for (const group of event.groupVotes) {
      if (!group.groupId) continue;
      const previous = groupsById.get(group.groupId);
      if (!previous || event.date > previous.date) {
        groupsById.set(group.groupId, { id: group.groupId, label: group.groupLabel, date: event.date });
      }
    }
  }
  const groups = [...groupsById.values()].sort((a, b) => a.label.localeCompare(b.label, "it"));
  const years = [...new Set(chamberEvents.map((event) => event.date.slice(0, 4)))].sort();
  const initialSourceId = initialGroupId?.startsWith(`${chamber}-`)
    ? initialGroupId.slice(chamber.length + 1) : "";
  const preferredA = selectedA ?? initialSourceId;
  const groupAId = groupsById.has(preferredA) ? preferredA : "";
  const groupBId = groupsById.has(selectedB) ? selectedB : "";
  const year = years.includes(selectedYear) ? selectedYear : "";
  const comparison = (chamber === "camera" || chamber === "senato") && groupAId && groupBId
    ? compareGroupVoteEvents(data.events, chamber, groupAId, groupBId, year || null)
    : null;
  const eventsById = new Map(chamberEvents.map((event) => [event.voteId, event]));

  return <section className={extra.yearSection} aria-label="Pattern di voto comune tra gruppi">
    <div className={styles.sectionHeading}>
      <h3>Pattern di voto comune tra gruppi</h3>
    </div>
    {chamber === "tutti" ? <p className={styles.note}>Seleziona «Solo Camera» o «Solo Senato» per confrontare gruppi dello stesso ramo.</p> : <>
      <div className={extra.groupPatternFilters}>
        <label>Primo gruppo
          <select value={groupAId} onChange={(event) => setSelectedA(event.target.value)}>
            <option value="">Seleziona un gruppo</option>
            {groups.map((group) => <option key={group.id} value={group.id}>{group.label}</option>)}
          </select>
        </label>
        <label>Secondo gruppo
          <select value={groupBId} onChange={(event) => setSelectedB(event.target.value)}>
            <option value="">Seleziona un gruppo</option>
            {groups.map((group) => <option key={group.id} value={group.id}>{group.label}</option>)}
          </select>
        </label>
        <label>Periodo
          <select value={year} onChange={(event) => setSelectedYear(event.target.value)}>
            <option value="">Tutti gli anni disponibili</option>
            {years.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
        </label>
      </div>
      {groupAId && groupAId === groupBId ? <p className={styles.note}>Scegli due gruppi diversi.</p> : null}
      {comparison ? <>
        <p className={styles.note} role="status">
          {groupsById.get(groupAId)?.label} e {groupsById.get(groupBId)?.label} · {chamber === "camera" ? "Camera" : "Senato"} · {data.theme?.label ?? "ricerca libera"}
          {data.query ? ` · titolo «${data.query}»` : ""} · {year || "tutti gli anni disponibili"}.
          {comparison.periodStart && comparison.periodEnd ? ` Voti dal ${longDate(comparison.periodStart)} al ${longDate(comparison.periodEnd)}.` : " Nessuna votazione nel periodo."}
        </p>
        <dl className={extra.voteCounts}>
          <div><dt>Scelta comune</dt><dd>{comparison.commonChoiceEvents}/{comparison.comparableEvents}</dd></div>
          <div><dt>Eventi confrontabili</dt><dd>{comparison.comparableEvents}/{comparison.events.length}</dd></div>
          <div><dt>Non confrontabili</dt><dd>{comparison.events.length - comparison.comparableEvents}</dd></div>
        </dl>
        {comparison.comparableEvents === 0 ? <p className={styles.note}>Nessuna scelta comune valutabile nel periodo selezionato.</p> : null}
        <details className={extra.voterGroup}>
          <summary><span className={extra.themeVotePill} data-tone="neutral">Vedi gli atti e le scelte</span><span className={styles.tag}>{comparison.events.length}</span></summary>
          <ol className={extra.groupPatternList}>
            {comparison.events.map((row) => {
              const event = eventsById.get(row.voteId)!;
              return <li key={row.voteId}>
                <a href={`#voto-${event.chamber}-${row.voteId}`}>{actNumberLabel(event.chamber, event.actNumber)} · {longDate(event.date)} · {parseActHeadline(event.actTitle).title}</a>
                <span>Primo gruppo: {groupChoiceLabel(row.choiceA)} · secondo gruppo: {groupChoiceLabel(row.choiceB)} · {row.agreement === null ? "non confrontabile" : row.agreement ? "scelta comune" : "scelta diversa"}</span>
              </li>;
            })}
          </ol>
        </details>
      </> : null}
      <p className={styles.note}>Il confronto usa gruppi parlamentari, non necessariamente partiti, e solo favorevoli, contrari e astenuti prevalenti. Parità interne e scelte non determinabili non entrano nel denominatore. La ricerca per persona e il filtro «solo chi ha espresso» non modificano il confronto tra gruppi; una scelta comune non dimostra un’alleanza politica.</p>
    </>}
  </section>;
}

export function ThemeVoteHistoryDirectory({
  map,
  query,
  themeId,
  themeChamber,
  themeExpressedOnly,
  selectedId,
  selectedGroupId,
  onThemeId,
  onThemeChamber,
  onThemeExpressedOnly,
  onSelectPerson,
}: {
  map: RepublicMap;
  query: string;
  themeId: string | null;
  themeChamber: ThemeChamberFilter;
  themeExpressedOnly: boolean;
  selectedId: string | null;
  selectedGroupId: string | null;
  onThemeId: (themeId: string) => void;
  onThemeChamber: (chamber: ThemeChamberFilter) => void;
  onThemeExpressedOnly: (value: boolean) => void;
  onSelectPerson: (personId: string) => void;
}) {
  const id = useId();
  const activeThemeId = themeId ?? DEFAULT_THEME_ID;
  const [draftTitle, setDraftTitle] = useState("");
  const [titleQuery, setTitleQuery] = useState("");
  const [resource, setResource] = useState<Resource<ThemeHistoryData>>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [openMemberId, setOpenMemberId] = useState<string | null>(null);
  const peopleById = useMemo(() => new Map(map.people.map((person) => [person.id, person])), [map.people]);

  useEffect(() => {
    const controller = new AbortController();
    loadHistory(activeThemeId, titleQuery, query, themeChamber, themeExpressedOnly, controller.signal)
      .then((data) => { if (!controller.signal.aborted) setResource({ status: "ready", data }); })
      .catch(() => { if (!controller.signal.aborted) setResource({ status: "error" }); });
    return () => controller.abort();
  }, [activeThemeId, titleQuery, query, themeChamber, themeExpressedOnly, attempt]);

  const data = resource.status === "ready"
    && (resource.data.theme?.id ?? null) === (activeThemeId || null)
    && (resource.data.query ?? "") === (titleQuery.trim().length >= 3 ? titleQuery.trim() : "")
    && (resource.data.personQuery ?? "") === (query.trim() || "")
    && resource.data.chamber === themeChamber
    && resource.data.expressedOnly === themeExpressedOnly
    ? resource.data
    : null;
  const localTokens = useMemo(() => normalizeSearch(query).split(" ").filter(Boolean), [query]);
  const members = useMemo(() => {
    if (!data) return [];
    if (!localTokens.length || data.personQuery) return data.members;
    return data.members.filter((member) => {
      const haystack = normalizeSearch(`${member.name} ${member.groupLabel ?? ""}`);
      return localTokens.every((token) => haystack.includes(token));
    });
  }, [data, localTokens]);

  useEffect(() => {
    if (!data || !window.location.hash.startsWith("#voto-")) return;
    const target = window.location.hash.slice(1);
    const frame = window.requestAnimationFrame(() => {
      const event = document.getElementById(target);
      const pane = event?.closest(`.${styles.workspaceScroll}`);
      if (!event || !(pane instanceof HTMLElement)) return;
      if (getComputedStyle(pane).overflowY === "auto") {
        pane.scrollTop += event.getBoundingClientRect().top - pane.getBoundingClientRect().top - 12;
        window.scrollTo(0, 0);
      } else {
        const sticky = document.querySelector(`.${styles.topBar}`)?.getBoundingClientRect().height ?? 0;
        window.scrollBy(0, event.getBoundingClientRect().top - sticky - 12);
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [data]);

  // Drop stale expansion when the open person leaves the filtered list.
  const openMemberIdSafe = openMemberId && members.some((member) => member.personId === openMemberId)
    ? openMemberId
    : null;

  return <section className={styles.convictionsView} aria-label="Storico voti per tema" data-storico-theme={activeThemeId}>
    <div className={styles.chamberHeading}>
      <div>
        <p className={styles.eyebrow}>XIX legislatura · votazioni finali</p>
        <h2>Storico voti per tema</h2>
      </div>
      <span className={styles.tag}>{members.length}</span>
    </div>
    <p className={styles.sectionLead}>
      Per ogni tema vedi cosa si è votato in aula e chi ha espresso favorevole, contrario o astenuto.
      Filtra per ramo, raffina sul titolo e usa la ricerca in alto per il nome.
    </p>

    <div className={extra.themeChips} role="group" aria-label="Temi">
      {VOTE_THEMES.map((theme) => {
        const chamberVotes = data?.themes.find((item) => item.id === theme.id)?.chamberVotes;
        return (
          <button
            key={theme.id}
            type="button"
            aria-pressed={activeThemeId === theme.id}
            title={theme.description}
            onClick={() => onThemeId(theme.id)}
          >
            <span>{theme.label}</span>
            {chamberVotes !== undefined ? <small>{chamberVotes}</small> : null}
          </button>
        );
      })}
    </div>

    <div className={extra.storicoFilters}>
      <div className={extra.themeChips} role="group" aria-label="Ramo parlamentare">
        {THEME_CHAMBERS.map((item) => (
          <button
            key={item.id}
            type="button"
            aria-pressed={themeChamber === item.id}
            onClick={() => onThemeChamber(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>
      <label className={extra.expressedToggle}>
        <input
          type="checkbox"
          checked={themeExpressedOnly}
          onChange={(event) => onThemeExpressedOnly(event.target.checked)}
        />
        Solo chi ha espresso un voto (F/C/A)
      </label>
    </div>

    <form
      className={extra.themeSearch}
      onSubmit={(event) => {
        event.preventDefault();
        setTitleQuery(draftTitle.trim());
      }}
    >
      <label htmlFor={`${id}-title-query`}>Raffina sul titolo dell’atto</label>
      <div>
        <input
          id={`${id}-title-query`}
          type="search"
          maxLength={120}
          value={draftTitle}
          placeholder="es. equo compenso, interporti, riciclo"
          onChange={(event) => setDraftTitle(event.target.value)}
        />
        <button type="submit">Cerca</button>
      </div>
    </form>

    {resource.status === "error" ? (
      <Status kind="error" title="Storico voti temporaneamente non disponibile" onRetry={() => {
        setResource({ status: "loading" });
        setAttempt((value) => value + 1);
      }}>Riprova tra poco. Le altre viste restano consultabili.</Status>
    ) : resource.status !== "ready" || !data ? (
      <Status kind="loading" title="Caricamento dello storico per tema…" />
    ) : (
      <>
        <p className={styles.note} role="status">
          {data.theme ? <>Tema <strong>{data.theme.label}</strong>. </> : null}
          {data.query ? <>Titolo «{data.query}». </> : null}
          {query.trim() ? <>Persona «{query.trim()}». </> : null}
          {themeChamber === "camera" ? "Solo Camera. " : themeChamber === "senato" ? "Solo Senato. " : null}
          {" "}{countLabel(data.events.length, "votazione", "votazioni")} in aula · {countLabel(members.length, "parlamentare", "parlamentari")}
          {themeExpressedOnly ? " con voto espresso" : " con tutti gli stati disponibili"}.
        </p>
        <section className={styles.note} aria-label="Copertura delle fonti per ramo">
          <p>Camera · {data.coverage.camera.periodLabel}. Osservata il {longDate(data.coverage.camera.observedDate)}, acquisita il {longDate(data.coverage.camera.acquiredAt)}. {data.coverage.camera.included} votazioni finali incluse; {data.coverage.camera.excluded} non incluse dopo la verifica dei collegamenti e dei conteggi.</p>
          <p>Senato · {data.coverage.senato.periodLabel}. Osservato il {longDate(data.coverage.senato.observedDate)}, acquisito il {longDate(data.coverage.senato.acquiredAt)}. {data.coverage.senato.included} votazioni finali incluse sugli atti a prima firma senatore e sulle iniziative governative con fase Senato; {data.coverage.senato.excluded} votazioni osservate su altri atti sono escluse.</p>
        </section>

        {data.years.length > 0 ? (
          <section className={extra.yearSection} aria-label="Storico per anno">
            <div className={styles.sectionHeading}>
              <h3>Nel corso degli anni</h3>
              <span className={styles.tag}>{data.years.length}</span>
            </div>
            <YearBars years={data.years} mode="events" />
          </section>
        ) : null}

        <GroupPatternComparison key={selectedGroupId ?? "overview"} data={data} initialGroupId={selectedGroupId} />

        <section className={extra.storicoEvents} aria-label="Cosa si è votato">
          <div className={styles.sectionHeading}>
            <h3>Cosa si è votato</h3>
            <span className={styles.tag}>{data.events.length}</span>
          </div>
          <p className={styles.note}>I confronti documentati sono una selezione: se un atto non ne ha, non implica nulla sulla coerenza delle posizioni.</p>
          {!data.events.length ? (
            <Status title="Nessuna votazione per questi filtri">
              Prova un altro tema o togli il raffinamento sul titolo.
            </Status>
          ) : (
            <ol className={extra.themeTimeline}>
              {data.events.map((event) => {
                const expressedVoters = event.voters.favorevoli.length
                  + event.voters.contrari.length
                  + event.voters.astenuti.length;
                return <li key={`${event.chamber}-${event.voteId}`} id={`voto-${event.chamber}-${event.voteId}`} data-approved={event.approved ? "true" : "false"}>
                  <div className={extra.themeTimelineRail}>
                    <time dateTime={event.date}>{longDate(event.date)}</time>
                    <span className={styles.tag}>{event.chamber === "senato" ? "Senato" : "Camera"}</span>
                    <span className={extra.themeTimelineMark} aria-hidden="true" />
                  </div>
                  <div className={extra.themeTimelineBody}>
                    <ActHeadline
                      title={event.actTitle}
                      chamber={event.chamber}
                      actNumber={event.actNumber}
                      approved={event.approved}
                    />
                    <dl className={extra.voteCounts}>
                      <div><dt>Favorevoli</dt><dd>{event.favorevoli}</dd></div>
                      <div><dt>Contrari</dt><dd>{event.contrari}</dd></div>
                      <div><dt>Astenuti</dt><dd>{event.astenuti}</dd></div>
                    </dl>
                    <GroupVotes groups={event.groupVotes} chamber={event.chamber} />
                    {data.comparisons.filter((comparison) => comparison.chamber === event.chamber && comparison.voteId === event.voteId)
                      .map((comparison) => <CuratedEvidence key={comparison.id} comparison={comparison} event={event} />)}
                    <OfficialActLinks officialPage={event.officialPage} linkedActs={event.linkedActs} />
                    <div className={extra.whoVoted}>
                      <p className={extra.whoVotedLead}>
                        Chi ha votato
                        {expressedVoters > 0
                          ? ` · ${expressedVoters} nel perimetro filtrato`
                          : " · nessuno con voto espresso nei filtri attuali"}
                      </p>
                      <VoterGroup
                        label="Favorevoli"
                        tone="for"
                        people={event.voters.favorevoli}
                        onSelectPerson={onSelectPerson}
                      />
                      <VoterGroup
                        label="Contrari"
                        tone="against"
                        people={event.voters.contrari}
                        onSelectPerson={onSelectPerson}
                      />
                      <VoterGroup
                        label="Astenuti"
                        tone="abstain"
                        people={event.voters.astenuti}
                        onSelectPerson={onSelectPerson}
                      />
                    </div>
                  </div>
                </li>;
              })}
            </ol>
          )}
        </section>

        <section aria-label="Parlamentari del tema">
          <div className={styles.sectionHeading}>
            <h3>Parlamentari</h3>
            <span className={styles.tag}>{members.length}</span>
          </div>
          {!members.length ? (
            <Status title="Nessun parlamentare per questi filtri">
              Prova un altro tema, cambia ramo, togli «solo voti espressi», oppure cerca un cognome.
            </Status>
          ) : (
            <ul className={`${styles.convictionList} ${extra.directory}`}>
              {members.map((member) => {
                const person = peopleById.get(member.personId);
                const open = openMemberIdSafe === member.personId;
                const votes = open && data ? memberVoteTrail(member, data.events) : [];
                return <li key={member.personId}>
                  <button
                    type="button"
                    className={styles.convictionRow}
                    data-selected={selectedId === member.personId ? "true" : undefined}
                    aria-expanded={open}
                    onClick={() => setOpenMemberId(open ? null : member.personId)}
                  >
                    {person ? <Portrait person={person} size={44} /> : <span className={styles.convictionInitials} aria-hidden="true">
                      {member.name.slice(0, 2).toLocaleUpperCase("it-IT")}
                    </span>}
                    <span className={styles.convictionBody}>
                      <span className={styles.convictionName}>
                        <strong>{member.name}</strong>
                        <span className={styles.tag}>{member.chamber === "senato" ? "Senato" : "Camera"}</span>
                      </span>
                      <span className={styles.convictionMeta}>
                        {member.groupLabel ? `${member.groupLabel} · ` : ""}
                        {countLabel(member.expressedVotes, "voto espresso", "voti espressi")} · {compactRepublicVoteStateCounts(member.summary)}
                      </span>
                      {member.years.length > 0 ? (
                        <span className={styles.convictionTitle}>
                          Anni: {member.years.map((year) => `${year.year} (${compactRepublicVoteStateCounts(year)})`).join(" · ")}
                        </span>
                      ) : (
                        <span className={styles.convictionTitle}>
                          {countLabel(member.summary.totale, "votazione finale", "votazioni finali")} sul tema nello snapshot
                        </span>
                      )}
                    </span>
                    <Icon name="arrow" size={18} />
                  </button>
                  {open ? (
                    <div className={extra.memberVotes}>
                      <div className={extra.memberVotesActions}>
                        <button type="button" className={styles.textButton} onClick={() => onSelectPerson(member.personId)}>
                          Apri scheda
                        </button>
                      </div>
                      <ol className={extra.memberVoteList}>
                        {votes.map((vote) => (
                          <li key={vote.voteId} data-tone={republicVoteTone(vote.ownVote)}>
                            <div className={extra.themeTimelineMeta}>
                              <time dateTime={vote.date}>{longDate(vote.date)}</time>
                              <span className={extra.themeVotePill} data-tone={republicVoteTone(vote.ownVote)}>
                                {OWN_VOTE_LABELS[vote.ownVote]}
                              </span>
                            </div>
                            <ActHeadline
                              title={vote.actTitle}
                              chamber={member.chamber}
                              actNumber={vote.actNumber}
                              approved={vote.approved}
                            />
                            <OfficialActLinks officialPage={vote.officialPage} linkedActs={vote.linkedActs} />
                          </li>
                        ))}
                      </ol>
                    </div>
                  ) : null}
                </li>;
              })}
            </ul>
          )}
        </section>

        <div className={extra.actSource}>
          <SourceLink href={data.cameraSourceUrl}>{data.cameraSourceLabel}</SourceLink>
          <SourceLink href={data.senatoSourceUrl}>{data.senatoSourceLabel}</SourceLink>
          <SourceLink href={data.senatoGroupSourceUrl}>{data.senatoGroupSourceLabel}</SourceLink>
        </div>
        <details className={styles.disclosure}>
          <summary>Come è costruito lo storico</summary>
          <ul className={styles.bulletList}>
            {data.caveats.map((caveat) => <li key={caveat}>{caveat}</li>)}
          </ul>
        </details>
      </>
    )}
  </section>;
}
