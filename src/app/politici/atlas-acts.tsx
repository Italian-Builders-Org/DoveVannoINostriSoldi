"use client";

import { useEffect, useId, useState } from "react";
import type { RepublicActSummary, RepublicLegislativeActivity } from "@/lib/politici-repubblica";
import type { Resource } from "./atlas-data";
import { filterActs, loadLegislation, OWN_VOTE_LABELS, type LegislativeData } from "./atlas-legislation";
import { longDate } from "./atlas-model";
import { Icon, SourceLink, Status } from "./atlas-primitives";
import styles from "./politici.module.css";
import extra from "./atlas-enhancements.module.css";

export function LegislativeActs({
  personId,
  activity,
}: {
  personId: string;
  activity?: RepublicLegislativeActivity | null;
}) {
  const [resource, setResource] = useState<Resource<LegislativeData>>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    loadLegislation(personId, controller.signal)
      .then((data) => { if (!controller.signal.aborted) setResource({ status: "ready", data }); })
      .catch(() => { if (!controller.signal.aborted) setResource({ status: "error" }); });
    return () => controller.abort();
  }, [personId, attempt]);
  if (resource.status === "error") return <Status kind="error" title="Atti temporaneamente non disponibili" onRetry={() => {
    setResource({ status: "loading" });
    setAttempt((value) => value + 1);
  }}>La scheda della persona e le altre sezioni restano consultabili.</Status>;
  if (resource.status !== "ready" || resource.data.personId !== personId) return <Status kind="loading" title="Caricamento degli atti…" />;
  return <ActsBrowser data={resource.data} activity={activity ?? null} />;
}

function ActsBrowser({ data, activity }: { data: LegislativeData; activity: RepublicLegislativeActivity | null }) {
  const id = useId();
  const [role, setRole] = useState<"voted" | "firstSigned" | "coSigned">(
    data.voted.length ? "voted" : "firstSigned",
  );
  const [query, setQuery] = useState("");
  const [outcome, setOutcome] = useState("");
  const [limit, setLimit] = useState(8);
  const acts = filterActs(data[role], query, outcome);
  const filtered = Boolean(query.trim() || outcome);
  const reset = () => { setQuery(""); setOutcome(""); setLimit(8); };
  const chamberLabel = data.source.chamber === "senato" ? "Senato" : "Camera";
  const comparison = activity?.comparison ?? null;
  const becameLaw = activity?.counts.becameLaw;
  return <section className={extra.actsSection} aria-label="Votazioni finali e proposte di legge" data-legislative-person={data.personId} data-legislative-chamber={data.source.chamber}>
    <div className={styles.sectionHeading}><h3>Voti finali e proposte di legge</h3><span className={styles.tag}>{chamberLabel}</span></div>
    <p className={styles.note}>{data.source.periodLabel}. Rilevazione: {longDate(data.source.observedDate)}.</p>
    <dl className={styles.metrics}>
      {data.voted.length ? <div><dt>Atti con voto finale</dt><dd>{data.voted.length}</dd></div> : null}
      <div><dt>A prima firma</dt><dd>{data.firstSigned.length}</dd></div>
      <div><dt>Cofirmate</dt><dd>{data.coSigned.length}</dd></div>
      {becameLaw !== undefined ? <div><dt>Arrivate in fondo</dt><dd>{becameLaw}</dd></div> : null}
    </dl>
    {becameLaw !== undefined ? <p className={styles.note} data-acts-end-definition="">
      «Arrivate in fondo» conta solo gli atti con classe ufficiale di esito <strong>legge</strong>,
      ricavata dalle etichette degli stati di iter del {chamberLabel}. Non è una votazione finale
      in aula e non è confrontabile con l&apos;altro ramo: Camera e Senato usano snapshot e regole
      di conteggio distinti.
    </p> : null}
    {comparison ? <p className={styles.note}>
        Mediana {chamberLabel}: {comparison.chamberMedianFirstSigned.toLocaleString("it-IT")} a prima firma
        {comparison.groupMedianFirstSigned !== null && comparison.groupLabel
          ? ` · mediana ${comparison.groupLabel}: ${comparison.groupMedianFirstSigned.toLocaleString("it-IT")}`
          : ""}
        .
      </p> : null}
    <p className={styles.note}>{data.source.chamber === "camera"
      ? "Le votazioni finali Camera comprendono atti di iniziativa parlamentare e governativa nel perimetro verificato. "
      : `Lo snapshot Senato include ${data.source.coverage.finalVotesIncluded.toLocaleString("it-IT")} votazioni finali sugli atti a prima firma senatore e sulle iniziative governative con fase Senato; ${data.source.coverage.finalVotesExcluded.toLocaleString("it-IT")} votazioni osservate su altri atti sono escluse. `}
      Il numero di firme non misura qualità o efficacia dell’attività parlamentare.</p>
    <div className={extra.actRoleSwitch} role="group" aria-label="Vista degli atti">
      {data.voted.length ? <button type="button" aria-pressed={role === "voted"} onClick={() => { setRole("voted"); setLimit(8); }}>Votazioni finali</button> : null}
      <button type="button" aria-pressed={role === "firstSigned"} onClick={() => { setRole("firstSigned"); setLimit(8); }}>Prima firma</button>
      <button type="button" aria-pressed={role === "coSigned"} onClick={() => { setRole("coSigned"); setLimit(8); }}>Cofirme</button>
    </div>
    <div className={extra.actFilters}>
      <label htmlFor={`${id}-query`}>Cerca negli atti</label>
      <input id={`${id}-query`} type="search" maxLength={120} value={query} placeholder="Titolo o numero della proposta" onChange={(event) => { setQuery(event.target.value); setLimit(8); }} />
      <label htmlFor={`${id}-outcome`}>Stato dell’iter</label>
      <select id={`${id}-outcome`} value={outcome} onChange={(event) => { setOutcome(event.target.value); setLimit(8); }}>
        <option value="">Tutti gli stati</option>
        {data.source.outcomeClasses.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
      </select>
    </div>
    <p className={styles.note} role="status">{acts.length} atti{filtered ? " corrispondono ai filtri" : " nel perimetro"}.</p>
    {filtered ? <button className={styles.textButton} type="button" onClick={reset}>Azzera ricerca negli atti <Icon name="close" size={14} /></button> : null}
    {acts.length ? <ul className={extra.actList}>{acts.slice(0, limit).map((act) => <li key={act.id}><ActCard act={act} /></li>)}</ul>
      : <Status title={filtered ? "Nessun atto corrisponde ai filtri" : "Nessun atto per questo tipo di firma"}>L’assenza di atti in questo perimetro non descrive tutta l’attività della persona.</Status>}
    {acts.length > limit ? <button type="button" className={styles.secondaryButton} onClick={() => setLimit((value) => value + 8)}>Mostra altri {Math.min(8, acts.length - limit)} atti</button> : null}
    <div className={extra.actSource}><SourceLink href={data.source.sourceUrl}>{data.source.sourceLabel}</SourceLink><p className={styles.note}>{data.source.licenseLabel}</p></div>
    <details className={styles.disclosure}><summary>Copertura e limiti degli atti</summary><ul className={styles.bulletList}>{data.source.caveats.map((caveat) => <li key={caveat}>{caveat}</li>)}</ul></details>
  </section>;
}

function ActCard({ act }: { act: RepublicActSummary }) {
  const siteLabel = act.chamber === "senato" ? "Senato" : "Camera";
  const numberLabel = act.chamber === "senato" || act.number.startsWith("S.")
    ? act.number
    : `A.C. ${act.number}`;
  return <details className={extra.actCard} data-act-id={act.id}>
    <summary>
      <span className={extra.actNumber}>{numberLabel}<Icon name="plus" size={16} /></span>
      <strong>{act.title ?? `Proposta n. ${act.number}: titolo non disponibile`}</strong>
      <span className={extra.actDate}>{act.presentedDate ? `Presentata il ${longDate(act.presentedDate)}` : "Data di presentazione non disponibile"}</span>
      <span className={extra.actState}>{act.currentState ?? "Stato dell’iter non disponibile"}</span>
    </summary>
    <div className={extra.actBody}>
      {act.initiative ? <p className={styles.note}>Iniziativa: <strong>{act.initiative.label}</strong>.</p> : null}
      {act.proposer ? <p className={styles.note}>Proponente formale: <strong>{act.proposer.label}</strong>.</p> : null}
      {act.initiative?.kind === "government" ? <p className={styles.note}>Governo responsabile: <strong>{act.responsibleGovernment?.label ?? "non disponibile nella relazione ufficiale"}</strong>.</p> : null}
      {act.currentStateDate ? <p className={styles.note}>Stato dell’iter al {longDate(act.currentStateDate)}.</p> : null}
      <p className={styles.note}>{act.coSignerCount} cofirmatari nella fonte.</p>
      {act.finalVotes.length ? <ul className={extra.actVotes}>{act.finalVotes.map((vote) => <li key={vote.id}>
        <h4>Votazione finale · {longDate(vote.date)}</h4>
        <p>{vote.approved ? "Approvata" : "Non approvata"}{vote.confidenceVote ? " · con questione di fiducia" : ""}</p>
        <p className={extra.ownVote}>Voto individuale: <strong>{OWN_VOTE_LABELS[vote.ownVote]}</strong></p>
        <dl className={extra.voteCounts}><div><dt>Favorevoli</dt><dd>{vote.favorevoli}</dd></div><div><dt>Contrari</dt><dd>{vote.contrari}</dd></div><div><dt>Astenuti</dt><dd>{vote.astenuti}</dd></div></dl>
        <p className={styles.note}>È il voto sull’atto nel suo complesso: non prova sostegno o opposizione a ogni singola misura contenuta nel testo. L’esito al {siteLabel} non equivale necessariamente all’approvazione definitiva della legge.</p>
      </li>)}</ul> : <p className={styles.note}>Nessuna votazione finale collegata nello snapshot. Non equivale a una bocciatura.</p>}
      <SourceLink href={act.officialPage}>Atto e iter sul sito del {siteLabel}</SourceLink>
    </div>
  </details>;
}
