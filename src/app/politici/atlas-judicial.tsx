"use client";

import type { GiudiziarioCase } from "@/lib/data/parlamento-giudiziario-contract";
import { formatEuroCents, formatSentenceMonths, OUTCOME_LABELS } from "@/lib/parlamento-giudiziario";
import styles from "./politici.module.css";

export type JudicialState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; cases: GiudiziarioCase[]; coverageNote: string };

const INSTANCE_LABELS: Record<string, string> = {
  primo_grado: "Primo grado",
  appello: "Appello",
  cassazione: "Cassazione",
  rinvio: "Giudizio di rinvio",
  patteggiamento: "Patteggiamento",
  decreto_penale: "Decreto penale",
  corte_conti_primo: "Corte dei conti, primo grado",
  corte_conti_appello: "Corte dei conti, appello",
};

const OUTCOME_VERBS: Record<string, string> = {
  condanna: "condanna",
  assoluzione: "assoluzione",
  prescrizione: "prescrizione",
  annullamento_con_rinvio: "annullamento con rinvio",
  conferma: "conferma",
  riduzione_pena: "riduzione della pena",
  altro: "altro",
};

/**
 * Documented judicial proceedings of the selected person.
 *
 * The block states the stage each case has reached and never turns it into a
 * verdict of its own: a conviction that is not final is not a finding of guilt,
 * and a proceeding that ended in acquittal or time bar is shown as such. It is
 * rendered only when the research documented at least one case, because an empty
 * block would read as a clean record, which this dataset cannot certify.
 */
export function JudicialBlock({ judicial }: { judicial: JudicialState | null }) {
  if (!judicial || judicial.status === "loading") {
    return null;
  }
  if (judicial.status === "error") {
    return (
      <section className={styles.judicialBlock} aria-label="Procedimenti giudiziari documentati">
        <div className={styles.sectionHeading}>
          <h3>Procedimenti giudiziari documentati</h3>
        </div>
        <p className={styles.note}>Dati non raggiungibili in questo momento.</p>
      </section>
    );
  }
  if (judicial.cases.length === 0) {
    return null;
  }

  return (
    <section className={styles.judicialBlock} aria-label="Procedimenti giudiziari documentati">
      <div className={styles.sectionHeading}>
        <h3>Procedimenti giudiziari documentati</h3>
      </div>
      <p className={styles.judicialLead}>
        Una condanna non definitiva non è una colpevolezza accertata: fino alla sentenza definitiva l&apos;imputato
        non è considerato colpevole (art. 27 della Costituzione). Prescrizioni e assoluzioni non sono condanne.
      </p>
      <ul className={styles.judicialList}>
        {judicial.cases.map((item) => {
          // A sentence belongs to a conviction: showing the first-instance penalty of a
          // case that ended in acquittal or a time bar would describe a punishment that
          // no longer exists.
          const sentence =
            item.outcomeBucket === "condannato" ? formatSentenceMonths(item.latestSentenceMonths) : null;
          // Il danno erariale e una responsabilita contabile accertata dalla Corte dei
          // conti. Gli importi che compaiono in un processo penale sono provvisionali o
          // risarcimenti a una parte civile: chiamarli danno erariale e falso, e se la
          // sentenza e stata riformata quell'importo non esiste piu.
          const damageEvent = item.jurisdiction === "contabile" && item.outcomeBucket === "contabile"
            ? [...item.events].reverse().find((event) => event.damagesEuroCents !== null)
            : undefined;
          const damage = formatEuroCents(damageEvent?.damagesEuroCents ?? null);
          return (
            <li key={item.caseId} className={styles.judicialCase} data-outcome={item.outcomeBucket}>
              <p className={styles.judicialTitle}>
                <span className={styles.judicialStatus} data-outcome={item.outcomeBucket}>{item.statusLabel}</span>
                {item.recheck === "da-riverificare" ? (
                  <span className={styles.judicialRecheck}>da riverificare</span>
                ) : null}
                {item.title}
              </p>
              {item.recheck === "da-riverificare" ? (
                <p className={styles.judicialRecheckNote}>
                  Procedimento non definitivo che nessuno controlla da oltre un anno: lo stato potrebbe essere
                  cambiato senza che questa scheda lo riporti.
                </p>
              ) : null}
              <p className={styles.judicialMeta}>
                {OUTCOME_LABELS[item.outcomeBucket]} · stato al {item.statusAsOf} · verificato il {item.verifiedAt}
                {sentence ? ` · pena nell'ultima sentenza: ${sentence}` : ""}
                {damage ? ` · danno erariale: ${damage}` : ""}
              </p>
              <p className={styles.judicialOffence}>{item.offence}</p>
              <ol className={styles.judicialSteps}>
                {item.events.map((event, index) => (
                  <li key={`${item.caseId}-${index}`}>
                    <strong>{INSTANCE_LABELS[event.instance] ?? event.instance}</strong>
                    {event.date && event.date !== "n.d." ? ` · ${event.date}` : ""} · {OUTCOME_VERBS[event.outcome] ?? event.outcome}
                    {event.court ? ` · ${event.court}` : ""}
                  </li>
                ))}
              </ol>
              <p className={styles.judicialSources}>
                Fonti:{" "}
                {item.sources.map((source, index) => (
                  <span key={source.url}>
                    {index > 0 ? " · " : ""}
                    <a href={source.url} rel="noreferrer nofollow" target="_blank">
                      {source.publisher}
                      {source.publishedAt ? `, ${source.publishedAt}` : ""}
                    </a>
                  </span>
                ))}
              </p>
              {item.correction ? <p className={styles.judicialNote}>Correzione: {item.correction}</p> : null}
            </li>
          );
        })}
      </ul>
      <p className={styles.judicialFooter}>{judicial.coverageNote}</p>
    </section>
  );
}
