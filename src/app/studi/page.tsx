import type { Metadata } from "next";
import Link from "next/link";
import { papers } from "@/lib/papers";
import { monthlyReports } from "@/lib/monthly-reports";
import { MONTHLY_REPORT_SERIES, issueMonthLabel } from "@/lib/monthly-reports-contract";
import stateBudgetReport from "@/lib/reports/state-budget-publication";
import { PUBLIC_SITE_URL } from "@/lib/site";
import styles from "./studies.module.css";

const description = "Studi e analisi sui dati pubblici italiani: paper, quaderni e edizioni mensili in un unico archivio.";
const date = new Intl.DateTimeFormat("it-IT", { dateStyle: "long", timeZone: "UTC" });

export const metadata: Metadata = {
  title: "Studi",
  description,
  alternates: { canonical: `${PUBLIC_SITE_URL}/studi` },
  openGraph: { type: "website", title: "Studi", description, url: `${PUBLIC_SITE_URL}/studi`, locale: "it_IT" },
};

export default function StudiesPage() {
  const published = papers.listPublished();
  const monthly = monthlyReports.listPublished();
  return (
    <main className={`shell page ${styles.page}`}>
      <header className={styles.intro}>
        <span className={styles.eyebrow}>Ricerca civica · Pubblicazioni</span>
        <h1>Studi</h1>
        <p>Paper di ricerca, analisi di spesa e edizioni mensili, con fonti e materiali riproducibili.</p>
        <p className={styles.meta}>
          Ogni uscita conserva il proprio periodo di osservazione, le versioni e i limiti dichiarati.
        </p>
      </header>

      <section aria-labelledby="published-studies-title">
        <h2 id="published-studies-title">Paper di ricerca</h2>
        {published.length === 0 ? (
          <p>Non ci sono ancora studi pubblicati.</p>
        ) : (
          published.map((paper) => {
            const pdfHref = paper.pdfUrl.startsWith(`${PUBLIC_SITE_URL}/`)
              ? paper.pdfUrl.slice(PUBLIC_SITE_URL.length)
              : paper.pdfUrl;
            return (
              <article className={styles.card} key={paper.slug} id={paper.slug}>
                <p className={styles.eyebrow}>Paper di ricerca · Versione {paper.version}</p>
                <h3>{paper.webPath ? <Link href={paper.webPath}>{paper.title}</Link> : paper.title}</h3>
                <p className={styles.meta}>
                  {paper.authors.join(", ")} · Pubblicato il{" "}
                  <time dateTime={paper.publishedOn}>
                    {date.format(new Date(`${paper.publishedOn}T00:00:00Z`))}
                  </time>
                </p>
                <p>{paper.abstract}</p>
                <p>
                  <strong>Limiti dello studio.</strong> {paper.limitations}
                </p>
                <div className={styles.actions}>
                  {paper.webPath && (
                    <Link href={paper.webPath} className="btn btn-primary">
                      Leggi lo studio
                    </Link>
                  )}
                  <a href={pdfHref} download>
                    Scarica il PDF · v{paper.version}
                  </a>
                  <a href={paper.reproducibilityUrl}>Dati, codice e versioni</a>
                </div>
                <details>
                  <summary>Verifica del PDF</summary>
                  <p className={styles.hash}>
                    SHA-256: <code>{paper.pdfSha256}</code>
                  </p>
                </details>
              </article>
            );
          })
        )}
      </section>

      <section aria-labelledby="analysis-title">
        <h2 id="analysis-title">Analisi di spesa</h2>
        <article className={styles.card} id={stateBudgetReport.slug}>
          <p className={styles.eyebrow}>Analisi · aggiornamento del {stateBudgetReport.updatedOn}</p>
          <h3>
            <Link href={`/studi/${stateBudgetReport.slug}`}>{stateBudgetReport.title}</Link>
          </h3>
          <p>{stateBudgetReport.summary}</p>
          <div className={styles.actions}>
            <Link href={`/studi/${stateBudgetReport.slug}`} className="btn btn-primary">
              Leggi l&apos;analisi
            </Link>
            <a href={stateBudgetReport.pdfPath} download>
              Scarica il PDF
            </a>
          </div>
        </article>
        <article className={styles.card} id="exit-tax">
          <p className={styles.eyebrow}>Studio · Fisco e residenza</p>
          <h3>
            <Link href="/studi/exit-tax">Exit tax: quanto vale tassare chi porta la residenza all&apos;estero</Link>
          </h3>
          <p>
            Cosa prevede la manovra 2027, chi riguarda, la stima del Governo rifatta passo per passo, scenari dichiarati come
            ipotesi e il confronto con Francia, Germania, Spagna, Stati Uniti e Norvegia.
          </p>
          <div className={styles.actions}>
            <Link href="/studi/exit-tax" className="btn btn-primary">
              Leggi lo studio
            </Link>
          </div>
        </article>
        <article className={styles.card} id="patrimoniale">
          <p className={styles.eyebrow}>Studio · Fisco e ricchezza</p>
          <h3>
            <Link href="/studi/patrimoniale">Patrimoniale: quanto potrebbe rendere e chi la pagherebbe</Link>
          </h3>
          <p>
            Come è distribuita la ricchezza delle famiglie, le imposte sul patrimonio che esistono già, le proposte in Parlamento, scenari
            di gettito dichiarati come ipotesi e il confronto con Svizzera, Norvegia, Spagna e Francia.
          </p>
          <div className={styles.actions}>
            <Link href="/studi/patrimoniale" className="btn btn-primary">
              Leggi lo studio
            </Link>
          </div>
        </article>
      </section>

      <section aria-labelledby="monthly-title">
        <h2 id="monthly-title">{MONTHLY_REPORT_SERIES.title}</h2>
        {monthly.length === 0 ? (
          <p>Non ci sono ancora edizioni mensili pubblicate.</p>
        ) : (
          monthly.map((report) => (
            <article className={styles.card} key={report.issueMonth} id={report.issueMonth}>
              <p className={styles.eyebrow}>
                Edizione mensile · {issueMonthLabel(report.issueMonth)}
              </p>
              <h3>
                <Link href={report.href}>{report.title}</Link>
              </h3>
              <p>{report.teaser}</p>
              <div className={styles.actions}>
                <Link href={report.href} className="btn btn-primary">
                  Leggi l&apos;edizione
                </Link>
              </div>
            </article>
          ))
        )}
      </section>

      <section className={styles.section} aria-labelledby="research-catalogues-title">
        <h2 id="research-catalogues-title">Cataloghi di ricerca</h2>
        <article className={styles.card}>
          <h3>
            <Link href="/studi/rendite-inefficienze">Rendite e inefficienze: casi da verificare</Link>
          </h3>
          <p>
            <strong>Da verificare · Non è uno studio concluso di DVNS.</strong>
          </p>
          <p>
            79 domande di indagine e sette proposte di riforma, con fonti ufficiali di partenza.
            Nessuna stima economica non documentata: temi da approfondire, non risultati accertati.
          </p>
          <Link href="/studi/rendite-inefficienze">Esplora il catalogo e i suoi limiti</Link>
        </article>
      </section>

      <aside className={styles.note}>
        Pubblichiamo studi con una domanda di ricerca, un metodo esplicito, fonti verificabili e
        materiali riproducibili. La pubblicazione sul sito non equivale a peer review esterna: lo
        stato della revisione è dichiarato per ciascun lavoro, insieme ai limiti e alle correzioni.
      </aside>
      <p>
        <Link href="/metodologia">Come leggiamo i dati</Link>
      </p>
    </main>
  );
}
