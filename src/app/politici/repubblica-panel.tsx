"use client";

import { useState } from "react";
import { PartySymbol, SymbolSource } from "./atlas-symbol";
import { LegislativeActs } from "./atlas-acts";
import { ThemeVotes } from "./atlas-theme-votes";
import type { RepublicMap, RepublicProfile } from "@/lib/politici-repubblica";
import type { GraphSelection } from "./atlas-model";
import { longDate } from "./atlas-model";
import type { NewsData, Resource } from "./atlas-data";
import { Icon, PersonRow, Portrait, SourceLink, Status } from "./atlas-primitives";
import { EducationBlock, InstitutionalRelations, NewsBlock, ProfileFacts, ProgramBlock, VoteAttendance } from "./atlas-facts";
import { JudicialBlock, type JudicialState } from "./atlas-judicial";
import styles from "./politici.module.css";
import extra from "./atlas-enhancements.module.css";

type PanelProps = {
  map: RepublicMap;
  selection: GraphSelection;
  profiles: Resource<Record<string, RepublicProfile>>;
  news: Resource<NewsData>;
  judicial: JudicialState | null;
  initialTab?: "profilo" | "atti" | "temi" | "notizie" | null;
  themeId?: string | null;
  onSelect: (selection: GraphSelection) => void;
  onExploreGroupVotes: (groupId: string, chamber: "camera" | "senato") => void;
  onRetryProfiles: () => void;
  onRetryNews: () => void;
};

export function RepubblicaPanel(props: PanelProps) {
  const { map, selection, onSelect } = props;
  if (selection.kind === "person") return <PersonPanel {...props} personId={selection.id} />;
  if (selection.kind === "group") return <GroupPanel map={map} id={selection.id} onSelect={onSelect} onExploreGroupVotes={props.onExploreGroupVotes} />;
  if (selection.kind === "institution") return <InstitutionPanel map={map} id={selection.id} onSelect={onSelect} />;
  return <div className={styles.panelContent}>
    <p className={styles.eyebrow}>Le istituzioni italiane</p>
    <h2 className={styles.panelTitle} tabIndex={-1}>La Repubblica,<br />da vicino.</h2>
    <p className={styles.panelLead}>Persone, incarichi e gruppi parlamentari. Informazioni verificabili, a partire dalle fonti ufficiali.</p>
    <dl className={styles.metrics}>
      <div>
        <dt>Persone uniche</dt>
        <dd>
          {map.coverage.people}
        </dd>
      </div>
      <div>
        <dt>Gruppi</dt>
        <dd>
          {map.coverage.groups}
        </dd>
      </div>
    </dl>
    <nav className={styles.institutionList} aria-label="Esplora le istituzioni">
      {map.institutions.map((institution) => <button type="button" key={institution.id} onClick={() => onSelect({ kind: "institution", id: institution.id })}>
        <span>
          <strong>
            {institution.shortLabel}
          </strong>
          <small>
            {institution.role}
          </small>
        </span>
        <Icon name="arrow" size={18} />
      </button>)}
    </nav>
    <EducationBlock distribution={map.education.all} scopeLabel="mappa" />
    <p className={styles.note}>Una persona con più incarichi è contata una sola volta. La mappa non misura influenza politica.</p>
    <p className={styles.note}>Rilevazione più recente: {longDate(map.updatedAt)}. Le date delle singole fonti possono differire.</p>
  </div>;
}

function InstitutionPanel({ map, id, onSelect }: Pick<PanelProps, "map" | "onSelect"> & { id: string; }) {
  const institution = map.institutions.find((item) => item.id === id);
  if (!institution) return <Status title="Istituzione non trovata" />;
  const leader = map.people.find((person) => person.id === institution.leaderPersonId);
  const distribution = id === "camera" || id === "senato" || id === "governo" ? map.education[id] : null;
  const groups = map.groups.filter((group) => group.chamberId === id).sort((a, b) => b.memberCount - a.memberCount || a.label.localeCompare(b.label, "it"));
  return <div className={styles.panelContent}>
    <p className={styles.eyebrow}>
      {id === "camera" || id === "senato" ? map.legislature.label : institution.role}
    </p>
    <h2 className={styles.panelTitle} tabIndex={-1}>
      {institution.label}
    </h2>
    <p className={styles.panelLead}>
      {institution.description}
    </p>
    <dl className={styles.metrics}>
      <div>
        <dt>Componenti censiti</dt>
        <dd>
          {institution.memberCount}
        </dd>
      </div>
      {institution.vacantSeats !== null ? <div>
        <dt>Seggi vacanti</dt>
        <dd>
          {institution.vacantSeats}
        </dd>
      </div> : groups.length ? <div>
        <dt>Gruppi</dt>
        <dd>
          {groups.length}
        </dd>
      </div> : null}
    </dl>
    {institution.seatCapacity !== null ? <p className={styles.note}>Capienza riportata dalla fonte: {institution.seatCapacity} seggi.</p> : null}
    {leader ? <div className={styles.leaderBlock}>
      <p className={styles.eyebrow}>
        {institution.leaderRoleLabel ?? "Presidenza"}
      </p>
      <PersonRow person={leader} onSelect={(personId) => onSelect({ kind: "person", id: personId })} />
    </div> : null}
    <SourceLink href={institution.officialPage}>Sito istituzionale</SourceLink>
    <details className={styles.disclosure}>
      <summary>Rapporti con le altre istituzioni</summary>
      <InstitutionalRelations map={map} institutionId={id} onSelect={onSelect} />
    </details>
    {groups.length ? <details className={styles.disclosure}>
      <summary>Gruppi parlamentari <span>
        {groups.length}
      </span></summary>
      <ul className={styles.groupList}>
        {groups.map((group) => <li key={group.id}>
          <button type="button" onClick={() => onSelect({ kind: "group", id: group.id })}>
            <PartySymbol family={group.partyFamily} label={group.shortLabel} />
            <span>
              {group.shortLabel}
            </span>
            <strong>
              {group.memberCount}
            </strong>
          </button>
        </li>)}
      </ul>
    </details> : null}
    {distribution ? <EducationBlock distribution={distribution} scopeLabel={institution.shortLabel} /> : null}
    {id === "senato" ? <p className={styles.note}>Nella base dati non è disponibile una tabella del Senato equivalente alla partecipazione al voto della Camera.</p> : null}
    {id === "governo" ? <details className={styles.disclosure}>
      <summary>Ministeri e deleghe <span>
        {map.departments.length}
      </span></summary>
      <ul className={styles.departmentList}>
        {map.departments.map((department) => <li key={department.id}>
          <span>
            {department.label}
          </span>
          <strong>
            {department.memberCount}
          </strong>
        </li>)}
      </ul>
    </details> : null}
    <p className={styles.note}>Consulta «Fonti e limiti» per date e copertura. Nessun dato viene aggiornato in tempo reale dall’emiciclo.</p>
  </div>;
}

function GroupPanel({ map, id, onSelect, onExploreGroupVotes }: Pick<PanelProps, "map" | "onSelect" | "onExploreGroupVotes"> & { id: string; }) {
  const [limit, setLimit] = useState(25);
  const group = map.groups.find((item) => item.id === id);
  if (!group) return <Status title="Gruppo non trovato" />;
  const members = map.people.filter((person) => person.groupId === id).sort((a, b) => a.name.localeCompare(b.name, "it"));
  const president = map.people.find((person) => person.id === group.presidentPersonId);
  const related = map.groups.filter((item) => group.relatedGroupIds.includes(item.id));
  return <div className={styles.panelContent}>
    <button type="button" className={styles.backButton} onClick={() => onSelect({ kind: "institution", id: group.chamberId })}>
      <Icon name="back" size={16} />
      {group.chamberId === "camera" ? "Camera" : "Senato"}
    </button>
    <p className={styles.eyebrow}>Gruppo parlamentare</p>
    <div className={extra.symbolHeading}>
      <PartySymbol family={group.partyFamily} label={group.shortLabel} size={44} />
      <h2 className={styles.panelTitle} tabIndex={-1}>{group.shortLabel}</h2>
    </div>
    {group.label !== group.shortLabel ? <p className={styles.panelLead}>
      {group.label}
    </p> : null}
    <button type="button" className={styles.secondaryButton} onClick={() => onExploreGroupVotes(group.id, group.chamberId)}>
      Esplora i voti del gruppo <Icon name="arrow" size={16} />
    </button>
    <dl className={styles.metrics}>
      <div>
        <dt>Componenti</dt>
        <dd>
          {group.memberCount}
        </dd>
      </div>
      <div>
        <dt>Anche al Governo</dt>
        <dd>
          {members.filter((person) => person.government).length}
        </dd>
      </div>
    </dl>
    {president ? <div className={styles.leaderBlock}>
      <p className={styles.eyebrow}>Presidenza del gruppo</p>
      <PersonRow person={president} onSelect={(personId) => onSelect({ kind: "person", id: personId })} />
    </div> : null}
    <SourceLink href={group.officialPage}>Scheda ufficiale del gruppo</SourceLink>
    <SymbolSource family={group.partyFamily} />
    <details className={styles.disclosure}>
      <summary>Programma elettorale</summary>
      <ProgramBlock family={group.partyFamily} label={group.shortLabel} />
    </details>
    {group.componentLabels.length ? <details className={styles.disclosure}>
      <summary>Componenti politiche</summary>
      <ul className={styles.bulletList}>
        {group.componentLabels.map((label) => <li key={label}>
          {label}
        </li>)}
      </ul>
    </details> : null}
    {related.length ? <details className={styles.disclosure}>
      <summary>Nell’altro ramo del Parlamento</summary>
      {related.map((item) => <button
        type="button"
        key={item.id}
        className={styles.secondaryButton}
        onClick={() => onSelect({ kind: "group", id: item.id })}>{item.shortLabel} · {item.chamberId === "camera" ? "Camera" : "Senato"}<Icon name="arrow" size={16} /></button>)}
      <p className={styles.note}>Famiglia politica ricavata dai nomi ufficiali: non implica identità giuridica o coordinamento.</p>
    </details> : null}
    <h3 className={styles.listHeading}>Componenti <span>
      {members.length}
    </span></h3>
    <ul className={styles.memberList}>
      {members.slice(0, limit).map((person) => <li key={person.id}>
        <PersonRow person={person} onSelect={(personId) => onSelect({ kind: "person", id: personId })} />
      </li>)}
    </ul>
    {limit < members.length ? <button type="button" className={styles.secondaryButton} onClick={() => setLimit((value) => value + 25)}>Mostra altri {Math.min(25, members.length - limit)}</button> : null}
  </div>;
}

function PersonPanel({ personId, map, profiles, news, judicial, initialTab = null, themeId = null, onSelect, onRetryProfiles, onRetryNews }: PanelProps & { personId: string; }) {
  const person = map.people.find((candidate) => candidate.id === personId);
  const hasChamberActs = person?.chamberId === "camera" || person?.chamberId === "senato";
  const startTab = initialTab === "temi" && hasChamberActs
    ? "temi"
    : initialTab === "atti" && hasChamberActs
      ? "atti"
      : initialTab === "notizie"
        ? "notizie"
        : "profilo";
  const [tab, setTab] = useState<"profilo" | "atti" | "temi" | "notizie">(startTab);
  if (!person) return <Status title="Persona non trovata" />;
  const group = map.groups.find((item) => item.id === person.groupId);
  const profile = profiles.status === "ready" ? profiles.data[personId] : null;
  const institutionId = person.chamberId ?? (person.government ? "governo" : "presidenza-repubblica");
  const institution = map.institutions.find((item) => item.id === institutionId);
  const newsReady = news.status === "ready" ? news.data : null;
  return <div className={styles.panelContent} data-profile-id={person.id}>
    <button type="button" className={styles.backButton} onClick={() => onSelect({ kind: "institution", id: institutionId })}>
      <Icon name="back" size={16} />
      {institution?.shortLabel ?? "Istituzione"}
    </button>
    <div className={styles.personHeader}>
      <Portrait person={person} size={80} eager />
      <span className={styles.eyebrow}>Scheda istituzionale</span>
    </div>
    <h2 className={styles.panelTitle} tabIndex={-1}>
      {person.name}
    </h2>
    <p className={styles.panelLead}>
      {person.roleLabel}
    </p>
    {group ? <button type="button" className={styles.groupBadge} onClick={() => onSelect({ kind: "group", id: group.id })}>
      <PartySymbol family={group.partyFamily} label={group.shortLabel} />
      {group.shortLabel}
      <Icon name="arrow" size={14} />
    </button> : <span className={styles.tag}>
      {institution?.shortLabel ?? "Gruppo non disponibile"}
    </span>}
    <div className={styles.panelTabs} role="group" aria-label="Contenuto della scheda">
      {hasChamberActs
        ? <button type="button" aria-pressed={tab === "temi"} onClick={() => setTab("temi")}>Voti per tema</button>
        : null}
      {hasChamberActs
        ? <button type="button" aria-pressed={tab === "atti"} onClick={() => setTab("atti")}>Atti e voti</button>
        : null}
      <button type="button" aria-pressed={tab === "profilo"} onClick={() => setTab("profilo")}>Profilo e incarichi</button>
      <button type="button" aria-pressed={tab === "notizie"} onClick={() => setTab("notizie")}>
        Notizie
        {newsReady && newsReady.articles.length > 0 ? <span className={styles.countMark}>{newsReady.articles.length}</span> : null}
      </button>
    </div>
    {tab === "notizie" ? <NewsBlock resource={news} map={map} onSelect={onSelect} onRetry={onRetryNews} />
      : tab === "atti" ? <LegislativeActs key={person.id} personId={person.id} activity={profile?.legislativeActivity ?? null} />
      : tab === "temi" ? <ThemeVotes key={`tema-${person.id}-${themeId ?? "lavoro"}`} personId={person.id} initialThemeId={themeId} />
      : <>
      {person.government ? <button type="button" className={styles.relationshipLink} onClick={() => onSelect({ kind: "institution", id: "governo" })}>
        <span>Membro del Governo<small>
          {person.chamberId ? "Con mandato anche in Parlamento" : "Senza mandato parlamentare"}
        </small></span>
        <Icon name="arrow" size={18} />
      </button> : null}
      {group?.relatedGroupIds.length ? <details className={styles.disclosure} open>
        <summary>Collegamenti istituzionali</summary>
        <p className={styles.note}>Stessa famiglia politica nell’altro ramo, non una relazione personale.</p>
        {group.relatedGroupIds.map((id) => {
          const related = map.groups.find((item) => item.id === id);
          return related ? <button
            type="button"
            key={id}
            className={styles.textButton}
            onClick={() => onSelect({ kind: "group", id })}>{related.shortLabel} · {related.chamberId}</button> : null;
        })}
      </details> : null}
      {profile ? <>
        {profile.voteAttendance ? <VoteAttendance attendance={profile.voteAttendance} /> : <p className={styles.note}>
          {person.chamberId === "senato" ? "Partecipazione al voto: tabella equivalente della Camera non disponibile per il Senato." : "Nessun dato individuale di partecipazione al voto collegato a questa scheda."}
        </p>}
        <ProfileFacts profile={profile} map={map} />
      </> : profiles.status === "error" ? <Status kind="error" title="Scheda completa non disponibile" onRetry={onRetryProfiles}>Nome e incarico restano visibili dai dati della mappa.</Status> : profiles.status === "ready" ? <Status title="Scheda non presente nello snapshot">Il profilo aggiuntivo non è disponibile per questa persona.</Status> : <Status kind="loading" title="Caricamento della scheda…" />}
      <JudicialBlock judicial={judicial} />
      {news.status === "error" ? <Status kind="error" title="Notizie non disponibili" onRetry={onRetryNews}>Puoi comunque consultare incarichi e fonti ufficiali.</Status>
        : news.status === "loading" || news.status === "idle" ? <Status kind="loading" title="Caricamento delle notizie…">Le co-citazioni sulla mappa compaiono quando l’indice risponde.</Status>
          : newsReady && newsReady.connections.length > 0 ? <section className={styles.factBlock} aria-label="Citati insieme nelle notizie">
            <div className={styles.sectionHeading}>
              <h3>Citati insieme</h3>
              <span className={styles.countMark}>{newsReady.connections.length}</span>
            </div>
            <p className={styles.note}>Nomi presenti negli stessi articoli: non dimostrano relazioni personali. Gli archi rossi sull’emiciclo mostrano gli stessi collegamenti.</p>
            <ul className={styles.connectionList}>
              {newsReady.connections.slice(0, 6).map((connection) => {
                const other = map.people.find((candidate) => candidate.id === connection.person.id);
                return <li key={connection.person.id}>
                  {other
                    ? <PersonRow person={other} detail={`${connection.articleCount} articoli in comune`} onSelect={(id) => onSelect({ kind: "person", id })} />
                    : <p>{connection.person.name} · {connection.articleCount} articoli</p>}
                </li>;
              })}
            </ul>
            <button type="button" className={styles.secondaryButton} onClick={() => setTab("notizie")}>
              Apri tutte le notizie
              <Icon name="arrow" size={16} />
            </button>
          </section>
            : newsReady ? <p className={styles.note}>Nessuna co-citazione con altre persone della mappa in questi articoli. <button type="button" className={styles.textButton} onClick={() => setTab("notizie")}>Vedi le notizie</button></p> : null}
      {group ? <details className={styles.disclosure}>
        <summary>Programma del gruppo</summary>
        <ProgramBlock family={group.partyFamily} label={group.shortLabel} personName={person.name} />
      </details> : null}
    </>}
  </div>;
}
