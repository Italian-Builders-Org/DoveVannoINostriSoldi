import type { Metadata } from "next";
import Link from "next/link";
import { longDate } from "@/lib/format";
import { parliamentSnapshot } from "@/lib/parliament-snapshot";
import type { ParliamentStatement } from "@/lib/data/parliament-contract";
import { INSTITUTIONAL_SOURCE_REGISTRY } from "@/lib/data/institutional-source-registry";
import styles from "./parlamento.module.css";

export const metadata: Metadata = {
  title: "Spese del Parlamento: Camera e Senato",
  description:
    "Dati verificati della Camera e copertura documentale separata per Camera e Senato, con periodi, procedure e fonti ufficiali.",
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
  const documentCoverage = INSTITUTIONAL_SOURCE_REGISTRY.filter(
    (source) => source.domain === "parliament",
  );
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
        <h1>Spese del Parlamento</h1>
        <p>
          Camera e Senato hanno bilanci autonomi. Per la Camera mostriamo i dati che abbiamo già
          estratto e riconciliato; per i documenti 2024 dei due rami mostriamo per ora soltanto
          metadati e procedure. Non li sommiamo e non stimiamo i numeri che non abbiamo verificato.
        </p>
      </div>

      <dl className="stat-strip">
        <div>
          <dt>Rami con numeri verificati</dt>
          <dd>{chambers.length}</dd>
          <span className="stat-note">su documenti ufficiali verificati</span>
        </div>
        <div>
          <dt>Ultimo consuntivo Camera</dt>
          <dd>{latestAccount?.year ?? "Non disponibile"}</dd>
          <span className="stat-note">spese già registrate</span>
        </div>
        <div>
          <dt>Ultimo bilancio Camera</dt>
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

      <section className="panel" aria-labelledby="copertura-parlamento">
        <div className={styles.coverageHeader}>
          <div>
            <h2 id="copertura-parlamento">Copertura dei due rami</h2>
            <p>Un documento censito non diventa automaticamente un dato numerico.</p>
          </div>
          <span>Documenti 2024 · fonti ufficiali</span>
        </div>
        <p className={styles.scrollHint}>Scorri la tabella verso destra per vedere approvazione, copertura e fonti.</p>
        <div className={`table-scroll ${styles.coverageTable}`} role="region" aria-label="Copertura dei documenti contabili di Camera e Senato" tabIndex={0}>
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Ramo</th>
                <th scope="col">Documento</th>
                <th scope="col">Approvato</th>
                <th scope="col">Copertura</th>
                <th scope="col">Fonte</th>
              </tr>
            </thead>
            <tbody>
              {documentCoverage.map((source) => (
                <tr key={source.id}>
                  <th scope="row">{source.subjectId === "camera" ? "Camera" : "Senato"}</th>
                  <td>
                    {source.title}
                    <small>ID fonte: {source.sourceRecordId}</small>
                  </td>
                  <td>{longDate(source.updatedAt)}</td>
                  <td>
                    <span className={styles.metadataStatus}>Solo metadati</span>
                    <small>Numeri del PDF non verificati</small>
                  </td>
                  <td>
                    <a href={source.sourceUrl} target="_blank" rel="noreferrer">Procedura ↗</a>
                    {source.downloadUrl ? (
                      <small><a href={source.downloadUrl} target="_blank" rel="noreferrer">PDF ufficiale ↗</a></small>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

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
