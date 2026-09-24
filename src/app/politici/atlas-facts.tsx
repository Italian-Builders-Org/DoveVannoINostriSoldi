"use client";

import type { RepublicMap, RepublicProfile } from "@/lib/politici-repubblica";
import type { EducationDistribution } from "@/lib/politici-education";
import { formatPercent } from "@/lib/politici-education";
import { programForGroup } from "@/lib/politici-electoral-programs";
import type { GraphSelection } from "./atlas-model";
import { longDate } from "./atlas-model";
import type { NewsData, Resource } from "./atlas-data";
import { PersonRow, SourceLink, Status } from "./atlas-primitives";
import styles from "./politici.module.css";

type Select = (selection: GraphSelection) => void;

export function EducationBlock({ distribution, scopeLabel }: { distribution: EducationDistribution; scopeLabel?: string; }) {
  return <section className={styles.factBlock} aria-label="Formazione dichiarata">
    <div className={styles.sectionHeading}>
      <h3>Formazione dichiarata{scopeLabel ? ` · ${scopeLabel}` : ""}</h3>
      <span className={styles.tag}>Da note ufficiali</span>
    </div>
    <div className={styles.educationHighlight}>
      <strong>
        {distribution.stemCount}
      </strong>
      <span>
        profili STEM su {distribution.total}
        <br />
        <small>
          {distribution.stemShareOfDeclared !== null
            ? `${formatPercent(distribution.stemShareOfDeclared)} tra chi ha un’area dichiarata · `
            : ""}
          {formatPercent(distribution.stemShareOfTotal)} sul totale
        </small>
      </span>
    </div>
    <p className={styles.note}>
      {distribution.caveat}
    </p>
    <ul className={styles.educationBars}>
      {distribution.areas.map((area) => <li key={area.area}>
        <div>
          <span>
            {area.label}
          </span>
          <span>{area.count} <small>· {formatPercent(area.shareOfTotal)}</small></span>
        </div>
        <div className={styles.barTrack} aria-hidden="true">
          <span data-area={area.area} style={{ width: `${Math.max(0, Math.min(100, area.shareOfTotal * 100))}%` }} />
        </div>
      </li>)}
    </ul>
    <p className={styles.note}>Dichiarati: {distribution.declared} · Non dichiarati: {distribution.undeclared}. Nessuna etichetta inventata dove la fonte tace.</p>
  </section>;
}

export function ProgramBlock({ family, label, personName }: { family: string | null; label: string; personName?: string; }) {
  const program = programForGroup({ partyFamily: family, shortLabel: label });
  return <section className={styles.factBlock} aria-label="Programma elettorale">
    <h3>
      {personName ? "Programma del gruppo" : "Programma elettorale"}
    </h3>
    {!program ? <Status title="Programma non ancora catalogato">Il catalogo attuale non contiene un documento ufficiale per questo gruppo.</Status> : <>
      <p>
        <strong>
          {program.listLabel}
        </strong>
        <br />
        <span className={styles.note}>
          {program.electionLabel}
        </span>
      </p>
      <SourceLink href={program.programUrl}>
        {program.programTitle}
      </SourceLink>
      <p className={styles.note}>{program.publisher} · osservato il {longDate(program.observedDate)}.</p>
      <h4>Temi di ricerca catalogati</h4>
      <ul className={styles.themeChips}>
        {program.themes.map((theme) => <li key={theme.label}>
          {theme.label}
        </li>)}
      </ul>
      <p className={styles.note}>
        {personName ? `Il programma della lista non misura la coerenza dei voti o delle azioni di ${personName}.` : "Indicazioni catalogate per la ricerca di notizie, non un riassunto completo né una valutazione dell’attuazione."}
      </p>
      <details className={styles.disclosure}>
        <summary>Metodo e limiti</summary>
        <ul className={styles.bulletList}>
          {program.caveats.map((caveat) => <li key={caveat}>
            {caveat}
          </li>)}
        </ul>
      </details>
    </>}
  </section>;
}

export function VoteAttendance({ attendance }: { attendance: NonNullable<RepublicProfile["voteAttendance"]>; }) {
  return <section className={styles.factBlock} aria-label="Partecipazione ufficiale al voto">
    <div className={styles.sectionHeading}>
      <h3>Partecipazione al voto</h3>
    </div>
    <div className={styles.attendanceHero}>
      <strong>
        {attendance.presencePercent}
      </strong>
      <span>voti espressi + missioni</span>
    </div>
    <dl className={styles.metrics}>
      <div>
        <dt>Voti espressi</dt>
        <dd>
          {attendance.votesCastPercent}
        </dd>
      </div>
      <div>
        <dt>Missioni</dt>
        <dd>
          {attendance.missionsPercent}
        </dd>
      </div>
      <div>
        <dt>Assenze</dt>
        <dd>
          {attendance.absencesPercent}
        </dd>
      </div>
    </dl>
    <p className={styles.note}>Le missioni non sono presenze fisiche in Aula. Il dato riguarda le votazioni elettroniche, non il lavoro nelle commissioni.</p>
    <p className={styles.note}>{attendance.votesCast.toLocaleString("it-IT")} voti · {attendance.missions.toLocaleString("it-IT")} missioni · {attendance.absences.toLocaleString("it-IT")} assenze, di cui {attendance.justifiedAbsences.toLocaleString("it-IT")} giustificate.</p>
    <p className={styles.note}>Periodo: {attendance.periodLabel}. Rilevazione: {longDate(attendance.observedDate)}.</p>
    <SourceLink href={attendance.sourceUrl}>
      {attendance.sourceLabel}
    </SourceLink>
  </section>;
}

export function ProfileFacts({ profile, map }: { profile: RepublicProfile; map: RepublicMap; }) {
  const departments = map.departments.filter((item) => profile.departmentIds.includes(item.id));
  return <section className={styles.factBlock} aria-label="Curriculum istituzionale">
    <h3>Curriculum istituzionale</h3>
    <p className={styles.note}>Dalle schede ufficiali, non un curriculum personale completo.</p>
    <dl className={styles.profileFacts}>
      {profile.profession ? <div>
        <dt>Studi e professione</dt>
        <dd>
          {profile.profession}
        </dd>
      </div> : null}
      <div>
        <dt>Area formativa classificata</dt>
        <dd>
          <span className={styles.tag} data-area={profile.education.area}>
            {profile.education.label}
          </span>
          {profile.education.evidence ? <small>
            {profile.education.evidence}
          </small> : <small>Nessun titolo o professione classificabile nella fonte.</small>}
        </dd>
      </div>
      {profile.constituency || profile.college ? <div>
        <dt>Territorio di elezione</dt>
        <dd>
          {[profile.constituency, profile.college].filter(Boolean).join(" · ")}
        </dd>
      </div> : null}
      {profile.groupRoleLabel ? <div>
        <dt>Incarico nel gruppo</dt>
        <dd>
          {profile.groupRoleLabel}
        </dd>
      </div> : null}
      {profile.componentLabel ? <div>
        <dt>Componente politica</dt>
        <dd>
          {profile.componentLabel}
        </dd>
      </div> : null}
      {departments.length ? <div>
        <dt>Ministeri e deleghe</dt>
        <dd>
          {departments.map((item) => item.label).join(" · ")}
        </dd>
      </div> : null}
      {profile.organLabels.length ? <div>
        <dt>Organi parlamentari</dt>
        <dd>
          {profile.organLabels.join(" · ")}
        </dd>
      </div> : null}
      {profile.birthDate || profile.birthPlace ? <div>
        <dt>Nascita</dt>
        <dd>
          {[profile.birthDate ? longDate(profile.birthDate) : null, profile.birthPlace].filter(Boolean).join(" · ")}
        </dd>
      </div> : null}
    </dl>
    <h4>Incarichi in corso</h4>
    {profile.roles.length ? <ul className={styles.roleList}>
      {profile.roles.map((role, index) => <li key={`${role.kind}-${role.label}-${index}`}>
        <strong>
          {role.label}
        </strong>
        {role.organLabel ? <span>
          {role.organLabel}
        </span> : null}
        {role.since ? <small>dal {longDate(role.since)}</small> : null}
      </li>)}
    </ul> : <p className={styles.note}>Nessun incarico aggiuntivo nella scheda.</p>}
    {profile.biography ? <details className={styles.disclosure}>
      <summary>Biografia dalle fonti</summary>
      <p className={styles.biography}>
        {profile.biography}
      </p>
    </details> : null}
    <ul className={styles.sourceList}>
      {profile.officialPages.map((page) => <li key={page.url}>
        <SourceLink href={page.url}>
          {page.label}
        </SourceLink>
      </li>)}
      {Object.entries(profile.socialLinks ?? {}).map(([label, url]) => <li key={label}>
        <SourceLink href={url}>
          {label === "x" ? "X" : label}
        </SourceLink>
      </li>)}
    </ul>
    {profile.photoCredit ? <p className={styles.note}>
      {profile.photoCredit}
    </p> : null}
  </section>;
}

export function NewsBlock({ resource, map, onSelect, onRetry }: { resource: Resource<NewsData>; map: RepublicMap; onSelect: Select; onRetry: () => void; }) {
  if (resource.status === "error") return <Status kind="error" title="Notizie non disponibili" onRetry={onRetry}>Le informazioni istituzionali restano consultabili. Riprova tra poco.</Status>;
  if (resource.status !== "ready") return <Status kind="loading" title="Ricerca delle notizie…">Stiamo interrogando l’indice, non aggiornando gli incarichi.</Status>;
  const { articles, connections, observedAt, provider } = resource.data;
  const urls = new Set(connections.flatMap((connection) => connection.articleUrls));
  const ordered = [...articles.filter((article) => urls.has(article.url)), ...articles.filter((article) => !urls.has(article.url))];
  const byUrl = new Map(articles.map((article) => [article.url, article]));
  return <section className={styles.factBlock} aria-label="Notizie e co-citazioni">
    <h3>Notizie recenti</h3>
    <p className={styles.note}>Le co-citazioni indicano soltanto nomi presenti negli stessi articoli: non dimostrano relazioni, accordi o influenza.</p>
    {!articles.length ? <Status title="Nessuna notizia trovata">L’indice consultato non contiene risultati per questo nome.</Status> : <ul className={styles.newsList}>
      {ordered.map((article) => <li key={article.url}>
        <span className={styles.newsMeta}>
          {article.source}
          {article.publishedAt ? ` · ${longDate(article.publishedAt)}` : ""}
        </span>
        <SourceLink href={article.url} className={styles.newsTitle}>
          {article.title}
        </SourceLink>
        {connections.some((connection) => connection.articleUrls.includes(article.url)) ? <p className={styles.note}>Citati anche: {connections.filter((connection) => connection.articleUrls.includes(article.url)).map((connection) => connection.person.name).join(", ")}.</p> : null}
      </li>)}
    </ul>}
    {connections.length ? <>
      <h3>Citati insieme</h3>
      <ul className={styles.connectionList}>
        {connections.map((connection) => {
          const other = map.people.find((person) => person.id === connection.person.id);
          return <li key={connection.person.id}>
            {other ? <PersonRow person={other} detail={`${connection.articleCount} articoli in comune`} onSelect={(id) => onSelect({ kind: "person", id })} /> : <p>{connection.person.name} · {connection.articleCount} articoli</p>}
            <details className={styles.disclosure}>
              <summary>Articoli in comune</summary>
              <ul className={styles.sourceList}>
                {connection.articleUrls.map((url) => <li key={url}>
                  <SourceLink href={url}>
                    {byUrl.get(url)?.title ?? "Apri l’articolo della fonte"}
                  </SourceLink>
                </li>)}
              </ul>
            </details>
          </li>;
        })}
      </ul>
    </> : null}
    {provider ? <p className={styles.note}><SourceLink href={provider.url}>
      {provider.name}
    </SourceLink> · {provider.note}</p> : null}
    <p className={styles.note}>Ricerca: {longDate(observedAt)}.</p>
  </section>;
}

export function InstitutionalRelations({ map, institutionId, onSelect }: {
  map: RepublicMap;
  institutionId?: string;
  onSelect: Select;
}) {
  const institutions = new Map(map.institutions.map((institution) => [institution.id as string, institution]));
  const relations = map.edges.filter((edge) => edge.kind === "gerarchia"
    && (!institutionId || edge.source === institutionId || edge.target === institutionId));
  if (!relations.length) return null;
  return <section className={styles.institutionalRelations} aria-label="Rapporti tra istituzioni">
    <h3>Rapporti tra istituzioni</h3>
    <ul>
      {relations.map((edge) => {
        const source = institutions.get(edge.source);
        const target = institutions.get(edge.target);
        if (!source || !target) return null;
        return <li key={edge.id}>
          <div>
            <button type="button" className={styles.textButton} onClick={() => onSelect({ kind: "institution", id: source.id })}>
              {source.shortLabel}
            </button>
            <span aria-hidden="true">·</span>
            <button type="button" className={styles.textButton} onClick={() => onSelect({ kind: "institution", id: target.id })}>
              {target.shortLabel}
            </button>
          </div>
          <p>
            {edge.label}
          </p>
        </li>;
      })}
    </ul>
    <p className={styles.note}>Relazioni istituzionali della base dati, non una misura di influenza politica.</p>
  </section>;
}
