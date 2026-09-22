"use client";

import { useEffect, useId, useState } from "react";
import type { RepublicActVote } from "@/lib/politici-repubblica";
import { VOTE_THEMES } from "@/lib/politici-voti-tema-catalog";
import type { Resource } from "./atlas-data";
import { requestDeadline } from "./atlas-data";
import { OWN_VOTE_LABELS } from "./atlas-legislation";
import { longDate } from "./atlas-model";
import { Icon, SourceLink, Status } from "./atlas-primitives";
import styles from "./politici.module.css";
import extra from "./atlas-enhancements.module.css";

type ThemeOption = {
  id: string;
  label: string;
  description: string;
  chamberVotes: number;
  expressedVotes: number;
  nonVotato: number;
};

type ThemeVoteRow = {
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

type ThemeVotesData = {
  personId: string;
  chamber: "camera" | "senato";
  theme: { id: string; label: string; description: string } | null;
  query: string | null;
  periodLabel: string;
  observedDate: string;
  sourceUrl: string;
  sourceLabel: string;
  licenseLabel: string;
  summary: {
    totale: number;
    favorevoli: number;
    contrari: number;
    astenuti: number;
    nonVotato: number;
    altro: number;
  };
  votes: ThemeVoteRow[];
  years: Array<{
    year: string;
    events: number;
    favorevoli: number;
    contrari: number;
    astenuti: number;
    nonVotato: number;
  }>;
  themes: ThemeOption[];
  caveats: string[];
};

const object = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const text = (v: unknown): v is string => typeof v === "string";
const count = (v: unknown) => Number.isSafeInteger(v) && Number(v) >= 0;

function parseThemeVotes(payload: unknown, personId: string): ThemeVotesData {
  if (!object(payload) || payload.ok !== true || payload.personId !== personId) throw new Error("invalid");
  if ((payload.chamber !== "camera" && payload.chamber !== "senato")
    || !["periodLabel", "observedDate", "sourceUrl", "sourceLabel", "licenseLabel"].every((key) => text(payload[key]))
    || !object(payload.summary)
    || !["totale", "favorevoli", "contrari", "astenuti", "nonVotato", "altro"].every((key) => count((payload.summary as Record<string, unknown>)[key]))
    || !Array.isArray(payload.votes)
    || !Array.isArray(payload.years)
    || !Array.isArray(payload.themes)
    || !Array.isArray(payload.caveats)
    || !payload.caveats.every(text)
    || !payload.years.every((year) => object(year) && text(year.year)
      && ["events", "favorevoli", "contrari", "astenuti", "nonVotato"].every((key) => count(year[key])))
    || !payload.themes.every((theme) => object(theme)
      && text(theme.id) && text(theme.label) && text(theme.description)
      && count(theme.chamberVotes) && count(theme.expressedVotes) && count(theme.nonVotato))
    || !payload.votes.every((vote) => object(vote)
      && ["voteId", "actId", "actNumber", "actTitle", "officialPage", "date"].every((key) => text(vote[key]))
      && typeof vote.approved === "boolean"
      && typeof vote.confidenceVote === "boolean"
      && ["favorevoli", "contrari", "astenuti"].every((key) => count(vote[key]))
      && text(vote.ownVote)
      && Object.hasOwn(OWN_VOTE_LABELS, vote.ownVote)
      && Array.isArray(vote.matchedNeedles)
      && vote.matchedNeedles.every(text))) {
    throw new Error("invalid");
  }
  return payload as ThemeVotesData;
}

async function loadThemeVotes(
  personId: string,
  themeId: string,
  query: string,
  signal: AbortSignal,
): Promise<ThemeVotesData> {
  const params = new URLSearchParams();
  if (themeId) params.set("tema", themeId);
  if (query.trim().length >= 3) params.set("q", query.trim());
  const deadline = requestDeadline(signal, 15_000);
  try {
    deadline.signal.throwIfAborted();
    const suffix = params.toString() ? `?${params}` : "";
    const response = await fetch(`/api/politici/${encodeURIComponent(personId)}/voti-tema${suffix}`, {
      signal: deadline.signal,
      headers: { Accept: "application/json" },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return parseThemeVotes(await response.json(), personId);
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

export function ThemeVotes({ personId, initialThemeId = null }: { personId: string; initialThemeId?: string | null; }) {
  const id = useId();
  const [themeId, setThemeId] = useState(initialThemeId && VOTE_THEMES.some((theme) => theme.id === initialThemeId) ? initialThemeId : "lavoro");
  const [query, setQuery] = useState("");
  const [draftQuery, setDraftQuery] = useState("");
  const [resource, setResource] = useState<Resource<ThemeVotesData>>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    loadThemeVotes(personId, themeId, query, controller.signal)
      .then((data) => { if (!controller.signal.aborted) setResource({ status: "ready", data }); })
      .catch(() => { if (!controller.signal.aborted) setResource({ status: "error" }); });
    return () => controller.abort();
  }, [personId, themeId, query, attempt]);

  if (resource.status === "error") {
    return <Status kind="error" title="Voti per tema temporaneamente non disponibili" onRetry={() => {
      setResource({ status: "loading" });
      setAttempt((value) => value + 1);
    }}>La scheda e le altre sezioni restano consultabili.</Status>;
  }

  const data = resource.status === "ready"
    && resource.data.personId === personId
    && (resource.data.query ?? "") === query
    && (query.trim().length >= 3 || resource.data.theme?.id === themeId)
    ? resource.data
    : null;
  const chamberLabel = data?.chamber === "senato" ? "Senato" : "Camera";

  return <section className={extra.themeSection} aria-label="Voti per tema" data-theme-votes-person={personId}>
    <div className={styles.sectionHeading}>
      <h3>Voti per tema</h3>
      <span className={styles.tag}>{chamberLabel}</span>
    </div>
    <p className={styles.note}>
      Storico delle votazioni finali su proposte il cui titolo ufficiale richiama un tema.
      Il numero sul chip è il voto espresso dalla persona (favorevole, contrario, astenuto),
      non il numero di votazioni in aula sul tema. «Non ha votato» resta distinto.
    </p>

    <div className={extra.themeChips} role="group" aria-label="Temi disponibili">
      {VOTE_THEMES.map((theme) => {
        const stats = data?.themes.find((item) => item.id === theme.id);
        const chipTitle = stats
          ? `${theme.description} · ${stats.expressedVotes} voti espressi su ${stats.chamberVotes} votazioni in aula (${stats.nonVotato} non votato)`
          : theme.description;
        return (
          <button
            key={theme.id}
            type="button"
            aria-pressed={themeId === theme.id}
            title={chipTitle}
            onClick={() => setThemeId(theme.id)}
          >
            <span>{theme.label}</span>
            {stats !== undefined ? (
              <small aria-label={`${stats.expressedVotes} voti espressi su ${stats.chamberVotes} votazioni`}>
                {stats.expressedVotes}
                <span className={extra.themeChipDenom}>/{stats.chamberVotes}</span>
              </small>
            ) : null}
          </button>
        );
      })}
    </div>

    <form
      className={extra.themeSearch}
      onSubmit={(event) => {
        event.preventDefault();
        setQuery(draftQuery.trim());
      }}
    >
      <label htmlFor={`${id}-theme-query`}>Raffina o cerca nel titolo</label>
      <div>
        <input
          id={`${id}-theme-query`}
          type="search"
          maxLength={120}
          value={draftQuery}
          placeholder="es. equo compenso, scuola, interporti"
          onChange={(event) => setDraftQuery(event.target.value)}
        />
        <button type="submit">Cerca</button>
      </div>
    </form>

    {resource.status !== "ready" || !data ? (
      <Status kind="loading" title="Caricamento dei voti per tema…" />
    ) : (
      <>
        <p className={styles.note} role="status">
          {data.theme ? <>Tema <strong>{data.theme.label}</strong>. </> : null}
          {data.query ? <>Ricerca «{data.query}». </> : null}
          {data.periodLabel}. Rilevazione: {longDate(data.observedDate)}.
        </p>

        <dl className={styles.metrics}>
          <div><dt>Votazioni in aula</dt><dd>{data.summary.totale}</dd></div>
          <div><dt>Favorevoli</dt><dd>{data.summary.favorevoli}</dd></div>
          <div><dt>Contrari</dt><dd>{data.summary.contrari}</dd></div>
          <div><dt>Astenuti</dt><dd>{data.summary.astenuti}</dd></div>
          <div><dt>Non votato</dt><dd>{data.summary.nonVotato}</dd></div>
        </dl>

        {data.years.length > 0 ? (
          <section className={extra.yearSection} aria-label="Voti per anno">
            <div className={styles.sectionHeading}>
              <h3>Nel corso degli anni</h3>
              <span className={styles.tag}>{data.years.length}</span>
            </div>
            <ol className={extra.yearBars}>
              {data.years.map((year) => {
                const total = year.favorevoli + year.contrari + year.astenuti + year.nonVotato;
                const max = Math.max(1, ...data.years.map((item) => item.favorevoli + item.contrari + item.astenuti + item.nonVotato));
                const width = Math.max(4, Math.round((total / max) * 100));
                return <li key={year.year}>
                  <span className={extra.yearLabel}>{year.year}</span>
                  <span className={extra.yearTrack} aria-hidden="true">
                    <span className={extra.yearFill} style={{ width: `${width}%` }} />
                  </span>
                  <span className={extra.yearMeta}>
                    F {year.favorevoli} · C {year.contrari} · A {year.astenuti} · N {year.nonVotato}
                  </span>
                </li>;
              })}
            </ol>
          </section>
        ) : null}

        {data.summary.totale === 0 ? (
          <Status title="Nessuna votazione finale per questo tema">
            Nello snapshot non risultano votazioni finali su atti di iniziativa parlamentare
            il cui titolo richiama il tema. Non significa assenza di proposte o di lavoro in commissione.
          </Status>
        ) : data.summary.favorevoli + data.summary.contrari + data.summary.astenuti === 0 ? (
          <Status title="Presente in aula sul tema, senza voto espresso">
            Ci sono {data.summary.totale} votazioni finali sul tema, ma in tutte questa persona risulta
            «non ha votato» (o non rilevato) secondo la fonte ufficiale. Non è un errore del conteggio:
            le votazioni esistono in aula; manca il voto individuale espresso.
          </Status>
        ) : null}

        {data.summary.totale > 0 ? (
          <ol className={extra.themeTimeline}>
            {data.votes.map((vote) => {
              const tone = voteTone(vote.ownVote);
              const numberLabel = data.chamber === "senato" || vote.actNumber.startsWith("S.")
                ? vote.actNumber
                : `A.C. ${vote.actNumber}`;
              return <li key={vote.voteId} data-tone={tone}>
                <div className={extra.themeTimelineMeta}>
                  <time dateTime={vote.date}>{longDate(vote.date)}</time>
                  <span className={extra.themeVotePill} data-tone={tone}>{OWN_VOTE_LABELS[vote.ownVote]}</span>
                </div>
                <strong>{vote.actTitle}</strong>
                <p>
                  {numberLabel}
                  {" · "}
                  {vote.approved ? "Approvata in aula" : "Non approvata in aula"}
                  {vote.confidenceVote ? " · questione di fiducia" : ""}
                </p>
                <dl className={extra.voteCounts}>
                  <div><dt>Favorevoli</dt><dd>{vote.favorevoli}</dd></div>
                  <div><dt>Contrari</dt><dd>{vote.contrari}</dd></div>
                  <div><dt>Astenuti</dt><dd>{vote.astenuti}</dd></div>
                </dl>
                <a href={vote.officialPage} target="_blank" rel="noreferrer">Atto ufficiale <Icon name="arrow" size={14} /></a>
              </li>;
            })}
          </ol>
        ) : null}

        <div className={extra.actSource}>
          <SourceLink href={data.sourceUrl}>{data.sourceLabel}</SourceLink>
          <p className={styles.note}>{data.licenseLabel}</p>
        </div>
        <details className={styles.disclosure}>
          <summary>Come è costruito il tema</summary>
          <ul className={styles.bulletList}>
            {data.caveats.map((caveat) => <li key={caveat}>{caveat}</li>)}
          </ul>
        </details>
      </>
    )}
  </section>;
}
