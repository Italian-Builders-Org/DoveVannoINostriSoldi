import type { Metadata } from "next";
import Link from "next/link";
import { longDate } from "@/lib/format";
import { parliamentSnapshot } from "@/lib/parliament-snapshot";
import type { ParliamentStatement } from "@/lib/data/parliament-contract";
import styles from "./parlamento.module.css";

export const metadata: Metadata = {
  title: "Spese del Parlamento, dati della Camera",
  description:
    "Bilanci e pagamenti della Camera dei deputati, collegati ai documenti ufficiali. Il Senato sarà pubblicato solo dopo una verifica equivalente.",
};

const amount = new Intl.NumberFormat("it-IT", {
  maximumFractionDigits: 1,
  minimumFractionDigits: 1,
  useGrouping: "always",
});

const valueLabels: Record<string, string> = {
  totalCommitments: "Impegni totali",
  effectiveCommitments: "Impegni per la spesa effettiva",
  effectivePayments: "Pagamenti per la spesa effettiva",
  finalAdministrationSurplus: "Avanzo finale",
  annualStateContribution: "Contributo dello Stato",
  plannedExpenditure: "Spesa prevista",
  functioningExpenditure: "Spesa di funzionamento prevista",
  plannedRevenue: "Entrate previste",
};

function millionEuro(value: number): string {
  return `${amount.format(value)} mln €`;
}

function statementValue(statement: ParliamentStatement, key: string): number | null {
  return statement.values?.[key] ?? null;
}

export default function ParliamentPage() {
  const chambers = parliamentSnapshot.chambers;
  const latestAccount = chambers
    .flatMap((chamber) => chamber.statements)
    .filter((statement) => statement.kind === "account")
    .sort((left, right) => right.year - left.year)[0];
  const latestBudget = chambers
    .flatMap((chamber) => chamber.statements)
    .filter((statement) => statement.kind === "budget")
    .sort((left, right) => right.year - left.year)[0];

  return (
    <main className="shell page">
      <div className="page-intro">
        <h1>Spese del Parlamento, dati della Camera</h1>
        <p>
          Al momento sono pronti i dati della Camera dei deputati. Mostriamo soltanto i bilanci che
          abbiamo trasformato in dati e ricontrollato. Consuntivi e previsioni restano separati,
          perché descrivono momenti diversi.
        </p>
      </div>

      <dl className="stat-strip">
        <div>
          <dt>Rami con dati pronti</dt>
          <dd>{chambers.length}</dd>
          <span className="stat-note">su documenti ufficiali verificati</span>
        </div>
        <div>
          <dt>Ultimo consuntivo</dt>
          <dd>{latestAccount?.year ?? "Non disponibile"}</dd>
          <span className="stat-note">spese già registrate</span>
        </div>
        <div>
          <dt>Ultimo bilancio</dt>
          <dd>{latestBudget?.year ?? "Non disponibile"}</dd>
          <span className="stat-note">spese previste</span>
        </div>
        <div>
          <dt>Controllato da noi</dt>
          <dd>{longDate(parliamentSnapshot.observedAt)}</dd>
          <span className="stat-note">controllo automatico ogni 6 ore</span>
        </div>
      </dl>

      <div className="notice">
        <strong>Come leggere questi numeri</strong>
        <p>
          Un bilancio indica quanto si prevede di spendere. Un consuntivo indica quanto è stato
          impegnato o pagato. Non sommiamo i due valori e non stimiamo i dati che mancano.
        </p>
      </div>

      {chambers.map((chamber) => (
        <section className={styles.chamber} key={chamber.id}>
          <header className={styles.chamberHeader}>
            <div>
              <span>Dati ufficiali</span>
              <h2>{chamber.name}</h2>
            </div>
            <a href={chamber.landingUrl} target="_blank" rel="noreferrer">
              Apri la pagina ufficiale ↗
            </a>
          </header>

          <div className={styles.statementGrid}>
            {chamber.statements
              .slice()
              .sort((left, right) => left.kind.localeCompare(right.kind))
              .map((statement) => {
                const isAccount = statement.kind === "account";
                const mainValue = isAccount
                  ? statementValue(statement, "effectivePayments")
                  : statementValue(statement, "plannedExpenditure");
                const items = isAccount ? statement.categories : statement.highlights;
                const maximum = Math.max(
                  1,
                  ...(items?.map((item) => ("paid" in item ? item.paid : item.value)) ?? []),
                );

                return (
                  <article className="panel" key={`${statement.kind}-${statement.year}`}>
                    <div className={styles.statementHeader}>
                      <div>
                        <span>{isAccount ? "Spese registrate" : "Spese previste"}</span>
                        <h3>{statement.title}</h3>
                      </div>
                      <strong>{mainValue === null ? "Dato non disponibile" : millionEuro(mainValue)}</strong>
                    </div>

                    <p className={styles.meaning}>{statement.meaning}</p>

                    {statement.values && (
                      <dl className={styles.values}>
                        {Object.entries(statement.values).map(([key, value]) => (
                          <div key={key}>
                            <dt>{valueLabels[key] ?? key}</dt>
                            <dd>{millionEuro(value)}</dd>
                          </div>
                        ))}
                      </dl>
                    )}

                    {items && items.length > 0 && (
                      <div className={styles.breakdown}>
                        <h4>{isAccount ? "Per cosa sono stati pagati" : "Alcune voci previste"}</h4>
                        <ul>
                          {items.map((item) => {
                            const value = "paid" in item ? item.paid : item.value;
                            return (
                              <li key={item.id}>
                                <div>
                                  <span>{item.label}</span>
                                  <strong>{millionEuro(value)}</strong>
                                </div>
                                <i style={{ width: `${Math.max(2, (value / maximum) * 100)}%` }} />
                                {"components" in item && item.components ? (
                                  <dl className={styles.categoryComponents}>
                                    {item.components.map((component) => (
                                      <div key={component.id}>
                                        <dt>{component.label}</dt>
                                        <dd>{millionEuro(component.paid)}</dd>
                                      </div>
                                    ))}
                                  </dl>
                                ) : null}
                                {"caveat" in item && item.caveat ? (
                                  <p className={styles.categoryCaveat}>{item.caveat}</p>
                                ) : null}
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    )}

                    <a className={styles.documentLink} href={statement.documentUrl} target="_blank" rel="noreferrer">
                      Leggi il documento ufficiale ↗
                    </a>
                  </article>
                );
              })}
          </div>
        </section>
      ))}

      <section className="panel">
        <h2 className="panel-title">Cosa non pubblichiamo ancora</h2>
        <p className={styles.plainText}>{parliamentSnapshot.methodology.missingData}</p>
        <p className={styles.plainText}>{parliamentSnapshot.methodology.comparability}</p>
        <div className={styles.relatedLinks}>
          <Link href="/stato">Spese delle amministrazioni centrali</Link>
          <Link href="/fonti">Fonti collegate</Link>
        </div>
      </section>
    </main>
  );
}
