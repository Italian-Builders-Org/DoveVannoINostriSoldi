import type { Metadata } from "next";
import Link from "next/link";
import { integer, longDate, compactEuro } from "@/lib/format";
import { IntegratedQueryError } from "@/lib/integrated-public-view";
import {
  CONSIP_BANDI_ACQUISITION_DATE,
  CONSIP_INSTRUMENTS,
  getConsipBandiPage,
} from "@/lib/consip-bandi-programma";
import styles from "./mepa.module.css";

export const metadata: Metadata = {
  title: "MePA e bandi Consip · metadati open data",
  description:
    "Metadati pubblici di bandi e gare del programma Consip (MePA, SDA, convenzioni): limiti rispetto alla bacheca live e agli ordini conclusi.",
};

type Search = Record<string, string | string[] | undefined>;

function param(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function openLabel(status: "aperto" | "scaduto" | "senza-scadenza"): string {
  if (status === "aperto") return "Con scadenza futura nel CSV";
  if (status === "scaduto") return "Scadenza passata nel CSV";
  return "Senza Data_Termine nel CSV — non etichettato come aperto";
}

export default async function MepaPage({ searchParams }: { searchParams: Promise<Search> }) {
  const search = await searchParams;
  const strumento = param(search.strumento);
  const soloAperti = param(search.aperti) === "1";
  let result;
  let queryError: string | null = null;
  try {
    result = await getConsipBandiPage({ q: search.q, cursor: search.cursor, strumento, soloAperti: soloAperti ? "1" : undefined });
  } catch (error) {
    if (error instanceof IntegratedQueryError) {
      queryError = error.message;
      result = await getConsipBandiPage({ strumento, soloAperti: soloAperti ? "1" : undefined });
    } else if (error instanceof Error && error.message.includes("Filtro strumento")) {
      queryError = error.message;
      result = await getConsipBandiPage({ q: search.q, cursor: search.cursor, soloAperti: soloAperti ? "1" : undefined });
    } else {
      throw error;
    }
  }

  const next = new URLSearchParams();
  if (result.query) next.set("q", result.query);
  if (strumento) next.set("strumento", strumento.toLowerCase());
  if (soloAperti) next.set("aperti", "1");
  if (result.pagination.nextCursor) next.set("cursor", result.pagination.nextCursor);

  const openInPage = result.bandi.filter((row) => row.openStatus === "aperto").length;

  return (
    <main className={`shell page ${styles.page}`}>
      <nav aria-label="Percorso">
        <Link href="/appalti">Appalti pubblici</Link> / MePA e programma Consip
      </nav>
      <div className="page-intro">
        <p className="eyebrow">Open data Consip · non è la bacheca live</p>
        <h1>MePA e bandi del programma Consip</h1>
        <p>
          Metadati del dataset <strong>BANDI E GARE DEL PROGRAMMA</strong> su dati.consip.it.
          Distinto dagli ordini MePA/Convenzioni già conclusi e dalle aggiudicazioni ANAC.
        </p>
      </div>
      <div className={`stat-strip ${styles.stats}`} aria-label="Perimetro Consip bandi 2026">
        <div>
          <span className="stat-label">Lotti nel file 2026</span>
          <strong className="stat-value">{integer(result.dataset.publicRows)}</strong>
          <span className="stat-note">acquisizione {longDate(CONSIP_BANDI_ACQUISITION_DATE)}</span>
        </div>
        <div>
          <span className="stat-label">In pagina</span>
          <strong className="stat-value">{integer(result.bandi.length)}</strong>
          <span className="stat-note">
            {soloAperti ? "solo righe con scadenza futura" : `${integer(openInPage)} con scadenza futura`}
          </span>
        </div>
      </div>
      <aside className="notice" aria-labelledby="mepa-limits">
        <h2 id="mepa-limits">Limiti di lettura</h2>
        <p>
          Il CSV non replica la vetrina operativa di acquistinretepa.it in tempo reale. Mancano prezzi d&apos;ordine,
          carrelli e trattative fuori piattaforma. Una riga <strong>senza Data_Termine</strong> non viene presentata come bando aperto.
        </p>
        <p>
          Gli <Link href="/appalti">ordini storici Consip</Link> misurano acquisti conclusi (MEPA/Convenzioni), non opportunità in corso.
          Per gare sopra soglia UE usa <Link href="/appalti/bandi-aperti">bandi aperti TED</Link>.
        </p>
        <p className={styles.externalLinks}>
          <a href="https://www.acquistinretepa.it/opencms/opencms/vetrina_iniziative.html" rel="noreferrer" target="_blank">
            Vetrina ufficiale MePA
          </a>
          <a href="https://dati.consip.it/dataset/dataset-bandi-e-gare" rel="noreferrer" target="_blank">
            Dataset open data Consip
          </a>
        </p>
      </aside>
      <section aria-labelledby="mepa-filters">
        <h2 id="mepa-filters">Cerca nei metadati</h2>
        <form action="/appalti/mepa" method="get" className={styles.filters}>
          <div className={styles.search}>
            <div>
              <label htmlFor="mepa-query">Bando, lotto, categoria o identificativo</label>
              <input
                className="input"
                id="mepa-query"
                name="q"
                type="search"
                maxLength={200}
                defaultValue={result.query ?? ""}
                placeholder="Es. MePA oppure autobus"
              />
            </div>
            <button className="btn btn-primary" type="submit">Cerca</button>
          </div>
          <div className={styles.filtersRow}>
            <div>
              <label htmlFor="mepa-strumento">Strumento</label>
              <select className="input" id="mepa-strumento" name="strumento" defaultValue={strumento?.toLowerCase() ?? ""}>
                <option value="">Tutti</option>
                {CONSIP_INSTRUMENTS.map((tool) => (
                  <option key={tool} value={tool.toLowerCase().replace(" ", "-")}>{tool}</option>
                ))}
              </select>
            </div>
            <label className="checkbox">
              <input type="checkbox" name="aperti" value="1" defaultChecked={soloAperti} />
              Solo righe con scadenza futura nel CSV
            </label>
            <button className="btn" type="submit">Applica</button>
            {(result.query || strumento || soloAperti) ? <Link href="/appalti/mepa">Azzera filtri</Link> : null}
          </div>
        </form>
        {queryError ? <p role="alert" className="notice">{queryError}</p> : null}
        <p role="status">
          {result.bandi.length === 0
            ? "Nessuna riga corrisponde ai filtri."
            : `${integer(result.bandi.length)} ${result.bandi.length === 1 ? "riga" : "righe"} in pagina.`}
        </p>
        <ol className={styles.list} aria-label="Bandi Consip programma">
          {result.bandi.map((row) => (
            <li key={row.rowId} className={styles.item}>
              <div className={styles.itemMeta}>
                <strong>{row.instrument}</strong>
                <span>{openLabel(row.openStatus)}</span>
                {row.deadline ? (
                  <span>Termine <time dateTime={row.deadline}>{longDate(row.deadline)}</time></span>
                ) : null}
                <span>Pubblicato <time dateTime={row.publicationDate}>{longDate(row.publicationDate)}</time></span>
                {row.syntheticId ? <span>Identificativo sintetico</span> : <span>ID {row.lotId}</span>}
              </div>
              <h3>{row.bandTitle}</h3>
              <p>{row.lotTitle}</p>
              <p>{row.category}</p>
              {row.baseCents !== null ? <p>Base d&apos;asta {compactEuro(row.baseCents / 100)}</p> : null}
              {row.capCents !== null ? <p>Massimale {compactEuro(row.capCents / 100)}</p> : null}
              <p>
                <a href={row.datasetUrl} rel="noreferrer" target="_blank">
                  Scheda dataset Consip
                  <span className="sr-only"> (nuova scheda)</span>
                </a>
              </p>
            </li>
          ))}
        </ol>
        <nav className="pagination" aria-label="Scorrimento bandi Consip">
          {result.pagination.nextCursor ? (
            <Link href={`/appalti/mepa?${next.toString()}`}>Altre righe</Link>
          ) : (
            <span>Fine elenco</span>
          )}
        </nav>
      </section>
    </main>
  );
}
