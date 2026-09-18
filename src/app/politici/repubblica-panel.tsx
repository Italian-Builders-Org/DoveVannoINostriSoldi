"use client";

import type { RepublicMap, RepublicProfile } from "@/lib/politici-repubblica";
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
  profilesFailed,
  news,
  onSelect,
  onRetryNews,
}: {
  map: RepublicMap;
  selection: GraphSelection;
  profiles: Record<string, RepublicProfile> | null;
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
        ruoli, gruppo, territorio, notizie recenti e chi viene citato insieme a lei.
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
  profilesFailed,
  news,
  onSelect,
  onRetryNews,
}: {
  map: RepublicMap;
  personId: string;
  profile: RepublicProfile | null;
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

      {profile?.voteAttendance ? (
        <section className={styles.officialFacts} aria-label="Presenze ufficiali in Aula">
          <div className={styles.officialFact}>
            <h3 className={styles.cardSection}>Presenze in Aula</h3>
            <p className={styles.factKind}>
              Dato <strong>individuale</strong> pubblicato dalla Camera dei deputati: per ogni deputato, quanto ha
              partecipato alle <strong>votazioni elettroniche in Aula</strong> dall’inizio della XIX legislatura.
              Non misura le sedute di commissione né la presenza fisica senza voto.
            </p>
            <p className={styles.factKind}>
              Come le legge la Camera: una <strong>presenza</strong> è un voto espresso <em>oppure</em> una missione
              ufficiale; il resto sono assenze (con colonna separata per quelle giustificate).
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
              {" "}Fonte ufficiale:{" "}
              <a href={profile.voteAttendance.sourceUrl} rel="noreferrer">
                {profile.voteAttendance.sourceLabel}
              </a>
              {" "}(tabella pubblica «Partecipazione al voto»).
            </p>
          </div>
        </section>
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
          <h3 className={styles.cardSection}>Incarichi in corso</h3>
          <ul className={styles.roleList}>
            {profile.roles.map((role) => (
              <li key={`${role.kind}-${role.label}-${role.organLabel ?? ""}`}>
                <strong>{role.label}</strong>
                {role.organLabel ? <span>{role.organLabel}</span> : null}
                {role.since ? <span className={styles.mutedInline}>dal {longDate(role.since)}</span> : null}
              </li>
            ))}
          </ul>

          <h3 className={styles.cardSection}>Scheda</h3>
          <dl className={styles.detailList}>
            {profile.constituency ? (
              <div><dt>{person.chamberId === "senato" ? "Regione" : "Circoscrizione"}</dt><dd>{profile.constituency}</dd></div>
            ) : null}
            {profile.college ? <div><dt>Collegio</dt><dd>{profile.college}</dd></div> : null}
            {profile.profession ? <div><dt>Studi e professione</dt><dd>{profile.profession}</dd></div> : null}
            {profile.birthDate ? (
              <div>
                <dt>Nascita</dt>
                <dd>{longDate(profile.birthDate)}{profile.birthPlace ? ` · ${profile.birthPlace}` : ""}</dd>
              </div>
            ) : null}
            {departments.length > 0 ? (
              <div><dt>Dicasteri e deleghe</dt><dd>{departments.map((department) => department.label).join(" · ")}</dd></div>
            ) : null}
            {profile.organLabels.length > 0 ? (
              <div><dt>Organi parlamentari</dt><dd>{profile.organLabels.join(" · ")}</dd></div>
            ) : null}
          </dl>

          <p className={styles.biography}>{profile.biography}</p>

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
