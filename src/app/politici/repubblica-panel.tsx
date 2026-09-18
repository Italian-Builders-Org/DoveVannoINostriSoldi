"use client";

import { useState } from "react";
import type { EducationDistribution } from "@/lib/politici-education";
import { formatPercent } from "@/lib/politici-education";
import { programForGroup } from "@/lib/politici-electoral-programs";
import type {
  CameraAttendanceRanking,
  RepublicActSummary,
  RepublicActVote,
  RepublicLegislativeActivity,
  RepublicLegislativeSource,
  RepublicMap,
  RepublicProfile,
} from "@/lib/politici-repubblica";
import styles from "./politici.module.css";
import { Portrait, type GraphSelection } from "./repubblica-graph";

export type NewsConnection = {
  person: { id: string; name: string; chamber: string | null; groupId: string | null; groupLabel: string | null };
  articleCount: number;
  articleUrls: string[];
};

export type NewsArticle = {
  title: string;
  url: string;
  source: string;
  publishedAt: string | null;
};

export type NewsProvider = {
  id: string;
  name: string;
  url: string;
  note: string;
};

export type NewsState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | {
      status: "ready";
      articles: NewsArticle[];
      connections: NewsConnection[];
      observedAt: string | null;
      provider: NewsProvider | null;
    };

const MONTHS = [
  "gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno",
  "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre",
];

function longDate(iso: string): string {
  const [year, month, day] = iso.slice(0, 10).split("-").map(Number);
  if (!year || !month || !day) return iso;
  return `${day} ${MONTHS[month - 1]} ${year}`;
}

/** Articles that also name another person on the map, then the rest. */
function orderArticlesForPanel(articles: NewsArticle[], connections: NewsConnection[]): NewsArticle[] {
  const sharedUrls = new Set(connections.flatMap((connection) => connection.articleUrls));
  const shared = articles.filter((article) => sharedUrls.has(article.url));
  const alone = articles.filter((article) => !sharedUrls.has(article.url));
  return [...shared, ...alone].slice(0, 10);
}

function coCitedNamesForArticle(url: string, connections: NewsConnection[]): string[] {
  return connections
    .filter((connection) => connection.articleUrls.includes(url))
    .map((connection) => connection.person.name);
}

function sharedArticlesForConnection(
  connection: NewsConnection,
  articles: NewsArticle[],
): NewsArticle[] {
  const byUrl = new Map(articles.map((article) => [article.url, article]));
  return connection.articleUrls
    .map((url) => byUrl.get(url))
    .filter((article): article is NewsArticle => Boolean(article));
}

export function RepubblicaPanel({
  map,
  selection,
  profiles,
  legislativeSource,
  profilesFailed,
  news,
  onSelect,
  onRetryNews,
}: {
  map: RepublicMap;
  selection: GraphSelection;
  profiles: Record<string, RepublicProfile> | null;
  legislativeSource: RepublicLegislativeSource | null;
  profilesFailed: boolean;
  news: NewsState | null;
  onSelect: (selection: GraphSelection) => void;
  onRetryNews?: () => void;
}) {
  return (
    <aside className={styles.panel} aria-label="Dettaglio della selezione">
      {selection.kind === "person" ? (
        <PersonCard
          map={map}
          personId={selection.id}
          profile={profiles?.[selection.id] ?? null}
          legislativeSource={legislativeSource}
          profilesFailed={profilesFailed}
          news={news}
          onSelect={onSelect}
          onRetryNews={onRetryNews}
        />
      ) : selection.kind === "group" ? (
        <GroupCard map={map} groupId={selection.id} onSelect={onSelect} />
      ) : selection.kind === "institution" ? (
        <InstitutionCard map={map} institutionId={selection.id} onSelect={onSelect} />
      ) : (
        <OverviewCard map={map} onSelect={onSelect} />
      )}
    </aside>
  );
}

function Breadcrumb({ trail }: { trail: Array<{ label: string; onClick?: () => void }> }) {
  return (
    <nav className={styles.breadcrumb} aria-label="Percorso istituzionale">
      <ol>
        {trail.map((step, index) => (
          <li key={`${step.label}-${index}`}>
            {step.onClick ? (
              <button type="button" onClick={step.onClick}>{step.label}</button>
            ) : (
              <span aria-current="step">{step.label}</span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

function OverviewCard({ map, onSelect }: { map: RepublicMap; onSelect: (selection: GraphSelection) => void }) {
  return (
    <div className={styles.card}>
      <p className={styles.cardEyebrow}>{map.legislature.label}</p>
      <h2 className={styles.cardTitle}>La Repubblica in una mappa</h2>
      <p className={styles.cardLead}>
        Dall’alto verso il basso: il Capo dello Stato, il Governo che ha la fiducia delle Camere e i due rami del
        Parlamento, ciascuno diviso nei gruppi che lo compongono. Ogni pallino è una persona: selezionala per vedere
        curriculum istituzionale, incarichi, territorio, notizie recenti e chi viene citato insieme a lei.
      </p>
      <ul className={styles.institutionList}>
        {map.institutions.map((institution) => (
          <li key={institution.id}>
            <button type="button" className={styles.institutionRow} onClick={() => onSelect({ kind: "institution", id: institution.id })}>
              <span className={styles.institutionName}>{institution.label}</span>
              <span className={styles.institutionMeta}>
                {institution.role} · {institution.memberCount === 1 ? "1 persona" : `${institution.memberCount} persone`}
              </span>
            </button>
          </li>
        ))}
      </ul>
      <dl className={styles.figures}>
        <div><dt>Persone</dt><dd>{map.coverage.people}</dd></div>
        <div><dt>Deputati</dt><dd>{map.coverage.deputies}</dd></div>
        <div><dt>Senatori</dt><dd>{map.coverage.senators}</dd></div>
        <div><dt>Membri del Governo</dt><dd>{map.coverage.governmentMembers}</dd></div>
        <div><dt>Gruppi parlamentari</dt><dd>{map.coverage.groups}</dd></div>
        <div><dt>Con ritratto ufficiale</dt><dd>{map.coverage.peopleWithPhoto}</dd></div>
      </dl>
      <EducationDistributionBlock
        title="Formazione dichiarata · mappa"
        distribution={map.education.all}
      />
      <AttendanceRanking ranking={map.cameraAttendanceRanking} onSelect={onSelect} />
      <p className={styles.cardNote}>Dati ufficiali osservati il {longDate(map.updatedAt)}.</p>
    </div>
  );
}

function InstitutionCard({
  map,
  institutionId,
  onSelect,
}: {
  map: RepublicMap;
  institutionId: string;
  onSelect: (selection: GraphSelection) => void;
}) {
  const institution = map.institutions.find((candidate) => candidate.id === institutionId);
  if (!institution) return <div className={styles.card}><p>Istituzione non trovata.</p></div>;
  const leader = institution.leaderPersonId
    ? map.people.find((person) => person.id === institution.leaderPersonId) ?? null
    : null;
  const groups = map.groups.filter((group) => group.chamberId === institutionId);
  const departments = institutionId === "governo" ? map.departments : [];

  return (
    <div className={styles.card}>
      <Breadcrumb trail={[{ label: "Repubblica", onClick: () => onSelect({ kind: "overview" }) }, { label: institution.shortLabel }]} />
      <p className={styles.cardEyebrow}>{institution.role}</p>
      <h2 className={styles.cardTitle}>{institution.label}</h2>
      <p className={styles.cardLead}>{institution.description}</p>
      {leader ? (
        <button type="button" className={styles.leaderCard} onClick={() => onSelect({ kind: "person", id: leader.id })}>
          <span className={styles.leaderAvatar}><Portrait person={leader} size={56} /></span>
          <span>
            <strong>{leader.name}</strong>
            <span className={styles.leaderRole}>{institution.leaderRoleLabel}</span>
          </span>
        </button>
      ) : null}
      <dl className={styles.figures}>
        <div><dt>In carica</dt><dd>{institution.memberCount}</dd></div>
        {institution.seatCapacity ? <div><dt>Seggi</dt><dd>{institution.seatCapacity}</dd></div> : null}
        {institution.vacantSeats !== null ? <div><dt>Vacanti</dt><dd>{institution.vacantSeats}</dd></div> : null}
      </dl>
      {institutionId === "camera" || institutionId === "senato" || institutionId === "governo" ? (
        <EducationDistributionBlock
          title={`Formazione dichiarata · ${institution.shortLabel}`}
          distribution={
            institutionId === "camera"
              ? map.education.camera
              : institutionId === "senato"
                ? map.education.senato
                : map.education.governo
          }
        />
      ) : null}
      {groups.length > 0 ? (
        <>
          <h3 className={styles.cardSection}>Gruppi parlamentari</h3>
          <ul className={styles.chipList}>
            {groups.map((group) => (
              <li key={group.id}>
                <button type="button" className={styles.groupChip} data-family={group.partyFamily} onClick={() => onSelect({ kind: "group", id: group.id })}>
                  {group.label} <span>{group.memberCount}</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {institutionId === "camera" ? (
        <AttendanceRanking ranking={map.cameraAttendanceRanking} onSelect={onSelect} />
      ) : institutionId === "senato" ? (
        <p className={styles.cardNote}>
          Il Senato non pubblica una tabella ufficiale di partecipazione al voto equivalente a quella della Camera:
          non mostriamo una classifica inventata.
        </p>
      ) : null}
      {departments.length > 0 ? (
        <>
          <h3 className={styles.cardSection}>Ministeri e deleghe</h3>
          <ul className={styles.plainList}>
            {departments.map((department) => (
              <li key={department.id}>
                {department.label} <span className={styles.mutedInline}>{department.memberCount}</span>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      <a className={styles.cardLink} href={institution.officialPage} rel="noreferrer">Sito istituzionale</a>
    </div>
  );
}

function GroupCard({
  map,
  groupId,
  onSelect,
}: {
  map: RepublicMap;
  groupId: string;
  onSelect: (selection: GraphSelection) => void;
}) {
  const group = map.groups.find((candidate) => candidate.id === groupId);
  if (!group) return <div className={styles.card}><p>Gruppo non trovato.</p></div>;
  const institution = map.institutions.find((candidate) => candidate.id === group.chamberId)!;
  const members = map.people
    .filter((person) => person.groupId === group.id)
    .sort((a, b) => b.weight - a.weight || a.name.localeCompare(b.name, "it"));
  const president = group.presidentPersonId
    ? map.people.find((person) => person.id === group.presidentPersonId) ?? null
    : null;
  const related = group.relatedGroupIds
    .map((id) => map.groups.find((candidate) => candidate.id === id))
    .filter((candidate): candidate is RepublicMap["groups"][number] => Boolean(candidate));

  return (
    <div className={styles.card}>
      <Breadcrumb
        trail={[
          { label: "Repubblica", onClick: () => onSelect({ kind: "overview" }) },
          { label: institution.shortLabel, onClick: () => onSelect({ kind: "institution", id: institution.id }) },
          { label: group.shortLabel },
        ]}
      />
      <p className={styles.cardEyebrow}>Gruppo parlamentare · {institution.label}</p>
      <h2 className={styles.cardTitle}>{group.label}</h2>
      <dl className={styles.figures}>
        <div><dt>Componenti</dt><dd>{group.memberCount}</dd></div>
        <div><dt>Con incarico di governo</dt><dd>{members.filter((person) => person.government).length}</dd></div>
      </dl>
      <ElectoralProgramBlock
        partyFamily={group.partyFamily}
        shortLabel={group.shortLabel}
        scope="group"
      />
      {president ? (
        <button type="button" className={styles.leaderCard} onClick={() => onSelect({ kind: "person", id: president.id })}>
          <span className={styles.leaderAvatar}><Portrait person={president} size={56} /></span>
          <span>
            <strong>{president.name}</strong>
            <span className={styles.leaderRole}>Presidente del gruppo</span>
          </span>
        </button>
      ) : null}
      {group.componentLabels.length > 0 ? (
        <>
          <h3 className={styles.cardSection}>Componenti politiche</h3>
          <ul className={styles.plainList}>
            {group.componentLabels.map((label) => <li key={label}>{label}</li>)}
          </ul>
        </>
      ) : null}
      {related.length > 0 ? (
        <>
          <h3 className={styles.cardSection}>Stessa famiglia nell’altro ramo</h3>
          <ul className={styles.chipList}>
            {related.map((candidate) => (
              <li key={candidate.id}>
                <button type="button" className={styles.groupChip} data-family={candidate.partyFamily} onClick={() => onSelect({ kind: "group", id: candidate.id })}>
                  {candidate.label} <span>{candidate.memberCount}</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      <h3 className={styles.cardSection}>Componenti</h3>
      <ul className={styles.memberList}>
        {members.map((person) => (
          <li key={person.id}>
            <button type="button" className={styles.memberRow} onClick={() => onSelect({ kind: "person", id: person.id })}>
              <span className={styles.memberAvatar}><Portrait person={person} size={36} /></span>
              <span className={styles.memberText}>
                <strong>{person.name}</strong>
                <span>{person.roleLabel}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
      <a className={styles.cardLink} href={group.officialPage} rel="noreferrer">Scheda ufficiale del gruppo</a>
    </div>
  );
}

function PersonCard({
  map,
  personId,
  profile,
  legislativeSource,
  profilesFailed,
  news,
  onSelect,
  onRetryNews,
}: {
  map: RepublicMap;
  personId: string;
  profile: RepublicProfile | null;
  legislativeSource: RepublicLegislativeSource | null;
  profilesFailed: boolean;
  news: NewsState | null;
  onSelect: (selection: GraphSelection) => void;
  onRetryNews?: () => void;
}) {
  const person = map.people.find((candidate) => candidate.id === personId);
  if (!person) return <div className={styles.card}><p>Persona non trovata.</p></div>;
  const group = person.groupId ? map.groups.find((candidate) => candidate.id === person.groupId) ?? null : null;
  const institution = map.institutions.find(
    (candidate) => candidate.id === (person.chamberId ?? (person.government ? "governo" : "presidenza-repubblica")),
  )!;
  const departments = (profile?.departmentIds ?? [])
    .map((id) => map.departments.find((department) => department.id === id))
    .filter((department): department is RepublicMap["departments"][number] => Boolean(department));

  return (
    <div className={styles.card}>
      <Breadcrumb
        trail={[
          { label: "Repubblica", onClick: () => onSelect({ kind: "overview" }) },
          { label: institution.shortLabel, onClick: () => onSelect({ kind: "institution", id: institution.id }) },
          ...(group ? [{ label: group.shortLabel, onClick: () => onSelect({ kind: "group", id: group.id }) }] : []),
          { label: person.name },
        ]}
      />

      <div className={styles.personHeader}>
        <span className={styles.personPortrait}><Portrait person={person} size={112} eager /></span>
        <div>
          <h2 className={styles.cardTitle}>{person.name}</h2>
          <p className={styles.personRole}>{person.roleLabel}</p>
          {group ? (
            <button type="button" className={styles.groupChip} data-family={person.family} onClick={() => onSelect({ kind: "group", id: group.id })}>
              {group.label}
            </button>
          ) : (
            <span className={styles.groupChip} data-family="governo">{institution.label}</span>
          )}
          {profile?.componentLabel ? <p className={styles.cardNote}>Componente: {profile.componentLabel}</p> : null}
        </div>
      </div>

      {group ? (
        <ElectoralProgramBlock
          partyFamily={group.partyFamily}
          shortLabel={group.shortLabel}
          scope="person"
          personName={person.name}
        />
      ) : null}

      {profile?.voteAttendance ? (
        <section className={styles.officialFacts} aria-label="Presenze ufficiali in Aula">
          <div className={styles.officialFact}>
            <h3 className={styles.cardSection}>Presenze in Aula</h3>
            <p className={styles.rankBadge} aria-label={`Posizione ${profile.voteAttendance.rank} su ${profile.voteAttendance.rankedAmong}`}>
              <strong>{profile.voteAttendance.rank}°</strong>
              <span>su {profile.voteAttendance.rankedAmong} deputati con dato ufficiale (dal più presente al più assente)</span>
            </p>
            <p className={styles.factKind}>
              Dato <strong>individuale</strong> pubblicato dalla Camera dei deputati: partecipazione alle{" "}
              <strong>votazioni elettroniche in Aula</strong>. Non misura le commissioni né la presenza senza voto.
            </p>
            <dl className={styles.figures}>
              <div>
                <dt>Presenze (voti + missioni)</dt>
                <dd>{profile.voteAttendance.presencePercent}</dd>
              </div>
              <div>
                <dt>Voti espressi</dt>
                <dd>{profile.voteAttendance.votesCastPercent}</dd>
              </div>
              <div>
                <dt>Missioni</dt>
                <dd>{profile.voteAttendance.missionsPercent}</dd>
              </div>
              <div>
                <dt>Assenze</dt>
                <dd>{profile.voteAttendance.absencesPercent}</dd>
              </div>
            </dl>
            <p className={styles.cardNote}>
              {profile.voteAttendance.presenceTotal.toLocaleString("it-IT")} presenze
              ({profile.voteAttendance.votesCast.toLocaleString("it-IT")} voti + {profile.voteAttendance.missions.toLocaleString("it-IT")} missioni),
              {` ${profile.voteAttendance.absences.toLocaleString("it-IT")} assenze`}
              {` di cui ${profile.voteAttendance.justifiedAbsences.toLocaleString("it-IT")} giustificate`}.
              {" "}Periodo: {profile.voteAttendance.periodLabel}.
              {" "}Fonte:{" "}
              <a href={profile.voteAttendance.sourceUrl} rel="noreferrer">
                {profile.voteAttendance.sourceLabel}
              </a>
              .
            </p>
          </div>
        </section>
      ) : person.chamberId === "senato" ? (
        <p className={styles.cardNote}>
          Per i senatori non esiste una tabella ufficiale di % presenza equivalente a quella della Camera.
        </p>
      ) : null}

      {profile?.legislativeActivity && legislativeSource ? (
        <LegislativeActsSection
          personId={person.id}
          activity={profile.legislativeActivity}
          source={legislativeSource}
        />
      ) : null}

      <h3 className={styles.cardSection}>Collegamenti tipizzati</h3>
      <ul className={styles.plainList}>
        {group ? (
          <li>
            <strong>Stesso gruppo</strong>
            {" · "}
            <button type="button" className={styles.inlineLink} onClick={() => onSelect({ kind: "group", id: group.id })}>
              {group.label}
            </button>
            {` (${group.memberCount} componenti)`}
          </li>
        ) : null}
        {person.chamberId ? (
          <li>
            <strong>Stesso ramo</strong>
            {" · "}
            <button type="button" className={styles.inlineLink} onClick={() => onSelect({ kind: "institution", id: person.chamberId! })}>
              {institution.label}
            </button>
          </li>
        ) : null}
        {person.government ? (
          <li>
            <strong>Governo-Parlamento</strong>
            {" · "}
            <button type="button" className={styles.inlineLink} onClick={() => onSelect({ kind: "institution", id: "governo" })}>
              membro del Governo
            </button>
            {person.chamberId ? " e del Parlamento" : " senza mandato parlamentare"}
          </li>
        ) : null}
        {group?.relatedGroupIds.length ? (
          <li>
            <strong>Famiglia politica nell’altro ramo</strong>
            {" · "}
            {group.relatedGroupIds.map((relatedId, index) => {
              const related = map.groups.find((candidate) => candidate.id === relatedId);
              if (!related) return null;
              return (
                <span key={related.id}>
                  {index > 0 ? ", " : null}
                  <button type="button" className={styles.inlineLink} onClick={() => onSelect({ kind: "group", id: related.id })}>
                    {related.label}
                  </button>
                </span>
              );
            })}
          </li>
        ) : null}
        <li>
          <strong>Co-citazioni</strong>
          {" · "}
          {news?.status === "ready"
            ? news.connections.length > 0
              ? `${news.connections.length} person${news.connections.length === 1 ? "a" : "e"} nelle notizie sotto`
              : "nessuna altra persona della mappa in queste notizie"
            : "in caricamento con le notizie"}
        </li>
      </ul>

      {profile ? (
        <>
          <section className={styles.cvBlock} aria-label="Curriculum istituzionale">
            <h3 className={styles.cardSection}>Curriculum istituzionale</h3>
            <p className={styles.cvLead}>
              Sintesi dalle schede ufficiali di Camera, Senato e Governo: non è un curriculum personale completo
              (studi, carriera pre-parlamentare o CV privati non risultano in open data nominativo verificabile).
            </p>
            <ul className={styles.cvSummary}>
              <li>
                <strong>In carica come</strong>
                <span>{person.roleLabel}</span>
              </li>
              {group ? (
                <li>
                  <strong>Gruppo</strong>
                  <span>{group.label}{profile.groupRoleLabel ? ` · ${profile.groupRoleLabel}` : ""}</span>
                </li>
              ) : null}
              {profile.profession ? (
                <li>
                  <strong>Studi e professione</strong>
                  <span>{profile.profession}</span>
                </li>
              ) : null}
              <li>
                <strong>Area formativa (classificata)</strong>
                <span>
                  <span className={styles.educationBadge} data-area={profile.education.area}>
                    {profile.education.label}
                  </span>
                  {profile.education.area === "undeclared"
                    ? " · la fonte ufficiale non espone un titolo o una professione classificabile"
                    : null}
                </span>
              </li>
              {profile.constituency || profile.college ? (
                <li>
                  <strong>{person.chamberId === "senato" ? "Territorio" : "Elezione"}</strong>
                  <span>
                    {[profile.constituency, profile.college].filter(Boolean).join(" · ")}
                  </span>
                </li>
              ) : null}
              {departments.length > 0 ? (
                <li>
                  <strong>Dicasteri e deleghe</strong>
                  <span>{departments.map((department) => department.label).join(" · ")}</span>
                </li>
              ) : null}
              {profile.organLabels.length > 0 ? (
                <li>
                  <strong>Organi parlamentari</strong>
                  <span>{profile.organLabels.join(" · ")}</span>
                </li>
              ) : null}
              {profile.birthDate ? (
                <li>
                  <strong>Nascita</strong>
                  <span>
                    {longDate(profile.birthDate)}
                    {profile.birthPlace ? ` · ${profile.birthPlace}` : ""}
                  </span>
                </li>
              ) : null}
            </ul>

            <h4 className={styles.cvSubheading}>Incarichi in corso</h4>
            <ul className={styles.roleList}>
              {profile.roles.map((role) => (
                <li key={`${role.kind}-${role.label}-${role.organLabel ?? ""}`}>
                  <strong>{role.label}</strong>
                  {role.organLabel ? <span>{role.organLabel}</span> : null}
                  {role.since ? <span className={styles.mutedInline}>dal {longDate(role.since)}</span> : null}
                </li>
              ))}
            </ul>

            <h4 className={styles.cvSubheading}>Riassunto ufficiale</h4>
            <p className={styles.biography}>{profile.biography}</p>
          </section>

          <ul className={styles.linkList}>
            {profile.officialPages.map((page) => (
              <li key={page.url}><a href={page.url} rel="noreferrer">{page.label}</a></li>
            ))}
            {profile.socialLinks
              ? Object.entries(profile.socialLinks).map(([key, url]) => (
                <li key={key}><a href={url} rel="noreferrer nofollow">{key === "x" ? "X" : key}</a></li>
              ))
              : null}
          </ul>
          {profile.photoCredit ? (
            <p className={styles.cardNote}>{profile.photoCredit}</p>
          ) : (
            <p className={styles.cardNote}>
              Ritratto ufficiale non disponibile nelle fonti istituzionali: al suo posto compaiono le iniziali.
            </p>
          )}
        </>
      ) : profilesFailed ? (
        <p className={styles.cardNote}>La scheda completa non è disponibile in questo momento.</p>
      ) : (
        <p className={styles.cardNote}>Caricamento della scheda…</p>
      )}

      <h3 className={styles.cardSection}>Notizie recenti</h3>
      {news?.status === "ready" ? (
        news.articles.length > 0 ? (
          <>
            <ul className={styles.newsList}>
              {orderArticlesForPanel(news.articles, news.connections).map((article) => {
                const coCited = coCitedNamesForArticle(article.url, news.connections);
                return (
                  <li key={article.url} data-shared={coCited.length > 0 ? "true" : "false"}>
                    <a href={article.url} rel="noreferrer nofollow">{article.title}</a>
                    <span className={styles.newsMeta}>
                      {article.source}{article.publishedAt ? ` · ${longDate(article.publishedAt)}` : ""}
                      {coCited.length > 0 ? ` · insieme a ${coCited.join(", ")}` : ""}
                    </span>
                  </li>
                );
              })}
            </ul>
            {news.connections.length > 0 ? (
              <>
                <h3 className={styles.cardSection}>Citati insieme nelle notizie</h3>
                <ul className={styles.connectionList}>
                  {news.connections.map((connection) => {
                    const other = map.people.find((candidate) => candidate.id === connection.person.id);
                    const sharedArticles = sharedArticlesForConnection(connection, news.articles);
                    return (
                      <li key={connection.person.id} className={styles.connectionBlock}>
                        <button type="button" className={styles.memberRow} onClick={() => onSelect({ kind: "person", id: connection.person.id })}>
                          {other ? <span className={styles.memberAvatar}><Portrait person={other} size={36} /></span> : null}
                          <span className={styles.memberText}>
                            <strong>{connection.person.name}</strong>
                            <span>{connection.person.groupLabel ?? "n.d."}</span>
                          </span>
                          <span className={styles.connectionCount}>{connection.articleCount}</span>
                        </button>
                        {sharedArticles.length > 0 ? (
                          <ul className={styles.sharedNewsList} aria-label={`Notizie in comune con ${connection.person.name}`}>
                            {sharedArticles.map((article) => (
                              <li key={article.url}>
                                <a href={article.url} rel="noreferrer nofollow">{article.title}</a>
                                <span className={styles.newsMeta}>
                                  {article.source}{article.publishedAt ? ` · ${longDate(article.publishedAt)}` : ""}
                                </span>
                              </li>
                            ))}
                          </ul>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              </>
            ) : (
              <p className={styles.cardNote}>Nessun’altra persona della mappa è citata in queste notizie.</p>
            )}
            <p className={styles.cardNote}>
              {news.provider ? `${news.provider.name}: ${news.provider.note}` : null}
              {news.observedAt ? ` Ricerca del ${longDate(news.observedAt)}.` : null}
              {` Dati istituzionali osservati il ${longDate(map.updatedAt)}.`}
            </p>
          </>
        ) : (
          <p className={styles.cardNote}>Nessuna notizia trovata nell’indice per questo nome.</p>
        )
      ) : news?.status === "error" ? (
        <p className={styles.cardNote}>
          Le notizie non sono disponibili in questo momento.
          {onRetryNews ? (
            <>
              {" "}
              <button type="button" className={styles.inlineLink} onClick={onRetryNews}>
                Riprova
              </button>
            </>
          ) : null}
        </p>
      ) : (
        <p className={styles.cardNote}>Ricerca delle notizie in corso…</p>
      )}
      {news?.status !== "ready" ? (
        <p className={styles.cardNote}>Dati istituzionali osservati il {longDate(map.updatedAt)}.</p>
      ) : null}
    </div>
  );
}

function EducationDistributionBlock({
  title,
  distribution,
}: {
  title: string;
  distribution: EducationDistribution;
}) {
  const visibleAreas = distribution.areas.filter((area) => area.count > 0);
  return (
    <section className={styles.educationBlock} aria-label={title}>
      <h3 className={styles.cardSection}>{title}</h3>
      <p className={styles.educationHighlight}>
        <strong>{distribution.stemCount}</strong>
        <span>
          profili STEM su {distribution.total}
          {distribution.stemShareOfDeclared !== null
            ? ` · ${formatPercent(distribution.stemShareOfDeclared)} tra chi ha un’area dichiarata`
            : ""}
          {` · ${formatPercent(distribution.stemShareOfTotal)} sul totale`}
        </span>
      </p>
      <p className={styles.factKind}>{distribution.caveat}</p>
      <ul className={styles.educationBars}>
        {visibleAreas.map((area) => (
          <li key={area.area} data-area={area.area}>
            <div className={styles.educationBarMeta}>
              <span>{area.label}</span>
              <span>
                {area.count}
                {" · "}
                {formatPercent(area.shareOfTotal)}
              </span>
            </div>
            <div className={styles.educationBarTrack} aria-hidden="true">
              <span
                className={styles.educationBarFill}
                style={{ width: `${Math.max(area.shareOfTotal * 100, area.count > 0 ? 2 : 0)}%` }}
              />
            </div>
          </li>
        ))}
      </ul>
      <p className={styles.cardNote}>
        Dichiarati: {distribution.declared} · Non dichiarati: {distribution.undeclared}. Nessuna etichetta inventata
        dove la fonte tace.
      </p>
    </section>
  );
}

function ElectoralProgramBlock({
  partyFamily,
  shortLabel,
  scope,
  personName,
}: {
  partyFamily: string | null;
  shortLabel: string;
  scope: "group" | "person";
  personName?: string;
}) {
  const program = programForGroup({ partyFamily, shortLabel });
  if (!program) {
    return (
      <section className={styles.programBlock} aria-label="Programma elettorale">
        <h3 className={styles.cardSection}>Programma elettorale</h3>
        <p className={styles.cardNote}>
          Nessun programma ufficiale catalogato ancora per questo gruppo. Non inventiamo testi né punteggi di
          allineamento.
        </p>
      </section>
    );
  }

  return (
    <section className={styles.programBlock} aria-label="Programma elettorale">
      <h3 className={styles.cardSection}>
        {scope === "person" ? "Programma del gruppo" : "Programma elettorale"}
      </h3>
      <p className={styles.programLead}>
        <strong>{program.listLabel}</strong>
        {" · "}
        {program.electionLabel}
      </p>
      <p className={styles.cardNote}>
        Fonte:{" "}
        <a href={program.programUrl} rel="noreferrer">
          {program.programTitle}
        </a>
        {` · osservato il ${longDate(program.observedDate)} · ${program.publisher}`}
      </p>
      <h4 className={styles.cvSubheading}>Temi per cercare nelle notizie</h4>
      <ul className={styles.programThemes}>
        {program.themes.map((theme) => (
          <li key={theme.label}>
            <span className={styles.programThemeChip}>{theme.label}</span>
          </li>
        ))}
      </ul>
      <p className={styles.factKind}>
        {scope === "person" && personName
          ? `Questi temi derivano dal programma ufficiale della lista, non da un giudizio su ${personName}. L’allineamento individuale (voti, atti) non è ancora collegato.`
          : "I temi sono semi di ricerca notizie presi dal programma ufficiale. Non sono un riassunto completo né un verdetto di coerenza."}
      </p>
      <ul className={styles.programCaveats}>
        {program.caveats.map((caveat) => (
          <li key={caveat}>{caveat}</li>
        ))}
      </ul>
    </section>
  );
}

function AttendanceRanking({
  ranking,
  onSelect,
}: {
  ranking: CameraAttendanceRanking;
  onSelect: (selection: GraphSelection) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? ranking.rows : ranking.rows.slice(0, 25);
  const hiddenCount = Math.max(0, ranking.rows.length - visible.length);

  return (
    <section className={styles.rankingBlock} aria-label="Classifica presenze Camera">
      <h3 className={styles.cardSection}>Classifica presenze · Camera</h3>
      <p className={styles.factKind}>{ranking.caveat}</p>
      <p className={styles.cardNote}>
        Periodo: {ranking.periodLabel}. Fonte:{" "}
        <a href={ranking.sourceUrl} rel="noreferrer">{ranking.sourceLabel}</a>
        {`. ${ranking.matchedCount} deputati in classifica`}
        {ranking.unmatchedRows > 0 ? ` · ${ranking.unmatchedRows} righe senza match` : ""}
        {ranking.rosterWithoutRow > 0 ? ` · ${ranking.rosterWithoutRow} deputati senza riga` : ""}
        .
      </p>
      <ol className={styles.rankingList}>
        {visible.map((row) => (
          <li key={row.personId}>
            <button
              type="button"
              className={styles.rankingRow}
              onClick={() => onSelect({ kind: "person", id: row.personId })}
            >
              <span className={styles.rankingPos} aria-hidden="true">{row.rank}</span>
              <span className={styles.rankingText}>
                <strong>{row.name}</strong>
                <span>{row.groupLabel}</span>
              </span>
              <span className={styles.rankingPct}>
                <strong>{row.presencePercent}</strong>
                <span>{row.absencesPercent} assenze</span>
              </span>
            </button>
          </li>
        ))}
      </ol>
      {hiddenCount > 0 ? (
        <button type="button" className={styles.rankingMore} onClick={() => setExpanded(true)}>
          Mostra tutti ({ranking.rows.length})
        </button>
      ) : null}
      {expanded && ranking.rows.length > 25 ? (
        <button type="button" className={styles.rankingMore} onClick={() => setExpanded(false)}>
          Mostra solo i primi 25
        </button>
      ) : null}
    </section>
  );
}

const OWN_VOTE_LABELS: Record<RepublicActVote, string> = {
  F: "favorevole",
  C: "contrario",
  A: "astenuto/a",
  N: "non ha votato",
  V: "voto segreto",
  "non-rilevato": "voto non rilevato nella fonte",
};

type MoreActsState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; firstSigned: RepublicActSummary[]; coSigned: RepublicActSummary[] };

function ActRow({ act }: { act: RepublicActSummary }) {
  return (
    <li className={styles.actItem}>
      <a href={act.officialPage} rel="noreferrer" className={styles.actTitle}>
        {act.title ?? `Proposta n. ${act.number}`}
      </a>
      <span className={styles.actMeta}>
        n. {act.number}
        {act.presentedDate ? ` · presentata il ${longDate(act.presentedDate)}` : ""}
        {act.currentState
          ? ` · ${act.currentState}${act.currentStateDate ? ` (${longDate(act.currentStateDate)})` : ""}`
          : ""}
      </span>
      {act.finalVotes.map((vote) => (
        <span key={vote.id} className={styles.actMeta}>
          Votazione finale del {longDate(vote.date)}: {vote.approved ? "approvata" : "non approvata"}
          {vote.confidenceVote ? ", con questione di fiducia" : ""}
          {": posizione registrata: "}
          <strong>{OWN_VOTE_LABELS[vote.ownVote]}</strong>
        </span>
      ))}
    </li>
  );
}

function LegislativeActsSection({
  personId,
  activity,
  source,
}: {
  personId: string;
  activity: RepublicLegislativeActivity;
  source: RepublicLegislativeSource;
}) {
  const [more, setMore] = useState<MoreActsState>({ status: "idle" });
  const counts = activity.counts;
  const outcomeLabels = new Map(source.outcomeClasses.map((item) => [item.id, item.label]));

  async function loadAll() {
    setMore({ status: "loading" });
    try {
      const response = await fetch(`/api/politici/${personId}/atti`);
      const body = await response.json();
      if (!response.ok || !body.ok) throw new Error(String(response.status));
      setMore({
        status: "ready",
        firstSigned: body.firstSigned as RepublicActSummary[],
        coSigned: body.coSigned as RepublicActSummary[],
      });
    } catch {
      setMore({ status: "error" });
    }
  }

  return (
    <section className={styles.officialFacts} aria-label="Proposte di legge firmate">
      <div className={styles.officialFact}>
        <h3 className={styles.cardSection}>Proposte di legge</h3>
        <p className={styles.factKind}>
          <strong>
            {counts.firstSigned} a prima firma · {counts.coSigned} cofirmate · {counts.becameLaw} divenute legge
          </strong>
          {` (${counts.withFinalVote} con votazione finale alla Camera).`}
        </p>
        <p className={styles.cardNote}>
          Mediana Camera: {activity.comparison.chamberMedianFirstSigned.toLocaleString("it-IT")} a prima firma
          {activity.comparison.groupMedianFirstSigned !== null && activity.comparison.groupLabel
            ? ` · mediana ${activity.comparison.groupLabel}: ${activity.comparison.groupMedianFirstSigned.toLocaleString("it-IT")}`
            : ""}
          .
        </p>
        {counts.firstSigned > 0 ? (
          <p className={styles.cardNote}>
            Ha presentato più proposte a prima firma del {activity.comparison.firstSignedPercentile}% dei{" "}
            {activity.comparison.chamberSize} deputati in carica.
          </p>
        ) : null}
        {counts.byOutcome.length > 0 ? (
          <details className={styles.actDetails}>
            <summary>Esito per classe</summary>
            <dl className={styles.detailList}>
              {counts.byOutcome.map((row) => (
                <div key={row.outcomeClass}>
                  <dt>{outcomeLabels.get(row.outcomeClass) ?? row.outcomeClass}</dt>
                  <dd>
                    {row.firstSigned} a prima firma · {row.coSigned} cofirmate
                  </dd>
                </div>
              ))}
            </dl>
          </details>
        ) : null}
        {more.status !== "ready" ? (
          activity.recentFirstSigned.length > 0 ? (
            <ul className={styles.plainList}>
              {activity.recentFirstSigned.map((act) => (
                <ActRow key={act.id} act={act} />
              ))}
            </ul>
          ) : (
            <p className={styles.cardNote}>Nessuna proposta a prima firma nel periodo.</p>
          )
        ) : null}
        {more.status === "idle" && counts.total > activity.recentFirstSigned.length ? (
          <button type="button" className={styles.rankingMore} onClick={loadAll}>
            Tutti gli atti ({counts.total})
          </button>
        ) : null}
        {more.status === "loading" ? (
          <p className={styles.cardNote}>Caricamento degli atti…</p>
        ) : null}
        {more.status === "error" ? (
          <p className={styles.cardNote}>Gli atti non sono disponibili in questo momento.</p>
        ) : null}
        {more.status === "ready" ? (
          more.firstSigned.length + more.coSigned.length === 0 ? (
            <p className={styles.cardNote}>Nessun atto firmato nel periodo.</p>
          ) : (
            <>
              <h4 className={styles.cardSection}>A prima firma ({more.firstSigned.length})</h4>
              <ul className={styles.plainList}>
                {more.firstSigned.map((act) => (
                  <ActRow key={act.id} act={act} />
                ))}
              </ul>
              <h4 className={styles.cardSection}>Cofirmate ({more.coSigned.length})</h4>
              <ul className={styles.plainList}>
                {more.coSigned.map((act) => (
                  <ActRow key={act.id} act={act} />
                ))}
              </ul>
            </>
          )
        ) : null}
        <p className={styles.cardNote}>
          Fonte:{" "}
          <a href={source.sourceUrl} rel="noreferrer">
            Camera dei deputati, Open Data (dati.camera.it)
          </a>
          , {source.licenseLabel}. Periodo: {source.periodLabel}.
        </p>
        <details className={styles.actDetails}>
          <summary>Cosa non misura</summary>
          <ul className={styles.plainList}>
            {source.caveats.map((caveat) => (
              <li key={caveat}>{caveat}</li>
            ))}
          </ul>
        </details>
      </div>
    </section>
  );
}
