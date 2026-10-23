import type { Metadata } from "next";
import Link from "next/link";
import { integer, longDate, compactEuro } from "@/lib/format";
import { IntegratedQueryError } from "@/lib/integrated-public-view";
import { getTedOpenNoticePage, TED_OPEN_ACQUISITION_DATE, TED_OPEN_FORM_LABELS, TED_OPEN_NATURES } from "@/lib/ted-open-notices";
import styles from "./bandi-aperti.module.css";

export const metadata: Metadata = {
  title: "Bandi aperti · appalti pubblici",
  description:
    "Avvisi TED con scadenza futura e committente in Italia: lavori, servizi e forniture, con link alla fonte ufficiale e limiti espliciti.",
};

type Search = Record<string, string | string[] | undefined>;

function param(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function amountLabel(cents: number | null): string {
  if (cents === null) return "Importo stimato non pubblicato in euro";
  return `Importo stimato ${compactEuro(cents / 100)}`;
}

export default async function BandiApertiPage({ searchParams }: { searchParams: Promise<Search> }) {
  const search = await searchParams;
  const tipo = param(search.tipo);
  const includeExpired = param(search.scaduti) === "1";
  let result;
  let queryError: string | null = null;
  try {
    result = await getTedOpenNoticePage({ q: search.q, cursor: search.cursor, tipo, includeExpired: includeExpired ? "1" : undefined });
  } catch (error) {
    if (error instanceof IntegratedQueryError) {
      queryError = error.message;
      result = await getTedOpenNoticePage({ tipo, includeExpired: includeExpired ? "1" : undefined });
    } else if (error instanceof Error && error.message.includes("Filtro tipo")) {
      queryError = error.message;
      result = await getTedOpenNoticePage({ q: search.q, cursor: search.cursor, includeExpired: includeExpired ? "1" : undefined });
    } else {
      throw error;
    }
  }

  const next = new URLSearchParams();
  if (result.query) next.set("q", result.query);
  if (tipo) next.set("tipo", tipo.toLowerCase());
  if (includeExpired) next.set("scaduti", "1");
  if (result.pagination.nextCursor) next.set("cursor", result.pagination.nextCursor);

  const openCount = result.notices.filter((notice) => notice.stillOpen).length;

  return (
    <main className={`shell page ${styles.page}`}>
      <nav aria-label="Percorso">
        <Link href="/appalti">Appalti pubblici</Link> / Bandi aperti
      </nav>
      <div className="page-intro">
        <p className="eyebrow">Avvisi ancora in presentazione · fonte TED</p>
        <h1>Bandi aperti con committente in Italia</h1>
        <p>
          Gare e consultazioni pubblicate sul Supplemento alla GUUE con scadenza delle offerte dichiarata da TED.
          Non sono aggiudicazioni ANAC né ordini MePA già conclusi.
        </p>
      </div>
      <div className={`stat-strip ${styles.stats}`} aria-label="Perimetro snapshot TED aperti">
        <div>
          <span className="stat-label">Avvisi nello snapshot</span>
          <strong className="stat-value">{integer(result.dataset.publicRows)}</strong>
          <span className="stat-note">acquisizione {longDate(TED_OPEN_ACQUISITION_DATE)}</span>
        </div>
        <div>
          <span className="stat-label">Mostrati in pagina</span>
          <strong className="stat-value">{integer(result.notices.length)}</strong>
          <span className="stat-note">
            {includeExpired ? "inclusi avvisi con scadenza già passata" : `${integer(openCount)} con scadenza oggi o futura`}
          </span>
        </div>
      </div>
      <aside className="notice" aria-labelledby="bandi-aperti-scope">
        <h2 id="bandi-aperti-scope">Che cosa stai leggendo</h2>
        <p>
          Entra solo un avviso con <strong>scadenza presentazione offerte</strong> pubblicata da TED e non precedente al{" "}
          {longDate(TED_OPEN_ACQUISITION_DATE)}. Senza scadenza non compare qui. La scadenza mostrata è la più tardiva tra i lotti dell&apos;avviso.
        </p>
        <p>
          Copre soprattutto procedure sopra soglia europea. Gli appalti sotto soglia e le iniziative MePA/Consip hanno percorso dedicato:{" "}
          <Link href="/appalti/mepa">vetrina MePA e programma Consip</Link>. Non sommare i numeri con ANAC o con gli ordini storici Consip.
        </p>
      </aside>
      <section aria-labelledby="bandi-aperti-filters">
        <h2 id="bandi-aperti-filters">Filtra</h2>
        <form action="/appalti/bandi-aperti" method="get" className={styles.filters}>
          <div className={styles.search}>
            <div>
              <label htmlFor="bandi-query">Oggetto, committente, CPV o numero avviso</label>
              <input
                className="input"
                id="bandi-query"
                name="q"
                type="search"
                maxLength={200}
                defaultValue={result.query ?? ""}
                placeholder="Es. manutenzione oppure 674254-2026"
              />
            </div>
            <button className="btn btn-primary" type="submit">Cerca</button>
          </div>
          <div className={styles.filtersRow}>
            <div>
              <label htmlFor="bandi-tipo">Natura</label>
              <select className="input" id="bandi-tipo" name="tipo" defaultValue={tipo?.toLowerCase() ?? ""}>
                <option value="">Tutte</option>
                {TED_OPEN_NATURES.map((nature) => (
                  <option key={nature} value={nature.toLowerCase()}>{nature}</option>
                ))}
              </select>
            </div>
            <label className="checkbox">
              <input type="checkbox" name="scaduti" value="1" defaultChecked={includeExpired} />
              Mostra anche scadenze già passate
            </label>
            <button className="btn" type="submit">Applica</button>
            {(result.query || tipo || includeExpired) ? <Link href="/appalti/bandi-aperti">Azzera filtri</Link> : null}
          </div>
        </form>
        {queryError ? <p role="alert" className="notice">{queryError}</p> : null}
        <p className={styles.results} role="status">
          {result.notices.length === 0
            ? "Nessun avviso corrisponde ai filtri."
            : `${integer(result.notices.length)} ${result.notices.length === 1 ? "avviso" : "avvisi"} in questa pagina${result.matchedRows !== null && result.query ? ` · ${integer(result.matchedRows)} corrispondenze nel dataset` : ""}.`}
        </p>
        <ol className={styles.notices} aria-label="Bandi TED aperti">
          {result.notices.map((notice) => (
            <li key={notice.rowId} className={styles.notice}>
              <div className={styles.noticeMeta}>
                <strong>{notice.nature}</strong>
                <span>{TED_OPEN_FORM_LABELS[notice.form]}</span>
                <span>Scadenza <time dateTime={notice.deadline}>{longDate(notice.deadline)}</time></span>
                <span className={notice.stillOpen ? styles.badgeOpen : styles.badgeClosed}>
                  {notice.stillOpen ? "Scadenza futura" : "Scadenza passata"}
                </span>
                <span>Pubblicato <time dateTime={notice.publicationDate}>{longDate(notice.publicationDate)}</time></span>
              </div>
              <h3>
                <Link href={`/appalti/bandi-aperti/${encodeURIComponent(notice.number)}`}>{notice.title}</Link>
              </h3>
              <p lang={notice.buyerLanguage === "eng" ? "en" : "it"}>{notice.buyers.join(" · ")}</p>
              <p className={styles.codes}>CPV: {notice.cpvs.join(" · ")}</p>
              <p>{amountLabel(notice.amountCents)}</p>
              {notice.cities.length > 0 ? <p>Luoghi citati nell&apos;avviso: {notice.cities.join(" · ")}</p> : null}
              <p className={styles.detailLink}>
                <a href={notice.url} rel="noreferrer" target="_blank">
                  Apri l&apos;avviso ufficiale TED
                  <span className="sr-only"> (nuova scheda)</span>
                </a>
                {" · "}
                <Link href={`/appalti/bandi-aperti/${encodeURIComponent(notice.number)}`}>Scheda sintetica</Link>
              </p>
            </li>
          ))}
        </ol>
        <nav className="pagination" aria-label="Scorrimento bandi aperti">
          {result.pagination.nextCursor ? (
            <Link href={`/appalti/bandi-aperti?${next.toString()}`}>Altri avvisi</Link>
          ) : (
            <span>Fine elenco</span>
          )}
        </nav>
      </section>
      <p>
        <Link href="/appalti/ted">Archivio TED agosto 2026</Link> · storico pubblicazioni, non filtrato per scadenza.
      </p>
    </main>
  );
}
