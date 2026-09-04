import type { Metadata } from "next";
import Link from "next/link";
import { HugeiconsIcon } from "@hugeicons/react";
import { Search01Icon } from "@hugeicons/core-free-icons";
import {
  GLOBAL_SEARCH_DEFAULT_LIMIT,
  GLOBAL_SEARCH_MAX_QUERY_LENGTH,
  GLOBAL_SEARCH_MIN_QUERY_LENGTH,
  searchGlobal,
  searchGlobalLocalFallback,
} from "@/lib/global-search";
import styles from "./cerca.module.css";

export const metadata: Metadata = {
  title: "Cerca nel sito",
  description: "Pagine, dataset, strumenti ed enti del registro IPA in un'unica ricerca.",
  robots: {
    index: false,
    follow: true,
  },
};

type SearchPageProps = {
  searchParams: Promise<{ q?: string | string[] }>;
};

function first(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

export default async function SearchPage({ searchParams }: SearchPageProps) {
  const params = await searchParams;
  const query = first(params.q).trim().slice(0, GLOBAL_SEARCH_MAX_QUERY_LENGTH);
  let result = null;
  if (query.length >= GLOBAL_SEARCH_MIN_QUERY_LENGTH) {
    try {
      result = await searchGlobal({ query, limit: GLOBAL_SEARCH_DEFAULT_LIMIT * 2 });
    } catch {
      result = searchGlobalLocalFallback({ query, limit: GLOBAL_SEARCH_DEFAULT_LIMIT * 2 });
    }
  }

  return (
    <main className="shell page">
      <div className="page-intro">
        <h1>Cerca nel sito</h1>
        <p>
          Cerca tra pagine, sezioni, dataset, strumenti e il registro ufficiale degli enti. Le
          corrispondenze sono ordinate con regole visibili e senza risultati generati.
        </p>
      </div>

      <section className="panel" aria-labelledby="global-search-title">
        <h2 id="global-search-title" className="panel-title">Ricerca globale</h2>
        <form className={styles.searchForm} action="/cerca" method="get">
          <label htmlFor="site-search-query">
            Parole da cercare
            <input
              className="input"
              id="site-search-query"
              name="q"
              type="search"
              defaultValue={query}
              minLength={GLOBAL_SEARCH_MIN_QUERY_LENGTH}
              maxLength={GLOBAL_SEARCH_MAX_QUERY_LENGTH}
              placeholder="es. pagamenti comuni, PNRR o Ministero dell'Interno"
              autoComplete="off"
            />
          </label>
          <button className="btn btn-primary" type="submit">
            <HugeiconsIcon icon={Search01Icon} size={16} strokeWidth={1.7} aria-hidden="true" />
            Cerca
          </button>
        </form>
      </section>

      {query.length > 0 && query.length < GLOBAL_SEARCH_MIN_QUERY_LENGTH ? (
        <div className="notice warning-notice">
          <strong>Scrivi almeno due caratteri</strong>
          <p>Così la ricerca resta utile e non sovraccarica il registro pubblico.</p>
        </div>
      ) : null}

      {result ? (
        <section aria-labelledby="global-search-results-title">
          <p id="global-search-results-title" className={styles.resultSummary} aria-live="polite">
            {result.total > 0
              ? `${result.total} risultat${result.total === 1 ? "o" : "i"} per “${result.query}”.`
              : `Nessun risultato per “${result.query}”.`}
            {!result.entitiesAvailable ? " Il registro IPA non è raggiungibile in questo momento." : ""}
          </p>

          {result.groups.length > 0 ? (
            <div className={styles.resultGroups}>
              {result.groups.map((group) => (
                <section className={styles.resultGroup} key={group.type} aria-labelledby={`search-group-${group.type}`}>
                  <h2 id={`search-group-${group.type}`}>{group.label}</h2>
                  <ul className={styles.resultList}>
                    {group.results.map((entry) => (
                      <li className={styles.resultItem} key={entry.id}>
                        <div>
                          <Link href={entry.href}>{entry.title}</Link>
                          <span className={styles.resultContext}>{entry.context}</span>
                        </div>
                        <span className={styles.resultReason}>{entry.match.label}</span>
                        {entry.description ? (
                          <span className={styles.resultDescription}>{entry.description}</span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          ) : (
            <div className="notice">
              <strong>Nessuna corrispondenza</strong>
              <p>Prova con una parola più breve, un sinonimo oppure il nome dell&apos;ente.</p>
            </div>
          )}

          {result.hasMore ? (
            <p className={styles.noticeLink}>
              Mostro i risultati più pertinenti. Prova ad aggiungere una parola per restringere la
              ricerca.
            </p>
          ) : null}
        </section>
      ) : null}
    </main>
  );
}
