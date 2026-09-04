import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { DatasetInsightPanel } from "@/components/dataset-insight-panel";
import Pagination from "@/components/pagination";
import { integer } from "@/lib/format";
import { relatedReadingForDataset } from "@/lib/integrated-catalog-views";
import {
  amountColumnKeys,
  formatIntegratedAmountCell,
  isInsightCapable,
  loadDatasetInsights,
} from "@/lib/integrated-dataset-insights";
import { integratedDomainLabel } from "@/lib/integrated-domains";
import {
  getIntegratedDataOverview,
  INTEGRATED_DEFAULT_LIMIT,
  INTEGRATED_MAX_LIMIT,
  IntegratedDatasetNotFoundError,
  IntegratedQueryError,
  selectIntegratedDataset,
  type IntegratedDatasetResult,
} from "@/lib/integrated-public-view";
import { offsetFromPage, pageCountFromTotal, pageFromOffset } from "@/lib/pagination";
import styles from "../dati.module.css";

type SearchValue = string | string[] | undefined;
type DatasetPageProps = {
  params: Promise<{ dataset: string }>;
  searchParams: Promise<Record<string, SearchValue>>;
};

const EVIDENCE_LABELS: Record<string, string> = {
  "documented-fact": "Fatto documentato",
  "missing-data": "Dato mancante",
  "verified-difference": "Scostamento verificato",
  "needs-explanation": "Richiede una spiegazione",
  "official-finding": "Accertamento ufficiale",
};

function pageHref(
  datasetId: string,
  result: IntegratedDatasetResult,
  page: { cursor?: string; offset?: number },
): string {
  const query = new URLSearchParams();
  if (result.query) query.set("q", result.query);
  query.set("limit", String(result.limit));
  if (page.cursor) query.set("cursor", page.cursor);
  if (page.offset && page.offset > 0) query.set("offset", String(page.offset));
  return `/dati/${datasetId}?${query.toString()}`;
}

function requestedLimit(value: SearchValue): number {
  if (typeof value === "string" && /^\d+$/.test(value)) {
    const parsed = Number(value);
    if (parsed >= 1 && parsed <= INTEGRATED_MAX_LIMIT) return parsed;
  }
  return INTEGRATED_DEFAULT_LIMIT;
}

function requestedOffset(search: Record<string, SearchValue>, limit: number): SearchValue {
  if (search.offset !== undefined && search.offset !== "") return search.offset;
  if (search.q !== undefined && search.q !== "") return undefined;
  const page = search.pagina;
  if (typeof page === "string" && /^\d+$/.test(page) && Number(page) >= 1) {
    return String(offsetFromPage(Number(page), limit));
  }
  return undefined;
}

function CellValue({ value, amount }: { value: string | null; amount: boolean }) {
  if (value === null) return <span className={styles.missingValue}>Dato non pubblicato</span>;
  if (value === "") return <span className={styles.missingValue}>Dato non presente</span>;
  if (amount) {
    const formatted = formatIntegratedAmountCell(value);
    if (formatted !== null) {
      const trimmed = value.trim();
      return (
        <span className={trimmed === "0" || trimmed === "0.00" ? styles.exactZero : undefined}>
          {formatted}
        </span>
      );
    }
  }
  if (value === "0") return <span className={styles.exactZero}>0</span>;
  return value;
}

function metadataValue(value: string | null): string {
  return value ?? "Non disponibile nel materiale integrato";
}

function metadataDate(value: string | null): ReactNode {
  if (value === null) return "Non disponibile nel materiale integrato";
  return (
    <time dateTime={value}>
      {new Intl.DateTimeFormat("it-IT", { dateStyle: "long", timeZone: "UTC" }).format(
        new Date(`${value}T00:00:00Z`),
      )}
    </time>
  );
}

async function safeResult(
  datasetId: string,
  search: Record<string, SearchValue>,
): Promise<{ result: IntegratedDatasetResult; queryError: string | null }> {
  const limit = requestedLimit(search.limit);
  const offset = requestedOffset(search, limit);
  try {
    return {
      result: await selectIntegratedDataset({
        datasetId,
        q: search.q,
        limit: search.limit,
        offset,
        cursor: search.cursor,
      }),
      queryError: null,
    };
  } catch (error) {
    if (error instanceof IntegratedDatasetNotFoundError) notFound();
    if (error instanceof IntegratedQueryError) {
      const jumpedTooFar = search.pagina !== undefined && search.offset === undefined;
      return {
        result: await selectIntegratedDataset({ datasetId }),
        queryError: jumpedTooFar
          ? "Quella pagina non esiste in questo dataset: sei tornato alla prima."
          : error.message,
      };
    }
    throw error;
  }
}

export async function generateMetadata({ params }: DatasetPageProps): Promise<Metadata> {
  const { dataset: datasetId } = await params;
  const overview = await getIntegratedDataOverview();
  const dataset = overview.datasets.find((entry) => entry.id === datasetId);
  if (!dataset) return { title: "Dataset non trovato" };
  return {
    title: dataset.title,
    description: `${dataset.title}: destinatari, importi e righe del dataset integrato.`,
  };
}

export default async function IntegratedDatasetPage({ params, searchParams }: DatasetPageProps) {
  const [{ dataset: datasetId }, search] = await Promise.all([params, searchParams]);
  const { result, queryError } = await safeResult(datasetId, search);
  const { dataset } = result;
  const related = relatedReadingForDataset(dataset);
  const shouldLoadInsights =
    dataset.queryable &&
    isInsightCapable(dataset.headers, true) &&
    result.query === null;
  const insights = shouldLoadInsights ? await loadDatasetInsights(dataset.id) : null;
  const firstVisible = result.pagination.scanStartSourceRow ?? 0;
  const lastVisible = result.pagination.scanEndSourceRow ?? 0;
  const hasNext = result.pagination.nextCursor !== null;
  const amounts = amountColumnKeys(dataset.headers, result.rows);
  const currentPage = pageFromOffset(result.offset ?? 0, result.limit);
  const pageCount = pageCountFromTotal(dataset.publicRows, result.limit);
  const resultSummary = result.query === null
    ? result.rows.length === 0
      ? "Nessuna riga disponibile."
      : `${integer(firstVisible)}-${integer(lastVisible)} di ${integer(dataset.publicRows)} righe`
    : result.rows.length === 0
      ? result.pagination.exhausted
        ? "Nessuna riga corrisponde alla ricerca nel perimetro esaminato."
        : `Nessuna corrispondenza nelle ${integer(result.pagination.scannedRows)} righe esaminate in questo passaggio.`
      : `${integer(result.rows.length)} corrispondenze in questo passaggio; esaminate le righe ${integer(firstVisible)}-${integer(lastVisible)} di ${integer(dataset.publicRows)}.`;

  return (
    <main className={`shell page ${styles.page}`}>
      <nav className={styles.breadcrumbs} aria-label="Percorso">
        <Link href="/dati">Dati integrati</Link>
        <span aria-hidden="true">/</span>
        <span aria-current="page">{dataset.title}</span>
      </nav>

      <div className="page-intro">
        <p className={styles.eyebrow}>{integratedDomainLabel(dataset.domain)}</p>
        <h1>{dataset.title}</h1>
        <p>
          {dataset.queryable
            ? insights?.capable && insights.topRecipients.length > 0
              ? "Sotto: principali destinatari per importo, eventuali servizi ripetuti, poi ricerca e tabella."
              : "Righe pubbliche interrogabili. Sotto trovi ricerca e tabella."
            : "Qui non ci sono società né importi da scorrere: il materiale è contato nel catalogo senza righe pubbliche."}
        </p>
      </div>

      <section className="stat-strip" aria-label="Perimetro del dataset">
        <div>
          <span className="stat-label">Righe interrogabili</span>
          <span className="stat-value">{integer(dataset.publicRows)}</span>
          <span className="stat-note">{dataset.queryable ? "con ricerca e tabella" : "nessuna riga pubblica"}</span>
        </div>
        <div>
          <span className="stat-label">Righe sorgente</span>
          <span className="stat-value">{integer(dataset.sourceRows)}</span>
          <span className="stat-note">denominatore del dataset</span>
        </div>
        <div>
          <span className="stat-label">Etichetta</span>
          <span className={styles.statText}>
            {EVIDENCE_LABELS[dataset.evidenceLabel] ?? dataset.evidenceLabel}
          </span>
          <span className="stat-note">screening, non giudizio</span>
        </div>
        <div>
          <span className="stat-label">Con fonte puntuale</span>
          <span className="stat-value">{integer(dataset.rowsWithPublicSource)}</span>
          <span className="stat-note">URL HTTP(S) nelle righe</span>
        </div>
      </section>

      {insights?.capable && insights.topRecipients.length > 0 ? (
        <DatasetInsightPanel insights={insights} />
      ) : null}

      {!dataset.queryable ? (
        <section className={`panel ${styles.unavailablePanel}`} aria-labelledby="dataset-no-rows-title">
          <h2 id="dataset-no-rows-title">Niente da scorrere qui</h2>
          <p>
            Documenta {integer(dataset.sourceRows)} righe sorgente e lo stato di pubblicazione, senza
            creare destinatari o importi sostitutivi.
          </p>
          <div>
            {related ? <Link href={related.href}>Vai a {related.label} →</Link> : null}
            <Link href="/dati?vista=priorita">Torna ai numeri da leggere →</Link>
          </div>
        </section>
      ) : (
        <>
          <section className={`panel ${styles.queryPanel}`} aria-labelledby="dataset-search-title">
            <div>
              <h2 id="dataset-search-title" className="panel-title">Cerca nelle celle</h2>
              <p>Maiuscole e minuscole indifferenti. Solo campi pubblici.</p>
            </div>
            <form action={`/dati/${dataset.id}`} method="get" className={styles.searchForm}>
              <label htmlFor="dataset-query">Testo da cercare</label>
              <div>
                <input
                  className="input"
                  id="dataset-query"
                  name="q"
                  defaultValue={result.query ?? ""}
                  maxLength={200}
                  placeholder="Ente, società, CIG o altro valore"
                />
                <input type="hidden" name="limit" value={result.limit} />
                <button className="btn btn-primary" type="submit">Cerca</button>
              </div>
            </form>
          </section>

          {queryError ? <p className={styles.queryError} role="alert">{queryError}</p> : null}

          <section className={`panel ${styles.tablePanel}`} aria-labelledby="dataset-rows-title">
            <div className={styles.tableHeading}>
              <div>
                <h2 id="dataset-rows-title" className="panel-title">Righe pubbliche</h2>
                <p>{resultSummary}</p>
              </div>
              {result.query ? <span className="tag tag-neutral">Filtro: {result.query}</span> : null}
            </div>

            <ul className={styles.valueLegend}>
              <li>
                <strong>0</strong>
                <span>zero pubblicato</span>
              </li>
              <li>
                <strong>Dato non presente</strong>
                <span>cella vuota</span>
              </li>
              <li>
                <strong>Dato non pubblicato</strong>
                <span>valore protetto, non uno zero</span>
              </li>
            </ul>

            {result.rows.length > 0 ? (
              <div className={`table-scroll ${styles.dataTable}`} role="region" aria-label={`Righe di ${dataset.title}`} tabIndex={0}>
                <table className="table">
                  <caption>
                    Valori pubblici esatti
                    {amounts.size > 0 ? ". Importi in euro, allineati a destra." : "."}
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col">Riga</th>
                      {dataset.headers.map((header) => (
                        <th
                          scope="col"
                          key={header}
                          className={amounts.has(header) ? "num" : undefined}
                        >
                          {header}
                        </th>
                      ))}
                      <th scope="col">Fonti</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.rows.map((row) => (
                      <tr key={row.id}>
                        <th scope="row">
                          <code>{row.id}</code>
                          <small>sorgente {integer(row.sourceRow)}</small>
                        </th>
                        {dataset.headers.map((header) => (
                          <td
                            key={header}
                            className={amounts.has(header) ? `num ${styles.amountCell}` : undefined}
                          >
                            <CellValue amount={amounts.has(header)} value={row.cells[header] ?? null} />
                          </td>
                        ))}
                        <td>
                          {row.sourceUrls.length === 0 ? (
                            dataset.sourceMetadata.canonicalUrls.length > 0 ? (
                              <ul className={styles.sourceLinks}>
                                {dataset.sourceMetadata.canonicalUrls.map((url, index) => (
                                  <li key={url}>
                                    <a href={url} target="_blank" rel="noreferrer">
                                      Fonte dataset {index + 1} ↗
                                    </a>
                                  </li>
                                ))}
                              </ul>
                            ) : (
                              <span className={styles.missingValue}>URL non disponibile</span>
                            )
                          ) : (
                            <ul className={styles.sourceLinks}>
                              {row.sourceUrls.map((url, index) => (
                                <li key={url}>
                                  <a href={url} target="_blank" rel="noreferrer">
                                    Fonte {index + 1} ↗
                                  </a>
                                </li>
                              ))}
                            </ul>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}

            {result.query === null ? (
              <Pagination
                label="Pagine del dataset"
                page={currentPage}
                pageCount={pageCount}
                summary={
                  result.rows.length > 0
                    ? `righe ${integer(firstVisible)}-${integer(lastVisible)} di ${integer(dataset.publicRows)}`
                    : undefined
                }
                hrefForPage={(target) =>
                  pageHref(dataset.id, result, { offset: offsetFromPage(target, result.limit) })
                }
                jump={{
                  action: `/dati/${dataset.id}`,
                  pageParam: "pagina",
                  fields: { limit: String(result.limit) },
                }}
              />
            ) : hasNext && result.pagination.nextCursor ? (
              <nav className={styles.searchPagination} aria-label="Continua la ricerca">
                <p>
                  La ricerca avanza per passaggi. Svuota la ricerca per navigare per pagina.
                </p>
                <Link
                  className="btn btn-secondary"
                  rel="next"
                  href={pageHref(dataset.id, result, { cursor: result.pagination.nextCursor })}
                >
                  {result.rows.length === 0 ? "Continua la ricerca →" : "Passaggio successivo →"}
                </Link>
              </nav>
            ) : null}
          </section>
        </>
      )}

      <details className={styles.metaDetails}>
        <summary>Fonte, riuso e limiti</summary>
        <div className={styles.metaDetailsBody}>
          <p>{dataset.reuseNote}</p>
          <dl className={styles.sourceMetadata}>
            <div><dt>Titolare</dt><dd>{dataset.sourceMetadata.holder}</dd></div>
            <div><dt>Periodo del dato</dt><dd>{metadataValue(dataset.sourceMetadata.referencePeriod)}</dd></div>
            <div><dt>Pubblicazione</dt><dd>{metadataDate(dataset.sourceMetadata.publicationDate)}</dd></div>
            <div><dt>Acquisizione</dt><dd>{metadataDate(dataset.sourceMetadata.acquisitionDate)}</dd></div>
            <div><dt>Ultimo controllo</dt><dd>{metadataDate(dataset.sourceMetadata.checkedAt)}</dd></div>
            <div><dt>Frequenza attesa</dt><dd>{metadataValue(dataset.sourceMetadata.updateFrequency)}</dd></div>
            <div>
              <dt>Collegamenti di fonte</dt>
              <dd>
                {dataset.sourceMetadata.canonicalUrls.length > 0 ? (
                  <ul className={styles.sourceLinks}>
                    {dataset.sourceMetadata.canonicalUrls.map((url, index) => (
                      <li key={url}>
                        <a href={url} target="_blank" rel="noreferrer">Portale sorgente {index + 1}</a>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <span className={styles.missingValue}>URL canonico non disponibile</span>
                )}
              </dd>
            </div>
          </dl>
          {dataset.caveats.length > 0 ? (
            <ul className={styles.caveatList}>
              {dataset.caveats.map((caveat) => <li key={caveat}>{caveat}</li>)}
            </ul>
          ) : null}
          {related ? (
            <p className={styles.relatedLink}>
              <Link href={related.href}>{related.label} →</Link>
            </p>
          ) : null}
        </div>
      </details>
    </main>
  );
}
