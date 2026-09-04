import Link from "next/link";
import { DatasetInsightPanel } from "@/components/dataset-insight-panel";
import { integer } from "@/lib/format";
import {
  amountColumnKeys,
  formatIntegratedAmountCell,
} from "@/lib/integrated-dataset-insight-core";
import {
  getIntegratedDataOverview,
  selectIntegratedDataset,
  type IntegratedDatasetResult,
} from "@/lib/integrated-public-view";
import { isInsightCapable, loadDatasetInsights } from "@/lib/integrated-dataset-insights";
import type { EditorialDatasetPreview, EditorialTopic } from "@/lib/integrated-editorial";
import styles from "./editorial-topic-page.module.css";

function previewColumns(
  result: IntegratedDatasetResult,
  preferred: EditorialDatasetPreview["columns"],
): readonly Readonly<{ key: string; label: string }>[] {
  const populated = result.dataset.headers.filter((header) =>
    result.rows.some((row) => row.cells[header] !== null && row.cells[header] !== ""),
  );
  if (!preferred || preferred.length === 0) {
    return populated.slice(0, 5).map((key) => ({ key, label: key }));
  }
  return preferred
    .filter((column) => result.dataset.headers.includes(column.key))
    .slice(0, 5);
}

function cellValue(value: string | null, amount: boolean): string {
  if (value === null || value.trim() === "") return "n.d.";
  if (amount) {
    const formatted = formatIntegratedAmountCell(value);
    if (formatted !== null) return formatted;
  }
  return value;
}

function sourceDate(value: string): string {
  return new Intl.DateTimeFormat("it-IT", { dateStyle: "long", timeZone: "UTC" }).format(
    new Date(`${value}T00:00:00Z`),
  );
}

function datasetContext(
  result: IntegratedDatasetResult,
  configured: EditorialDatasetPreview,
): string {
  if (!result.dataset.queryable && configured.catalogBoundary) {
    return configured.catalogBoundary;
  }
  return result.dataset.caveats[0] ?? result.dataset.publicationNote;
}

export default async function EditorialTopicPage({ topic }: { topic: EditorialTopic }) {
  const overview = await getIntegratedDataOverview();
  const results = await Promise.all(
    topic.datasets.map((dataset) =>
      selectIntegratedDataset({ datasetId: dataset.id, limit: 3 }),
    ),
  );
  const insightSource = results.find(
    (result) =>
      result.dataset.queryable &&
      isInsightCapable(result.dataset.headers, true) &&
      result.dataset.publicRows > 0,
  );
  const insights = insightSource
    ? await loadDatasetInsights(insightSource.dataset.id)
    : null;
  const sourceRows = results.reduce((sum, result) => sum + result.dataset.sourceRows, 0);
  const publicRows = results.reduce((sum, result) => sum + result.dataset.publicRows, 0);
  const sourceLinkedRows = results.reduce(
    (sum, result) => sum + result.dataset.rowsWithPublicSource,
    0,
  );

  return (
    <main className={`shell page ${styles.page}`}>
      <header className={styles.intro}>
        <div>
          <h1>{topic.title}</h1>
          <p>{topic.introduction}</p>
        </div>
        <div className={styles.metric} aria-label={`${topic.primaryMetric} ${topic.primaryLabel}`}>
          <strong>{topic.primaryMetric}</strong>
          <span>{topic.primaryLabel}</span>
          <small>{topic.status}</small>
        </div>
      </header>

      {insights?.capable && insights.topRecipients.length > 0 ? (
        <DatasetInsightPanel insights={insights} />
      ) : null}

      <section className="stat-strip" aria-label={`Copertura di ${topic.title}`}>
        <div>
          <span className="stat-label">Insiemi collegati</span>
          <span className="stat-value">{integer(results.length)}</span>
          <span className="stat-note">ognuno conserva il proprio perimetro</span>
        </div>
        <div>
          <span className="stat-label">Righe interrogabili</span>
          <span className="stat-value">{integer(publicRows)}</span>
          <span className="stat-note">con ricerca e paginazione limitata</span>
        </div>
        <div>
          <span className="stat-label">Righe sorgente</span>
          <span className="stat-value">{integer(sourceRows)}</span>
          <span className="stat-note">contate senza omissioni silenziose</span>
        </div>
        <div>
          <span className="stat-label">Con fonte puntuale</span>
          <span className="stat-value">{integer(sourceLinkedRows)}</span>
          <span className="stat-note">almeno un collegamento pubblico sicuro</span>
        </div>
      </section>

      <section className={styles.findings} aria-labelledby="risultati-documentati">
        <h2 id="risultati-documentati">Sintesi dai file</h2>
        <dl>
          {topic.facts.map((fact) => (
            <div key={`${fact.value}-${fact.label}`}>
              <dt>{fact.label}</dt>
              <dd>
                <strong>{fact.value}</strong>
                <span>{fact.note}</span>
              </dd>
            </div>
          ))}
        </dl>
      </section>

      <details className={styles.limitsDetails}>
        <summary>Che cosa non dimostra da solo</summary>
        <ul>
          {topic.readingNotes.map((note) => <li key={note}>{note}</li>)}
        </ul>
      </details>

      <section className={styles.records} aria-labelledby="anteprima-record">
        <div className={styles.sectionHeading}>
          <div>
            <h2 id="anteprima-record">Anteprima dei record</h2>
            <p>Selezione breve; il collegamento apre grafico, fonti e tutte le righe.</p>
          </div>
          <Link className={styles.action} href="/dati">Apri il registro completo</Link>
        </div>

        {results.map((result, index) => {
          const configured = topic.datasets[index];
          const columns = previewColumns(result, configured.columns);
          const amounts = amountColumnKeys(
            columns.map((column) => column.key),
            result.rows,
          );
          return (
            <details className={styles.dataset} key={result.dataset.id} open={index === 0}>
              <summary>
                <span>
                  <strong>{configured.label}</strong>
                  <small>
                    {integer(result.dataset.sourceRows)} righe sorgente · {result.dataset.publicationNote}
                  </small>
                </span>
                <span className={result.dataset.queryable ? "tag tag-accent" : "tag tag-neutral"}>
                  {result.dataset.queryable ? "Interrogabile" : "Catalogato"}
                </span>
              </summary>
              <div className={styles.datasetBody}>
                <p>{datasetContext(result, configured)}</p>
                <dl className={styles.datasetMetadata}>
                  <div>
                    <dt>Titolare</dt>
                    <dd>{result.dataset.sourceMetadata.holder}</dd>
                  </div>
                  <div>
                    <dt>Periodo del dato</dt>
                    <dd>{result.dataset.sourceMetadata.referencePeriod ?? "Non disponibile"}</dd>
                  </div>
                  <div>
                    <dt>Ultimo controllo</dt>
                    <dd>
                      <time dateTime={result.dataset.sourceMetadata.checkedAt}>
                        {sourceDate(result.dataset.sourceMetadata.checkedAt)}
                      </time>
                    </dd>
                  </div>
                  <div>
                    <dt>Frequenza attesa</dt>
                    <dd>{result.dataset.sourceMetadata.updateFrequency ?? "Non disponibile"}</dd>
                  </div>
                </dl>
                {result.rows.length > 0 && columns.length > 0 ? (
                  <div
                    className={`table-scroll ${styles.tableWrap}`}
                    role="region"
                    aria-label={`Prime ${integer(result.rows.length)} righe di ${configured.label}`}
                    tabIndex={0}
                  >
                    <table className="table">
                      <caption className={styles.visuallyHidden}>
                        Prime {integer(result.rows.length)} righe di {configured.label}
                      </caption>
                      <thead>
                        <tr>
                          {columns.map((column) => (
                            <th
                              scope="col"
                              key={column.key}
                              className={amounts.has(column.key) ? "num" : undefined}
                            >
                              {column.label}
                            </th>
                          ))}
                          <th scope="col">Fonte</th>
                        </tr>
                      </thead>
                      <tbody>
                        {result.rows.map((row) => (
                          <tr key={row.id}>
                            {columns.map((column) => (
                              <td key={column.key} className={amounts.has(column.key) ? "num" : undefined}>
                                {cellValue(row.cells[column.key], amounts.has(column.key))}
                              </td>
                            ))}
                            <td>
                              {row.sourceUrls[0] ? (
                                <a href={row.sourceUrls[0]} target="_blank" rel="noreferrer">Apri fonte</a>
                              ) : result.dataset.sourceMetadata.canonicalUrls[0] ? (
                                <a
                                  href={result.dataset.sourceMetadata.canonicalUrls[0]}
                                  target="_blank"
                                  rel="noreferrer"
                                >
                                  Fonte del dataset
                                </a>
                              ) : (
                                <span>URL non disponibile</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className={styles.empty}>
                    Materiale nel registro, senza record puntuali in questa proiezione.
                  </p>
                )}
                <Link className={styles.action} href={`/dati/${result.dataset.id}`}>
                  {result.dataset.queryable
                    ? "Vedi destinatari, importi e tutte le righe"
                    : "Apri scheda (senza numeri)"}
                </Link>
              </div>
            </details>
          );
        })}
      </section>

      <footer className={styles.provenance}>
        <p>
          Snapshot integrato: {new Intl.DateTimeFormat("it-IT", { dateStyle: "long" }).format(new Date(overview.generatedAt))}.
          I valori restano nel perimetro dichiarato da ciascun insieme.
        </p>
        <Link href="/fonti/copertura">Verifica copertura e provenienza</Link>
      </footer>
    </main>
  );
}
