import type { Metadata } from "next";
import Link from "next/link";

import {
  buildGovernmentDebateAnswers,
  getGovernmentDebateEvents,
  type GovernmentDebateRow,
} from "@/lib/government-debate-questions";
import { GOVERNMENT_SCORECARD_V6_CAUSAL_DISCLAIMER } from "@/lib/government-scorecard-page";

import {
  formatGovernmentChartPeriod,
  formatGovernmentChartPublicationStatus,
  formatGovernmentChartValue,
} from "../_components/chart-utils";
import scorecard from "../government-scorecard.module.css";
import styles from "./domande.module.css";

export const metadata: Metadata = {
  title: "Domande frequenti dal dibattito · Pagella dei governi",
  description: "Debito, disoccupazione, inflazione, stipendi, crescita, tassi e investimenti: com'erano all'inizio e alla fine di ogni governo dal 1995, con Francia, Germania e Spagna nello stesso periodo.",
};

// Built once from the versioned snapshot: no per-request work.
export const dynamic = "force-static";

const FREQUENCY_LABELS = { Annuale: "dati annuali", Trimestrale: "dati trimestrali", Mensile: "dati mensili" } as const;

function signed(value: number, unit: string): string {
  if (value === 0) return formatGovernmentChartValue(0, unit);
  return `${value > 0 ? "+" : "−"}${formatGovernmentChartValue(Math.abs(value), unit)}`;
}

function periodRange(row: GovernmentDebateRow): string {
  if (!row.first || !row.last) return "";
  return `${formatGovernmentChartPeriod(row.first.period)} → ${formatGovernmentChartPeriod(row.last.period)}`;
}

function eventPeriod(start: string, end: string | null): string {
  if (end === null) return `dal ${start.slice(0, 4)}, in corso`;
  return start.slice(0, 4) === end.slice(0, 4) ? start.slice(0, 4) : `${start.slice(0, 4)}–${end.slice(0, 4)}`;
}

export default function GovernmentDebateQuestionsPage() {
  const answers = buildGovernmentDebateAnswers();
  const events = getGovernmentDebateEvents();
  return (
    <main className={scorecard.page}>
      <nav className={styles.breadcrumb} aria-label="Percorso">
        <Link href="/governi">Pagella dei governi</Link>
        <span aria-hidden="true">/</span>
        <span aria-current="page">Domande dal dibattito</span>
      </nav>

      <header className={styles.intro}>
        <p className={scorecard.kicker}>Pagella dei governi</p>
        <h1>Domande frequenti dal dibattito</h1>
        <p>
          Sette domande che tornano nelle discussioni su debito, lavoro, prezzi e crescita. Le risposte
          usano solo i dati già pubblicati nella pagella: il valore all&apos;inizio e alla fine di ogni
          mandato e, accanto, come sono cambiati gli stessi dati in Francia, Germania e Spagna nello
          stesso periodo.
        </p>
        <p className={styles.disclaimer}>{GOVERNMENT_SCORECARD_V6_CAUSAL_DISCLAIMER} Vale anche per ogni riga di queste tabelle.</p>
      </header>

      <nav className={styles.toc} aria-label="Domande">
        <ol>
          {answers.map((answer) => (
            <li key={answer.id}><a href={`#${answer.id}`}>{answer.question}</a></li>
          ))}
        </ol>
      </nav>

      <section className={styles.events} aria-labelledby="eventi-titolo">
        <h2 id="eventi-titolo">Eventi esterni richiamati nelle tabelle</h2>
        <p>Sono gli stessi eventi documentati nelle schede dei governi. Il numero nella colonna Eventi indica quelli che si sovrappongono al mandato.</p>
        <ol>
          {events.map((event) => (
            <li key={event.id} id={`evento-${event.id}`}>
              <b aria-hidden="true">{event.number}</b>
              <span>
                <strong>{event.title}</strong> · {eventPeriod(event.start_date, event.end_date)}. {event.summary}{" "}
                {event.sources.map((source, index) => (
                  <span key={source.url}>
                    {index > 0 ? ", " : null}
                    <a href={source.url} target="_blank" rel="noreferrer" aria-label={`Fonte di ${event.title}: ${source.owner}, in una nuova scheda`}>{source.owner} ↗</a>
                  </span>
                ))}
              </span>
            </li>
          ))}
        </ol>
      </section>

      {answers.map((answer) => (
        <section key={answer.id} id={answer.id} className={styles.question} aria-labelledby={`${answer.id}-titolo`}>
          <h2 id={`${answer.id}-titolo`}>{answer.question}</h2>
          <p><strong>Cosa guardiamo.</strong> {answer.measures}</p>
          <p><strong>Come leggerlo.</strong> {answer.how_to_read}</p>
          <div className={styles.tableScroll} role="region" aria-labelledby={`${answer.id}-tabella`} tabIndex={0}>
            <table>
              <caption id={`${answer.id}-tabella`}>{answer.title} · {answer.unit} · {FREQUENCY_LABELS[answer.frequency]}</caption>
              <thead>
                <tr>
                  <th scope="col">Governo</th>
                  <th scope="col">Periodi confrontati</th>
                  <th scope="col">Italia, inizio</th>
                  <th scope="col">Italia, fine</th>
                  <th scope="col">Variazione Italia</th>
                  <th scope="col">Francia</th>
                  <th scope="col">Germania</th>
                  <th scope="col">Spagna</th>
                  <th scope="col">Eventi</th>
                </tr>
              </thead>
              <tbody>
                {answer.rows.map((row) => (
                  <tr key={row.government_id} data-government={row.government_id}>
                    <th scope="row">
                      <Link href={`/governi/${row.government_id}`}>{row.name}</Link>
                      <small>{row.status === "current" ? "in carica, dati fino all'ultimo periodo pubblicato" : `${row.start_date.slice(0, 4)}–${row.end_date?.slice(0, 4)}`}</small>
                    </th>
                    {row.change === null || !row.first || !row.last ? (
                      <td colSpan={7} className={styles.missing}>{row.missing_reason}</td>
                    ) : (
                      <>
                        <td data-label="Periodi confrontati">{periodRange(row)}</td>
                        <td data-label="Italia, inizio">{formatGovernmentChartValue(row.first.value, answer.unit)}{formatGovernmentChartPublicationStatus(row.first.status)}</td>
                        <td data-label="Italia, fine">{formatGovernmentChartValue(row.last.value, answer.unit)}{formatGovernmentChartPublicationStatus(row.last.status)}</td>
                        <td className={styles.change} data-label="Variazione Italia">{signed(row.change, answer.unit)}</td>
                        {row.peers.map((peer) => (
                          <td key={peer.id} data-label={peer.label}>{peer.change === null ? "n.d." : signed(peer.change, answer.unit)}</td>
                        ))}
                      </>
                    )}
                    <td data-label="Eventi">
                      {row.event_numbers.length === 0 ? "–" : row.event_numbers.map((number, index) => {
                        const event = events.find((candidate) => candidate.number === number)!;
                        return (
                          <span key={number}>
                            {index > 0 ? " " : null}
                            <a href={`#evento-${event.id}`} aria-label={`Evento ${number}: ${event.title}`}>{number}</a>
                          </span>
                        );
                      })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className={styles.source}>
            Fonte: <a href={answer.source.url} target="_blank" rel="noreferrer" aria-label={`Apri la fonte ${answer.source.owner} in una nuova scheda`}>{answer.source.owner} ↗</a>
            {` · Versione dei dati: ${answer.source.data_version}. Le variazioni di Francia, Germania e Spagna usano gli stessi periodi del mandato italiano.`}
          </p>
        </section>
      ))}

      <section className={styles.limits} aria-labelledby="limiti-titolo">
        <h2 id="limiti-titolo">Cosa queste tabelle non dicono</h2>
        <ul>
          <li>Non dicono quanta parte di una variazione dipenda dal governo: shock esterni, BCE e scelte dei governi precedenti pesano sugli stessi numeri.</li>
          <li>Il primo periodo può includere giorni precedenti al giuramento. Le serie trimestrali confrontano lo stesso trimestre, perché debito e PIL non destagionalizzati cambiano durante l&apos;anno.</li>
          <li>Mandati brevi possono non avere abbastanza dati pubblicati: in quel caso la riga lo dice invece di stimare un valore.</li>
          <li>Gli ultimi periodi possono essere provvisori o stimati e sono indicati accanto al numero.</li>
        </ul>
        <p>
          Per leggere un governo per intero apri la sua scheda dalla <Link href="/governi">pagella dei governi</Link>, oppure
          {" "}<Link href="/governi/confronta">confronta due governi</Link> sugli stessi grafici.
        </p>
      </section>
    </main>
  );
}
