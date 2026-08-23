import type { Metadata } from "next";
import Link from "next/link";
import { exactEuro, integer, longDate, percent } from "@/lib/format";
import { indirePnrrAssignmentsSnapshot } from "@/lib/indire-pnrr-assignments-snapshot";
import styles from "./incarichi-pnrr.module.css";

export const metadata: Metadata = {
  title: "Incarichi esterni PNRR INDIRE",
  description:
    "88 incarichi esterni PNRR pubblicati da INDIRE, con programmi, compensi contrattuali, selezioni e atti di conferimento.",
};

const data = indirePnrrAssignmentsSnapshot;
const assignments = [...data.assignments].sort((left, right) =>
  `${left.lastName} ${left.firstName}`.localeCompare(`${right.lastName} ${right.firstName}`, "it"),
);
const mostCommonTier = [...data.tiers].sort((left, right) => right.assignments - left.assignments)[0];

function euroFromCents(valueCents: number): string {
  return exactEuro(valueCents / 100);
}

function share(part: number, total: number): string {
  return percent((part / total) * 100);
}

function shortProgram(id: (typeof data.programs)[number]["id"]): string {
  return id === "m4c1-i3-1" ? "Investimento 3.1" : "Riforma 2.1";
}

export default function PnrrAssignmentsPage() {
  return (
    <main className={`shell page ${styles.page}`}>
      <nav className={styles.breadcrumb} aria-label="Percorso">
        <Link href="/">Home</Link>
        <span aria-hidden="true">/</span>
        <Link href="/coesione/asili">Traccia PNRR</Link>
        <span aria-hidden="true">/</span>
        <span aria-current="page">Incarichi INDIRE</span>
      </nav>

      <header className={styles.intro}>
        <div className="page-intro">
          <h1>88 incarichi PNRR, 5,98 milioni di compensi contrattuali</h1>
          <p>
            Chi ha ricevuto l&apos;incarico, per quale programma, per quanto tempo e con quale
            compenso dichiarato. I numeri provengono dall&apos;elenco ufficiale INDIRE di aprile 2026.
          </p>
        </div>
        <p className={styles.scopeLine}>
          <strong>Aggiornamento: aprile 2026</strong>
          <span>·</span>
          <span>88 persone</span>
          <span>·</span>
          <span>importi per l&apos;intera durata contrattuale</span>
        </p>
      </header>

      <section className="stat-strip" aria-label="Numeri principali degli incarichi PNRR INDIRE">
        <div>
          <span className="stat-label">Incarichi PNRR</span>
          <span className="stat-value">{integer(data.coverage.pnrrAssignments)}</span>
          <span className="stat-note">su {integer(data.coverage.workbookAssignments)} incarichi nel foglio</span>
        </div>
        <div>
          <span className="stat-label">Compensi contrattuali</span>
          <span className="stat-value">5,98 mln €</span>
          <span className="stat-note">{euroFromCents(data.totals.contractCompensationCents)} esatti</span>
        </div>
        <div>
          <span className="stat-label">Programmi PNRR</span>
          <span className="stat-value">{integer(data.programs.length)}</span>
          <span className="stat-note">tenuti separati nel confronto</span>
        </div>
        <div>
          <span className="stat-label">Compensi noti</span>
          <span className="stat-value">100%</span>
          <span className="stat-note">88 su 88 incarichi PNRR</span>
        </div>
      </section>

      <section className={`panel ${styles.programPanel}`} aria-labelledby="programs-title">
        <div className={styles.sectionHeading}>
          <div>
            <h2 id="programs-title" className="panel-title">Per che cosa sono stati assegnati</h2>
            <p>Due programmi diversi, senza sommare attività e finalità sotto un&apos;unica etichetta.</p>
          </div>
          <span className="tag tag-neutral">Denominatore: 88 incarichi</span>
        </div>

        <div className={styles.programGrid}>
          {data.programs.map((program) => (
            <article key={program.id} className={styles.programCard}>
              <span>{shortProgram(program.id)}</span>
              <strong>{integer(program.assignments)} incarichi</strong>
              <p>{program.label}</p>
              <dl>
                <div>
                  <dt>Quota incarichi</dt>
                  <dd>{share(program.assignments, data.coverage.pnrrAssignments)}</dd>
                </div>
                <div>
                  <dt>Compensi contrattuali</dt>
                  <dd>{euroFromCents(program.compensationCents)}</dd>
                </div>
              </dl>
            </article>
          ))}
        </div>
      </section>

      <section className={`panel ${styles.tierPanel}`} aria-labelledby="tiers-title">
        <div className={styles.sectionHeading}>
          <div>
            <h2 id="tiers-title" className="panel-title">Quanto sono concentrati gli importi</h2>
            <p>
              {integer(mostCommonTier.assignments)} incarichi su 88, pari al {share(mostCommonTier.assignments, 88)},
              hanno lo stesso compenso contrattuale di {euroFromCents(mostCommonTier.compensationCents)}.
              È una concentrazione da leggere insieme a selezione, durata e programma, non una prova di irregolarità.
            </p>
          </div>
          <div className={styles.featuredMetric}>
            <strong>{share(mostCommonTier.assignments, 88)}</strong>
            <span>{integer(mostCommonTier.assignments)} su 88 incarichi</span>
          </div>
        </div>

        <div className={styles.tableRegion} role="region" aria-label="Distribuzione esatta dei compensi" tabIndex={0}>
          <p className={styles.tableHint}>Scorri la tabella verso destra →</p>
          <table className="table">
            <caption>Fasce di compenso per l&apos;intera durata contrattuale</caption>
            <thead>
              <tr>
                <th scope="col">Compenso per incarico</th>
                <th scope="col" className="num">Incarichi</th>
                <th scope="col" className="num">Quota</th>
                <th scope="col" className="num">Totale fascia</th>
              </tr>
            </thead>
            <tbody>
              {data.tiers.map((tier) => (
                <tr key={tier.compensationCents}>
                  <th scope="row">{euroFromCents(tier.compensationCents)}</th>
                  <td className="num">{integer(tier.assignments)}</td>
                  <td className="num">{share(tier.assignments, 88)}</td>
                  <td className="num">{euroFromCents(tier.totalCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className={`panel ${styles.assignmentsPanel}`} aria-labelledby="assignments-title">
        <div className={styles.sectionHeading}>
          <div>
            <h2 id="assignments-title" className="panel-title">Chi, quanto e con quale atto</h2>
            <p>
              L&apos;elenco completo conserva persona, programma, periodo, sede quando pubblicata,
              selezione e decreto di conferimento.
            </p>
          </div>
          <span className="tag tag-neutral">88 righe ufficiali</span>
        </div>

        <details className={styles.assignmentDetails}>
          <summary>Apri l&apos;elenco completo degli incarichi</summary>
          <div className={styles.tableRegion} role="region" aria-label="Elenco completo degli incarichi PNRR INDIRE" tabIndex={0}>
            <p className={styles.tableHint}>Scorri la tabella verso destra →</p>
            <table className="table">
              <caption>Incarichi PNRR presenti nell&apos;aggiornamento INDIRE di aprile 2026</caption>
              <thead>
                <tr>
                  <th scope="col">Persona</th>
                  <th scope="col">Programma</th>
                  <th scope="col">Periodo</th>
                  <th scope="col">Sede</th>
                  <th scope="col" className="num">Compenso contrattuale</th>
                  <th scope="col">Selezione</th>
                  <th scope="col">Decreto</th>
                </tr>
              </thead>
              <tbody>
                {assignments.map((assignment) => (
                  <tr key={assignment.id}>
                    <th scope="row">{assignment.firstName} {assignment.lastName}</th>
                    <td>{shortProgram(assignment.programId)}</td>
                    <td>dal {longDate(assignment.startDate)} al {longDate(assignment.endDate)}</td>
                    <td>{assignment.location ?? "Non indicata"}</td>
                    <td className="num">{euroFromCents(assignment.compensation.valueCents)}</td>
                    <td>{assignment.selection}</td>
                    <td>{assignment.decree}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      </section>

      <section className={`notice scope-notice ${styles.readingNotice}`} aria-labelledby="reading-title">
        <h2 id="reading-title">Come leggere questi numeri</h2>
        <p>
          Il totale somma compensi dichiarati per l&apos;intera durata dei contratti. Non misura quanto è
          già stato pagato, non è un costo annuale e non consente da solo di stabilire utilità, qualità
          o spreco. Lo snapshot è storico: descrive l&apos;aggiornamento di aprile 2026.
        </p>
      </section>

      <section className={`panel ${styles.sourcesPanel}`} aria-labelledby="sources-title">
        <div>
          <h2 id="sources-title" className="panel-title">Fonti e metodo</h2>
          <p>
            Fonte primaria: Istituto Nazionale di Documentazione, Innovazione e Ricerca Educativa.
            Sono incluse solo le righe il cui oggetto contiene un riferimento esplicito al PNRR.
          </p>
        </div>
        <ul>
          <li><a href={data.source.landingUrl}>Pagina ufficiale degli incarichi di collaborazione e consulenza</a></li>
          <li><a href={data.source.resourceUrl}>Elenco ufficiale XLSX · aggiornamento aprile 2026</a></li>
        </ul>
        <p className={styles.sourceNote}>
          Formato: {data.source.format}. Licenza di riuso non dichiarata nella pagina verificata.
          Copertura: {integer(data.coverage.pnrrAssignments)} righe PNRR su {integer(data.coverage.workbookAssignments)} incarichi nel foglio.
        </p>
      </section>
    </main>
  );
}
