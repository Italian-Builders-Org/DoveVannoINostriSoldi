import type { Metadata } from "next";
import Link from "next/link";
import Pagination from "@/components/pagination";
import { integer } from "@/lib/format";
import {
  getIntegratedSourceCoverage,
  INTEGRATED_DEFAULT_LIMIT,
  IntegratedQueryError,
  selectPublicSourceCatalog,
  type PublicSourceResult,
} from "@/lib/integrated-public-view";
import { offsetFromPage, pageCountFromTotal, pageFromOffset } from "@/lib/pagination";
import styles from "./catalogo.module.css";

export const metadata: Metadata = {
  title: "Catalogo completo delle fonti",
  description: "Tutte le identità di fonte catalogate, comprese quelle in quarantena senza valore.",
};

type SearchValue = string | string[] | undefined;
type SourceCatalogPageProps = {
  searchParams: Promise<Record<string, SearchValue>>;
};

const CLASSIFICATION_LABELS: Record<string, string> = {
  commercial: "Sito commerciale",
  local: "Riferimento locale",
  news: "Notizia",
  official_index: "Indice ufficiale",
  official_primary: "Fonte ufficiale primaria",
  official_secondary: "Fonte ufficiale secondaria",
  unknown: "Classificazione non determinata",
  unresolved: "Identità non risolta",
};

function pageHref(result: PublicSourceResult, offset: number): string {
  const query = new URLSearchParams();
  if (result.query) query.set("q", result.query);
  if (result.disposition) query.set("disposition", result.disposition);
  query.set("limit", String(result.limit));
  if (offset > 0) query.set("offset", String(offset));
  return `/fonti/catalogo?${query.toString()}`;
}

/**
 * `pagina` is the readable form of `offset` and only fills in when no explicit
 * offset is given; the selector still validates whatever comes out of it.
 */
function requestedOffset(search: Record<string, SearchValue>): SearchValue {
  if (search.offset !== undefined && search.offset !== "") return search.offset;
  const page = search.pagina;
  if (typeof page === "string" && /^\d+$/.test(page) && Number(page) >= 1) {
    const limit =
      typeof search.limit === "string" && /^\d+$/.test(search.limit) && Number(search.limit) >= 1
        ? Number(search.limit)
        : INTEGRATED_DEFAULT_LIMIT;
    return String(offsetFromPage(Number(page), limit));
  }
  return undefined;
}

async function safeResult(search: Record<string, SearchValue>) {
  try {
    return {
      result: await selectPublicSourceCatalog({
        q: search.q,
        disposition: search.disposition,
        limit: search.limit,
        offset: requestedOffset(search),
      }),
      queryError: null,
    };
  } catch (error) {
    if (error instanceof IntegratedQueryError) {
      return { result: await selectPublicSourceCatalog(), queryError: error.message };
    }
    throw error;
  }
}

export default async function PublicSourceCatalogPage({ searchParams }: SourceCatalogPageProps) {
  const search = await searchParams;
  const [{ result, queryError }, coverage] = await Promise.all([
    safeResult(search),
    getIntegratedSourceCoverage(),
  ]);
  const firstVisible = result.sources.length === 0 ? 0 : result.offset + 1;
  const lastVisible = result.offset + result.sources.length;

  return (
    <main className={`shell page ${styles.page}`}>
      <nav className={styles.breadcrumbs} aria-label="Percorso">
        <Link href="/fonti">Fonti</Link>
        <span aria-hidden="true">/</span>
        <span aria-current="page">Catalogo completo</span>
      </nav>

      <div className="page-intro">
        <p className={styles.eyebrow}>
          {integer(coverage.sources.observedIdentities)} identità contabilizzate
        </p>
        <h1>Catalogo completo delle fonti integrate</h1>
        <p>
          Ogni identità è traversabile con un ID opaco. Le fonti pubbliche mantengono il loro
          collegamento; le identità in quarantena restano contate e visibili nello stato, ma il loro
          valore non viene esposto.
        </p>
      </div>

      <section className="stat-strip" aria-label="Stati del catalogo delle fonti">
        <div>
          <span className="stat-label">Totale identità</span>
          <span className="stat-value">{integer(coverage.sources.observedIdentities)}</span>
          <span className="stat-note">su {integer(coverage.sources.expectedIdentities)} attese</span>
        </div>
        <div>
          <span className="stat-label">Valore pubblico</span>
          <span className="stat-value">{integer(coverage.sources.published)}</span>
          <span className="stat-note">URL HTTP(S) validati</span>
        </div>
        <div>
          <span className="stat-label">In quarantena</span>
          <span className="stat-value">{integer(coverage.sources.quarantined)}</span>
          <span className="stat-note">registrate senza valore pubblico</span>
        </div>
        <div>
          <span className="stat-label">Occorrenze</span>
          <span className="stat-value">{integer(coverage.sources.totalOccurrences)}</span>
          <span className="stat-note">ripetizioni conservate nel conteggio</span>
        </div>
      </section>

      <div className="notice">
        <strong>Quarantena non significa omissione</strong>
        <p>
          ID, occorrenze, classificazione e motivo restano nel catalogo. Nascondiamo solo il valore
          che non può essere pubblicato.
        </p>
      </div>

      <section className={`panel ${styles.filterPanel}`} aria-labelledby="source-filter-title">
        <div>
          <h2 id="source-filter-title" className="panel-title">Filtra il catalogo</h2>
          <p>Cerca solo nei valori pubblici e nei metadati visibili.</p>
        </div>
        <form action="/fonti/catalogo" method="get" className={styles.filterForm}>
          <div>
            <label htmlFor="source-query">Testo</label>
            <input
              className="input"
              id="source-query"
              name="q"
              defaultValue={result.query ?? ""}
              maxLength={200}
              placeholder="URL, ID o classificazione"
            />
          </div>
          <div>
            <label htmlFor="source-disposition">Stato</label>
            <select
              className="input"
              id="source-disposition"
              name="disposition"
              defaultValue={result.disposition ?? ""}
            >
              <option value="">Tutti gli stati</option>
              <option value="published">Valore pubblico</option>
              <option value="quarantined">In quarantena</option>
            </select>
          </div>
          <input type="hidden" name="limit" value={result.limit} />
          <button className="btn btn-primary" type="submit">Applica</button>
        </form>
      </section>

      {queryError ? <p className={styles.queryError} role="alert">{queryError}</p> : null}

      <section className={`panel ${styles.tablePanel}`} aria-labelledby="source-table-title">
        <div className={styles.tableHeading}>
          <div>
            <h2 id="source-table-title" className="panel-title">Identità di fonte</h2>
            <p>
              {result.matchedSources === 0
                ? "Nessuna identità corrisponde ai filtri."
                : `${integer(firstVisible)}-${integer(lastVisible)} di ${integer(result.matchedSources)} identità`}
            </p>
          </div>
          {result.query ? <span className="tag tag-neutral">Filtro: {result.query}</span> : null}
        </div>

        {result.sources.length > 0 ? (
          <div className={`table-scroll ${styles.sourceTable}`} role="region" aria-label="Catalogo delle identità di fonte" tabIndex={0}>
            <table className="table">
              <caption>Identità pubbliche e in quarantena, ordinate per ID opaco</caption>
              <thead>
                <tr>
                  <th scope="col">ID</th>
                  <th scope="col">Stato</th>
                  <th scope="col">Classificazione</th>
                  <th scope="col">Valore pubblico</th>
                  <th scope="col" className="num">Occorrenze</th>
                  <th scope="col">Ragioni</th>
                </tr>
              </thead>
              <tbody>
                {result.sources.map((source) => (
                  <tr key={source.id}>
                    <th scope="row"><code>{source.id}</code></th>
                    <td>
                      <span className={`tag ${source.disposition === "published" ? "tag-accent" : "tag-neutral"}`}>
                        {source.disposition === "published" ? "Valore pubblico" : "In quarantena"}
                      </span>
                    </td>
                    <td>{CLASSIFICATION_LABELS[source.classification] ?? source.classification}</td>
                    <td className={styles.valueCell}>
                      {source.publicValue === null ? (
                        <span className={styles.withheld}>Valore non pubblicato</span>
                      ) : (
                        <a href={source.publicValue} target="_blank" rel="noreferrer">
                          {source.publicValue} ↗
                        </a>
                      )}
                    </td>
                    <td className="num">{integer(source.occurrences)}</td>
                    <td>
                      {source.reasonCodes.length === 0
                        ? <span className={styles.withheld}>Nessuna</span>
                        : source.reasonCodes.join(", ")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}

        <Pagination
          label="Pagine del catalogo fonti"
          page={pageFromOffset(result.offset, result.limit)}
          pageCount={pageCountFromTotal(result.matchedSources, result.limit)}
          summary={
            result.sources.length > 0
              ? `identità ${integer(firstVisible)}-${integer(lastVisible)} di ${integer(result.matchedSources)}`
              : undefined
          }
          hrefForPage={(target) => pageHref(result, offsetFromPage(target, result.limit))}
          jump={{
            action: "/fonti/catalogo",
            pageParam: "pagina",
            fields: {
              limit: String(result.limit),
              ...(result.query ? { q: result.query } : {}),
              ...(result.disposition ? { disposition: result.disposition } : {}),
            },
          }}
        />
      </section>

      <section className={`panel ${styles.finalLinks}`}>
        <Link href="/fonti/copertura">Come si chiudono i conteggi →</Link>
        <Link href="/dati">Dataset collegati →</Link>
      </section>
    </main>
  );
}
