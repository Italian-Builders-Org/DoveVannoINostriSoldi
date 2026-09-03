import type { Metadata } from "next";
import Link from "next/link";
import {
  BUDGET_DOCUMENT_CALENDAR_OBSERVED_AT,
  BUDGET_DOCUMENT_CALENDAR_YEAR,
  budgetDocumentCalendar,
  type BudgetDocument,
} from "@/lib/budget-document-calendar";
import { longDate } from "@/lib/format";
import styles from "./calendario.module.css";

export const metadata: Metadata = {
  title: "Calendario dei documenti di finanza pubblica",
  description:
    "Date, finestre attese e link ufficiali dei principali documenti del ciclo di bilancio italiano.",
};

const publishedDocuments = budgetDocumentCalendar.filter((document) => document.status === "published");
const expectedDocuments = budgetDocumentCalendar.filter((document) => document.status === "expected");

function statusLabel(document: BudgetDocument): string {
  return document.status === "published" ? "Pubblicato" : "Atteso";
}

function dateLabel(document: BudgetDocument): string {
  return document.publishedOn ? longDate(document.publishedOn) : document.expectedWindow;
}

export default function BudgetDocumentCalendarPage() {
  return (
    <main className={`shell ${styles.page}`}>
      <nav className={styles.breadcrumb} aria-label="Percorso">
        <Link href="/">Home</Link>
        <span aria-hidden="true">→</span>
        <Link href="/fonti">Fonti</Link>
        <span aria-hidden="true">→</span>
        <span>Calendario</span>
      </nav>

      <header className={styles.header}>
        <div>
          <span className={styles.kicker}>CICLO DI BILANCIO {BUDGET_DOCUMENT_CALENDAR_YEAR}</span>
          <h1 className={styles.title}>Quando escono i documenti che guidano i conti pubblici.</h1>
          <p className={styles.lead}>
            Seguiamo pubblicazioni MEF, UPB, Corte dei conti, Banca d’Italia, ISTAT e INPS.
            Le date già note restano distinte dalle finestre attese: “atteso” non significa in ritardo.
          </p>
        </div>

        <dl className={styles.summary} aria-label="Riepilogo del calendario">
          <div>
            <dt>Documenti seguiti</dt>
            <dd>{budgetDocumentCalendar.length}</dd>
          </div>
          <div>
            <dt>Pubblicati</dt>
            <dd>{publishedDocuments.length}</dd>
          </div>
          <div>
            <dt>Attesi</dt>
            <dd>{expectedDocuments.length}</dd>
          </div>
          <div>
            <dt>Link controllati</dt>
            <dd>{longDate(BUDGET_DOCUMENT_CALENDAR_OBSERVED_AT)}</dd>
          </div>
        </dl>
      </header>

      <section className={styles.explainer} aria-labelledby="come-leggere-il-calendario">
        <div>
          <h2 id="come-leggere-il-calendario">Una data non è un dato economico.</h2>
          <p>
            Il calendario registra che un documento è disponibile e collega la pagina ufficiale.
            Non estrae automaticamente importi, previsioni o giudizi dai PDF.
          </p>
        </div>
        <div>
          <h2>Il nome dei documenti può cambiare.</h2>
          <p>
            Il DFP ha sostituito il DEF e il DPFP ha sostituito e potenziato la NADEF nel nuovo
            quadro europeo. Usiamo il nome corrente e ricordiamo il precedente per orientarsi.
          </p>
        </div>
      </section>

      <section className={styles.calendar} aria-labelledby="documenti-2026">
        <div className={styles.sectionHeading}>
          <div>
            <span className={styles.kicker}>DA GENNAIO A DICEMBRE</span>
            <h2 id="documenti-2026">Documenti del {BUDGET_DOCUMENT_CALENDAR_YEAR}</h2>
          </div>
          <p>In ordine di uscita abituale, non di importanza.</p>
        </div>

        <ol className={styles.timeline}>
          {budgetDocumentCalendar.map((document) => (
            <li className={styles.entry} key={document.id}>
              <div className={styles.date}>
                <span>
                  {document.status === "published" ? document.expectedWindow : "Finestra attesa"}
                </span>
                <strong>{dateLabel(document)}</strong>
              </div>

              <div className={styles.document}>
                <div className={styles.documentHeading}>
                  <h3>{document.title}</h3>
                  <span className={`${styles.status} ${styles[document.status]}`}>
                    {statusLabel(document)}
                  </span>
                </div>
                <p>{document.description}</p>
                <dl className={styles.meta}>
                  <div>
                    <dt>Pubblica</dt>
                    <dd>{document.owner}</dd>
                  </div>
                  <div>
                    <dt>Periodo di riferimento</dt>
                    <dd>{document.referencePeriod}</dd>
                  </div>
                </dl>
              </div>

              <div className={styles.action}>
                <a
                  href={document.sourceUrl}
                  target="_blank"
                  rel="noreferrer"
                  aria-label={`${document.title}: apri la fonte ufficiale in una nuova scheda`}
                >
                  {document.status === "published" ? "Apri il documento" : "Controlla la fonte"} ↗
                </a>
                <small>verificato il {longDate(document.observedAt)}</small>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <aside className={styles.boundary} aria-labelledby="limite-calendario">
        <strong id="limite-calendario">Che cosa non dice questo calendario</strong>
        <p>
          “Pubblicato” indica la disponibilità del documento ufficiale, non che i suoi contenuti siano
          già entrati nei dataset del sito. “Atteso” indica una finestra abituale, non una scadenza
          legale né un ritardo accertato.
        </p>
        <p>
          <Link href="/fonti/stato">Controlla lo stato delle fonti dati →</Link>
        </p>
      </aside>
    </main>
  );
}
