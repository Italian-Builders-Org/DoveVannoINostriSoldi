"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { VOTE_THEMES } from "@/lib/politici-voti-tema-catalog";
import type { RepublicActVote, RepublicMap } from "@/lib/politici-repubblica";
import type { Resource } from "./atlas-data";
import { requestDeadline } from "./atlas-data";
import { OWN_VOTE_LABELS } from "./atlas-legislation";
import { parseActHeadline } from "./atlas-act-headline";
import {
  DEFAULT_THEME_ID,
  longDate,
  normalizeSearch,
  THEME_CHAMBERS,
  type ThemeChamberFilter,
} from "./atlas-model";
import { Icon, Portrait, SourceLink, Status } from "./atlas-primitives";
import styles from "./politici.module.css";
import extra from "./atlas-enhancements.module.css";

type YearBucket = {
  year: string;
  events: number;
  cameraEvents: number;
  senatoEvents: number;
  favorevoli: number;
  contrari: number;
  astenuti: number;
  nonVotato: number;
};

type EventVoter = {
  personId: string;
  name: string;
  groupLabel: string | null;
  ownVote: RepublicActVote;
};

type ThemeHistoryData = {
  theme: { id: string; label: string; description: string } | null;
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
  events: Array<{
    voteId: string;
    chamber: "camera" | "senato";
    actNumber: string;
    actTitle: string;
    officialPage: string;
    date: string;
    approved: boolean;
    favorevoli: number;
    contrari: number;
    astenuti: number;
    voters: {
      favorevoli: EventVoter[];
      contrari: EventVoter[];
      astenuti: EventVoter[];
    };
  }>;
  years: YearBucket[];
  members: Array<{
    personId: string;
    name: string;
    chamber: "camera" | "senato";
    groupLabel: string | null;
    expressedVotes: number;
    summary: {
      totale: number;
      favorevoli: number;
      contrari: number;
      astenuti: number;
      nonVotato: number;
      altro: number;
    };
    years: YearBucket[];
  }>;
  themes: Array<{ id: string; label: string; description: string; chamberVotes: number }>;
  caveats: string[];
};

const object = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const text = (v: unknown): v is string => typeof v === "string";

function parseHistory(payload: unknown): ThemeHistoryData {
  if (!object(payload) || payload.ok !== true) throw new Error("invalid");
  if (!["periodLabel", "observedDate", "cameraSourceUrl", "cameraSourceLabel", "senatoSourceUrl", "senatoSourceLabel"].every((key) => text(payload[key]))
    || (payload.chamber !== "tutti" && payload.chamber !== "camera" && payload.chamber !== "senato")
    || typeof payload.expressedOnly !== "boolean"
    || !Array.isArray(payload.events)
    || !Array.isArray(payload.years)
    || !Array.isArray(payload.members)
    || !Array.isArray(payload.themes)
    || !Array.isArray(payload.caveats)
    || !payload.caveats.every(text)) {
    throw new Error("invalid");
  }
  return payload as ThemeHistoryData;
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

function voteTone(ownVote: RepublicActVote): "for" | "against" | "abstain" | "absent" {
  if (ownVote === "F") return "for";
  if (ownVote === "C") return "against";
  if (ownVote === "A") return "abstain";
  return "absent";
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

function ownVoteOnEvent(
  event: ThemeHistoryData["events"][number],
  personId: string,
): RepublicActVote {
  if (event.voters.favorevoli.some((voter) => voter.personId === personId)) return "F";
  if (event.voters.contrari.some((voter) => voter.personId === personId)) return "C";
  if (event.voters.astenuti.some((voter) => voter.personId === personId)) return "A";
  return "N";
}

function memberVoteTrail(
  member: ThemeHistoryData["members"][number],
  events: ThemeHistoryData["events"],
) {
  return events
    .filter((event) => event.chamber === member.chamber)
    .map((event) => ({
      voteId: event.voteId,
      date: event.date,
      actNumber: event.actNumber,
      actTitle: event.actTitle,
      officialPage: event.officialPage,
      approved: event.approved,
      ownVote: ownVoteOnEvent(event, member.personId),
    }));
}

function YearBars({ years, mode }: { years: YearBucket[]; mode: "events" | "votes"; }) {
  if (!years.length) return null;
  const max = Math.max(1, ...years.map((year) => (
    mode === "events"
      ? year.events
      : year.favorevoli + year.contrari + year.astenuti + year.nonVotato
  )));
  return <ol className={extra.yearBars} aria-label="Andamento per anno">
    {years.map((year) => {
      const value = mode === "events"
        ? year.events
        : year.favorevoli + year.contrari + year.astenuti + year.nonVotato;
      const width = Math.max(4, Math.round((value / max) * 100));
      return <li key={year.year}>
        <span className={extra.yearLabel}>{year.year}</span>
        <span className={extra.yearTrack} aria-hidden="true">
          <span className={extra.yearFill} style={{ width: `${width}%` }} />
        </span>
        <span className={extra.yearMeta}>
          {mode === "events"
            ? `${year.events} votazioni · Camera ${year.cameraEvents} · Senato ${year.senatoEvents}`
            : `F ${year.favorevoli} · C ${year.contrari} · A ${year.astenuti} · N ${year.nonVotato}`}
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
  if (!people.length) return null;
  return <details className={extra.voterGroup} open={people.length <= 12}>
    <summary>
      <span className={extra.themeVotePill} data-tone={tone}>{label}</span>
      <span className={styles.tag}>{people.length}</span>
    </summary>
    <ul className={extra.voterList}>
      {people.map((voter) => (
        <li key={voter.personId}>
          <button type="button" onClick={() => onSelectPerson(voter.personId)}>
            <strong>{voter.name}</strong>
            {voter.groupLabel ? <span>{voter.groupLabel}</span> : null}
          </button>
        </li>
      ))}
    </ul>
  </details>;
}

export function ThemeVoteHistoryDirectory({
  map,
  query,
  themeId,
  themeChamber,
  themeExpressedOnly,
  selectedId,
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
          {data.periodLabel}. Rilevazione: {longDate(data.observedDate)}.
          {" "}{data.events.length} votazioni in aula · {members.length} parlamentari
          {themeExpressedOnly ? " con voto espresso" : " (inclusi assenti)"}.
        </p>

        {data.years.length > 0 ? (
          <section className={extra.yearSection} aria-label="Storico per anno">
            <div className={styles.sectionHeading}>
              <h3>Nel corso degli anni</h3>
              <span className={styles.tag}>{data.years.length}</span>
            </div>
            <YearBars years={data.years} mode="events" />
          </section>
        ) : null}

        <section className={extra.storicoEvents} aria-label="Cosa si è votato">
          <div className={styles.sectionHeading}>
            <h3>Cosa si è votato</h3>
            <span className={styles.tag}>{data.events.length}</span>
          </div>
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
                return <li key={`${event.chamber}-${event.voteId}`} data-approved={event.approved ? "true" : "false"}>
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
                    <a href={event.officialPage} target="_blank" rel="noreferrer">Atto ufficiale <Icon name="arrow" size={14} /></a>
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
                        {member.expressedVotes} voti espressi · F {member.summary.favorevoli} · C {member.summary.contrari} · A {member.summary.astenuti}
                        {member.summary.nonVotato > 0 ? ` · non votato ${member.summary.nonVotato}` : ""}
                      </span>
                      {member.years.length > 0 ? (
                        <span className={styles.convictionTitle}>
                          Anni: {member.years.map((year) => `${year.year} (F${year.favorevoli}/C${year.contrari}/A${year.astenuti}/N${year.nonVotato})`).join(" · ")}
                        </span>
                      ) : (
                        <span className={styles.convictionTitle}>
                          {member.summary.totale} votazioni finali sul tema nello snapshot
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
                          <li key={vote.voteId} data-tone={voteTone(vote.ownVote)}>
                            <div className={extra.themeTimelineMeta}>
                              <time dateTime={vote.date}>{longDate(vote.date)}</time>
                              <span className={extra.themeVotePill} data-tone={voteTone(vote.ownVote)}>
                                {OWN_VOTE_LABELS[vote.ownVote]}
                              </span>
                            </div>
                            <ActHeadline
                              title={vote.actTitle}
                              chamber={member.chamber}
                              actNumber={vote.actNumber}
                              approved={vote.approved}
                            />
                            <a href={vote.officialPage} target="_blank" rel="noreferrer">Atto ufficiale <Icon name="arrow" size={14} /></a>
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
