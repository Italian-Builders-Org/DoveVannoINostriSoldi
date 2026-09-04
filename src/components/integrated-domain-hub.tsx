import Link from "next/link";
import { integer } from "@/lib/format";
import { getEditorialTopics, type EditorialTopic } from "@/lib/integrated-editorial";
import { getIntegratedDataOverview } from "@/lib/integrated-public-view";
import styles from "./integrated-domain-hub.module.css";

const DOMAIN_LABELS: Record<string, string> = {
  appointments: "Incarichi nominativi",
  procurement: "Appalti e fornitori",
  consultancies: "Consulenze e incarichi",
  personnel: "Personale e organi",
  operations: "Spese operative",
  transparency: "Trasparenza",
  oversight: "Controlli e atti",
  benchmarks: "Benchmark",
  evidence: "Segnali ed evidenze",
  sources: "Indici delle fonti",
  entities: "Enti",
  "state-accounts": "Conti dello Stato",
  projects: "Progetti",
  "candidate-batches": "Lotti di candidati contabilizzati",
};

const EVIDENCE_LABELS: Record<string, string> = {
  "documented-fact": "Fatto documentato",
  "missing-data": "Dato mancante",
  "verified-difference": "Scostamento verificato",
  "needs-explanation": "Richiede una spiegazione",
  "official-finding": "Accertamento ufficiale",
};

function publicationLabel(publication: string): string {
  if (publication === "rows") return "Righe interrogabili";
  if (publication === "source-index") return "Indice interrogabile";
  if (publication === "catalog-only") return "Solo catalogo";
  return "Materiale derivato";
}

type RelatedView = Readonly<{
  href: string;
  title: string;
  summary: string;
  metric: string;
}>;

type IntegratedDomainHubProps = Readonly<{
  title: string;
  introduction: string;
  domains: readonly string[];
  editorialSection: EditorialTopic["section"];
  interpretation: string;
  related?: readonly RelatedView[];
}>;

export default async function IntegratedDomainHub({
  title,
  introduction,
  domains,
  editorialSection,
  interpretation,
  related = [],
}: IntegratedDomainHubProps) {
  const overview = await getIntegratedDataOverview();
  const selected = overview.datasets.filter((dataset) => domains.includes(dataset.domain));
  const publicRows = selected.reduce((sum, dataset) => sum + dataset.publicRows, 0);
  const sourceRows = selected.reduce((sum, dataset) => sum + dataset.sourceRows, 0);
  const queryable = selected.filter((dataset) => dataset.queryable).length;
  const topics = getEditorialTopics(editorialSection);

  return (
    <main className={`shell page ${styles.page}`}>
      <header className={styles.intro}>
        <h1>{title}</h1>
        <p>{introduction}</p>
      </header>

      <section className="stat-strip" aria-label={`Copertura: ${title}`}>
        <div>
          <span className="stat-label">Insiemi</span>
          <span className="stat-value">{integer(selected.length)}</span>
          <span className="stat-note">tutti contabilizzati nel registro centrale</span>
        </div>
        <div>
          <span className="stat-label">Righe sorgente</span>
          <span className="stat-value">{integer(sourceRows)}</span>
          <span className="stat-note">conteggiate nel proprio perimetro</span>
        </div>
        <div>
          <span className="stat-label">Righe interrogabili</span>
          <span className="stat-value">{integer(publicRows)}</span>
          <span className="stat-note">zero e dato mancante restano distinti</span>
        </div>
        <div>
          <span className="stat-label">Insiemi interrogabili</span>
          <span className="stat-value">{integer(queryable)}</span>
          <span className="stat-note">con ricerca e paginazione limitata</span>
        </div>
      </section>

      <aside className="notice">
        <strong>Come leggere questi dati</strong>
        <p>{interpretation}</p>
      </aside>

      <section className={styles.explore} aria-labelledby="percorsi-tematici">
        <div className={styles.sectionHeading}>
          <h2 id="percorsi-tematici">Percorsi tematici</h2>
          <p>Ogni anteprima porta a una pagina leggibile e, da lì, a tutte le righe e alle fonti.</p>
        </div>
        <div className={styles.features}>
          {topics.map((topic) => (
            <article className={styles.feature} key={topic.slug}>
              <div className={styles.featureMetric}>
                <strong>{topic.primaryMetric}</strong>
                <span>{topic.primaryLabel}</span>
              </div>
              <div className={styles.featureCopy}>
                <div className={styles.featureTitle}>
                  <h3><Link href={`/${topic.section}/${topic.slug}`}>{topic.title}</Link></h3>
                  <span className="tag tag-neutral">{topic.status}</span>
                </div>
                <p>{topic.hubSummary}</p>
                <ul>
                  {topic.facts.slice(0, 2).map((fact) => (
                    <li key={`${topic.slug}-${fact.label}`}>
                      <strong>{fact.value}</strong> {fact.label.toLocaleLowerCase("it-IT")}
                    </li>
                  ))}
                </ul>
              </div>
              <Link className={styles.openLink} href={`/${topic.section}/${topic.slug}`}>
                Apri analisi e record
              </Link>
            </article>
          ))}
          {related.map((view) => (
            <article className={styles.feature} key={view.href}>
              <div className={styles.featureMetric}>
                <strong>{view.metric}</strong>
                <span>vista già verificata</span>
              </div>
              <div className={styles.featureCopy}>
                <div className={styles.featureTitle}><h3><Link href={view.href}>{view.title}</Link></h3></div>
                <p>{view.summary}</p>
              </div>
              <Link className={styles.openLink} href={view.href}>Apri la vista</Link>
            </article>
          ))}
        </div>
      </section>

      <details className={styles.register}>
        <summary>
          <span>
            <strong>Espandi il registro tecnico</strong>
            <small>{integer(selected.length)} insiemi con stato, righe, fonti e limiti</small>
          </span>
        </summary>
        <div
          className={`table-scroll ${styles.tableWrap}`}
          role="region"
          aria-label={`Registro tecnico degli insiemi in ${title}`}
          tabIndex={0}
        >
          <table className="table">
            <caption className={styles.visuallyHidden}>Registro tecnico degli insiemi in {title}</caption>
            <thead>
              <tr>
                <th scope="col">Insieme</th>
                <th scope="col">Area</th>
                <th scope="col">Stato</th>
                <th scope="col" className="num">Righe</th>
                <th scope="col">Evidenza</th>
                <th scope="col">Apri</th>
              </tr>
            </thead>
            <tbody>
              {selected.map((dataset) => (
                <tr key={dataset.id}>
                  <th scope="row">{dataset.title}</th>
                  <td>{DOMAIN_LABELS[dataset.domain] ?? dataset.domain}</td>
                  <td>{publicationLabel(dataset.publication)}</td>
                  <td className="num">{integer(dataset.sourceRows)}</td>
                  <td>{EVIDENCE_LABELS[dataset.evidenceLabel] ?? dataset.evidenceLabel}</td>
                  <td><Link href={`/dati/${dataset.id}`}>Dati e fonti</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>

      <section className={`panel ${styles.more}`}>
        <h2 className="panel-title">Registro e provenienza</h2>
        <p>
          Il catalogo generale espone tutti i {integer(overview.totals.datasets)} insiemi; la copertura mostra come elementi,
          identità di fonte e righe si riconciliano senza omissioni silenziose.
        </p>
        <div>
          <Link href="/dati">Tutti gli insiemi</Link>
          <Link href="/fonti/copertura">Copertura completa</Link>
          <Link href="/fonti/catalogo">Catalogo delle fonti</Link>
        </div>
      </section>
    </main>
  );
}
