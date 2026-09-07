import type { Metadata } from "next";
import Link from "next/link";
import { integer, longDate } from "@/lib/format";
import { IntegratedQueryError } from "@/lib/integrated-public-view";
import { getTedNoticePage, TED_DATASET, TED_FORM_LABELS } from "@/lib/ted-notices";
import styles from "./ted.module.css";

export const metadata: Metadata = {
  title: "Avvisi TED con committenti in Italia",
  description: "Avvisi pubblicati nella GUUE ad agosto 2026, con almeno un committente in Italia. Ricerca e link alle pubblicazioni ufficiali TED.",
};

type Search = Record<string, string | string[] | undefined>;

export default async function TedPage({ searchParams }: { searchParams: Promise<Search> }) {
  const search = await searchParams;
  let result;
  let queryError: string | null = null;
  try {
    result = await getTedNoticePage({ q: search.q, cursor: search.cursor });
  } catch (error) {
    if (!(error instanceof IntegratedQueryError)) throw error;
    queryError = error.message;
    result = await getTedNoticePage();
  }
  const next = new URLSearchParams();
  if (result.query) next.set("q", result.query);
  if (result.pagination.nextCursor) next.set("cursor", result.pagination.nextCursor);

  return (
    <main className={`shell page ${styles.page}`}>
      <nav aria-label="Percorso"><Link href="/appalti">Appalti pubblici</Link> / TED</nav>
      <div className="page-intro">
        <p className={styles.eyebrow}>Supplemento alla Gazzetta ufficiale dell’Unione europea</p>
        <h1>Avvisi TED con committenti in Italia</h1>
        <p>Bandi, risultati e altri avvisi pubblicati dal 1 al 31 agosto 2026, con almeno un committente che dichiara il paese Italia.</p>
      </div>
      <div className={`stat-strip ${styles.stats}`} aria-label="Perimetro dello snapshot TED">
        <div>
          <span className="stat-label">Avvisi pubblicati</span>
          <strong className="stat-value">{integer(result.dataset.publicRows)}</strong>
          <span className="stat-note">numeri di pubblicazione unici</span>
        </div>
        <div>
          <span className="stat-label">Periodo di pubblicazione</span>
          <strong className="stat-value">Agosto 2026</strong>
          <span className="stat-note">acquisizione: 6 settembre 2026</span>
        </div>
      </div>
      <aside className="notice" aria-labelledby="ted-scope">
        <h2 id="ted-scope">Che cosa stai leggendo</h2>
        <p>Un avviso può riguardare più lotti, una modifica o un annullamento. Il numero degli avvisi non è il numero dei contratti né una misura di spesa. Le procedure possono comparire anche in ANAC: i due insiemi non si sommano e qui non sono collegati tramite CIG.</p>
        <p>Il paese del committente non indica dove sarà eseguito il contratto. Sono inclusi anche enti UE con sede in Italia e tre avvisi con committenti di più paesi. La raccolta non copre tutti gli appalti italiani.</p>
      </aside>
      <section aria-labelledby="ted-search-title">
        <h2 id="ted-search-title">Cerca negli avvisi di agosto</h2>
        <form action="/appalti/ted" method="get" className={styles.search}>
          <div>
            <label htmlFor="ted-query">Titolo, committente, codice CPV o numero di pubblicazione</label>
            <input className="input" id="ted-query" name="q" type="search" maxLength={200} defaultValue={result.query ?? ""} placeholder="Es. trasporto oppure 533445-2026" />
          </div>
          <button className="btn btn-primary" type="submit">Cerca</button>
          {result.query ? <Link href="/appalti/ted">Tutti gli avvisi</Link> : null}
        </form>
        {queryError ? <p role="alert" className="notice">{queryError} Sono mostrati i primi avvisi.</p> : null}
        <p className={styles.results} role="status">
          {result.notices.length === 0 ? "Nessun avviso corrisponde alla ricerca in questo mese." : `${integer(result.notices.length)} ${result.notices.length === 1 ? "avviso mostrato" : "avvisi mostrati"}${result.matchedRows !== null && result.query ? ` su ${integer(result.matchedRows)} ${result.matchedRows === 1 ? "corrispondenza" : "corrispondenze"}` : ""}.`}
        </p>
        <ol className={styles.notices} aria-label="Avvisi TED">
          {result.notices.map((notice) => (
            <li key={notice.rowId} className={styles.notice}>
              <div className={styles.noticeMeta}>
                <span>{TED_FORM_LABELS[notice.form]}</span>
                <time dateTime={notice.date}>{longDate(notice.date)}</time>
                <span>Avviso {notice.number}</span>
              </div>
              <h3><a href={notice.url} rel="noreferrer" target="_blank">{notice.title}<span className="sr-only">. Apri l’avviso ufficiale TED in una nuova scheda</span></a></h3>
              <p lang={notice.buyerLanguage === "eng" ? "en" : "it"}>{notice.buyers.join(" · ")}</p>
              <p className={styles.codes}>CPV: {notice.cpvs.join(" · ")}</p>
              {notice.countries.length > 1 ? <p>Committenti di più paesi: {notice.countries.join(", ")}. Il perimetro include almeno un committente in Italia.</p> : null}
            </li>
          ))}
        </ol>
        <nav className={styles.pagination} aria-label="Scorrimento degli avvisi">
          {search.cursor ? <Link className="btn btn-secondary" href={result.query ? `/appalti/ted?q=${encodeURIComponent(result.query)}` : "/appalti/ted"}>Primi avvisi</Link> : null}
          {result.pagination.nextCursor ? <Link className="btn btn-secondary" href={`/appalti/ted?${next}`}>Avvisi successivi →</Link> : null}
        </nav>
      </section>
      <section className="panel" aria-labelledby="ted-source-title">
        <h2 id="ted-source-title">Fonte e dati interrogabili</h2>
        <p>Ufficio delle pubblicazioni dell’Unione europea, TED. Ogni riga conserva la data e il link alla pubblicazione. La fonte si aggiorna quotidianamente; questo archivio mensile resta riferito all’acquisizione del 6 settembre 2026.</p>
        <div className={styles.links}>
          <Link href={`/dati/${TED_DATASET}`}>Tabella completa, provenienza e limiti</Link>
          <a href={`/api/dati/${TED_DATASET}?limit=25`}>API degli stessi avvisi</a>
          <Link href="/mcp">Accesso MCP</Link>
          <a href="https://ted.europa.eu/en/legal-notice">Condizioni di riuso TED</a>
        </div>
        <p>© Unione europea. Proiezione DVNS degli avvisi: riuso consentito salvo diversa indicazione; metadati SIMAP CC0 1.0.</p>
      </section>
    </main>
  );
}
