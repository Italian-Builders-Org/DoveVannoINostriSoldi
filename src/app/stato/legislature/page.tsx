import type { Metadata } from "next";
import Link from "next/link";
import { compactEuro, exactEuro, longDate, percent } from "@/lib/format";
import {
  type LegislatureSpendingCycle,
} from "@/lib/state-spending-legislature";
import { getCachedLegislatureSpendingCycles } from "@/lib/data/cached-live-views";
import styles from "./legislature.module.css";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export const metadata: Metadata = {
  title: "Spesa dello Stato per legislatura",
  description:
    "Confronto descrittivo tra l'anno pre-elettorale e la media degli altri anni di ogni legislatura, sulla spesa OpenBDAP RGS.",
};

function LegislaturePanel({ cycle }: { cycle: LegislatureSpendingCycle }) {
  const { legislature, years, preElectionYear, otherYearsAverage, differenceFromAverage } = cycle;

  return (
    <section className="panel" aria-labelledby={`legislatura-${legislature.number}`}>
      <h2 id={`legislatura-${legislature.number}`}>
        {legislature.number} legislatura
        <small className={styles.range}>
          {legislature.endDate
            ? `Dal ${longDate(legislature.startDate)} al ${longDate(legislature.endDate)}`
            : `Dal ${longDate(legislature.startDate)}, in corso`}
        </small>
      </h2>

      {years.length === 0 ? (
        <p className={styles.note}>
          {legislature.endDate === null
            ? "Legislatura in corso: non ha ancora un'elezione successiva, quindi non c'è un anno pre-elettorale da confrontare."
            : "Nessun anno completo di questa legislatura rientra nel consuntivo OpenBDAP dal 2014 in poi."}
        </p>
      ) : (
        <>
          <div className="table-scroll" role="region" aria-label={`Spesa per anno, ${legislature.number} legislatura`} tabIndex={0}>
            <table className="table">
              <caption>Consuntivo annuale della spesa dello Stato per missione, OpenBDAP RGS</caption>
              <thead>
                <tr>
                  <th scope="col">Anno</th>
                  <th scope="col" className="num">Spesa totale</th>
                  <th scope="col">Nota</th>
                  <th scope="col">Provenienza</th>
                </tr>
              </thead>
              <tbody>
                {years.map((entry) => (
                  <tr key={entry.year}>
                    <th scope="row">
                      {entry.year}
                      {entry.isPreElectionYear ? <span className={styles.tag}>anno pre-elettorale</span> : null}
                    </th>
                    <td className="num">{exactEuro(entry.totalPaid)}</td>
                    <td>{entry.extraordinaryContext ?? "n.d."}</td>
                    <td>
                      <a href={entry.source.packageUrl} target="_blank" rel="noreferrer">
                        Package OpenBDAP {entry.year}
                      </a>
                      <small className={styles.sourceMeta}>
                        {entry.source.metadataModified
                          ? `Catalogo aggiornato il ${longDate(entry.source.metadataModified)}`
                          : "Data catalogo non disponibile"}
                        {" · "}{entry.source.releaseKind}
                      </small>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {preElectionYear && otherYearsAverage !== null && differenceFromAverage !== null ? (
            <p className={styles.summary}>
              L&apos;anno pre-elettorale ({preElectionYear.year}) vale {compactEuro(preElectionYear.totalPaid)},
              contro una media di {compactEuro(otherYearsAverage)} negli altri {years.length - 1} anni completi
              della legislatura: differenza aritmetica di {compactEuro(differenceFromAverage)}
              {" "}({percent((differenceFromAverage / otherYearsAverage) * 100)}).
              {preElectionYear.extraordinaryContext
                ? " Non è una prova di spesa elettorale: l'anno include anche la spesa straordinaria dichiarata sopra, il cui peso specifico su questa differenza non isoliamo."
                : " Non è una prova di spesa elettorale: la spesa statale cresce anche per motivi indipendenti dal voto, che questo confronto non isola."}
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}

export default async function StateSpendingLegislaturePage() {
  let cycles: LegislatureSpendingCycle[] | null = null;
  let errorMessage: string | null = null;

  try {
    cycles = await getCachedLegislatureSpendingCycles();
  } catch (error) {
    errorMessage = error instanceof Error ? error.message : "Errore sconosciuto";
  }

  return (
    <main className="shell page">
      <nav className={styles.breadcrumb} aria-label="Percorso">
        <Link href="/">Home</Link>
        <span>→</span>
        <Link href="/stato">Spese dello Stato</Link>
        <span>→</span>
        <span>Legislature</span>
      </nav>

      <header className="page-intro">
        <h1>Spesa dello Stato per legislatura</h1>
        <p>
          Confronto descrittivo, non un&apos;analisi statistica: mostriamo l&apos;anno pre-elettorale e
          gli altri anni completi di ogni legislatura, così come pubblicati dal consuntivo OpenBDAP RGS.
        </p>
      </header>

      {errorMessage ? (
        <p className={styles.note} role="alert">
          Dati OpenBDAP non raggiungibili in questo momento: {errorMessage}
        </p>
      ) : (
        <div className={styles.cycles}>
          {cycles!.map((cycle) => (
            <LegislaturePanel key={cycle.legislature.number} cycle={cycle} />
          ))}
        </div>
      )}

      <div className="notice">
        <strong>Cosa questo confronto non dimostra</strong>
        <p>
          Osserviamo soltanto due legislature complete (XVII e XVIII): non basta a stabilire un
          pattern generale. Un anno pre-elettorale più alto della media della sua legislatura non è
          di per sé una prova di spesa elettorale, né implica una responsabilità individuale: la
          spesa statale può crescere anche per ragioni indipendenti dal calendario elettorale
          (inflazione, nuove missioni di spesa, eventi straordinari), che questo confronto non
          isola. Il 2020 e il 2021 coincidono con il periodo delle misure emergenziali COVID-19,
          dichiarato esplicitamente nelle tabelle sopra: il loro contributo ai totali non è isolato
          né quantificato. Il confronto riguarda solo la
          spesa statale nazionale: non copre Comuni, Regioni o elezioni europee, per cui non
          abbiamo serie storiche di spesa comparabili.
        </p>
        <p>
          Fonti: <a href="https://bdap-opendata.rgs.mef.gov.it" target="_blank" rel="noreferrer">OpenBDAP RGS</a>{" "}
          per la spesa; <a href="https://www.camera.it" target="_blank" rel="noreferrer">Camera dei Deputati</a>{" "}
          e <a href="https://www.interno.gov.it" target="_blank" rel="noreferrer">Ministero dell&apos;Interno</a>{" "}
          per le date delle legislature e delle elezioni;{" "}
          <a href="https://www.governo.it/sites/new.governo.it/files/DL_20200520.pdf" target="_blank" rel="noreferrer">
            decreto-legge 34/2020
          </a>{" "}
          per il contesto delle misure emergenziali COVID-19.
        </p>
      </div>
    </main>
  );
}
