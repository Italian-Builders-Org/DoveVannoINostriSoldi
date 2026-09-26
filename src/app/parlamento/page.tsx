import type { Metadata } from "next";
import Link from "next/link";
import { longDate } from "@/lib/format";
import { parliamentSnapshot } from "@/lib/parliament-snapshot";
import type { ParliamentChamber, ParliamentStatement } from "@/lib/data/parliament-contract";
import { INSTITUTIONAL_SOURCE_REGISTRY } from "@/lib/data/institutional-source-registry";
import styles from "./parlamento.module.css";

export const metadata: Metadata = {
  title: "Spese Camera, Senato e Quirinale",
  description:
    "Consuntivi e bilanci ufficiali della Camera, copertura documentale del Senato e previsioni/dotazione della Presidenza della Repubblica, con periodi e fonti distinti.",
};

const amount = new Intl.NumberFormat("it-IT", {
  maximumFractionDigits: 1,
  minimumFractionDigits: 1,
  useGrouping: "always",
});

const componentAmount = new Intl.NumberFormat("it-IT", {
  maximumFractionDigits: 2,
  minimumFractionDigits: 2,
  useGrouping: "always",
});

const valueLabels: Record<string, string> = {
  totalCommitments: "Impegni totali",
  effectiveCommitments: "Impegni per la spesa effettiva",
  effectivePayments: "Pagamenti per la spesa effettiva",
  finalAdministrationSurplus: "Avanzo finale di amministrazione",
  annualStateContribution: "Contributo / dotazione dello Stato",
  plannedExpenditure: "Spesa effettiva prevista",
  functioningExpenditure: "Spesa di funzionamento prevista",
  plannedRevenue: "Entrate previste",
  plannedOutlaysIncludingClearing: "Uscite previste con partite di giro",
};

function millionEuro(value: number): string {
  return `${amount.format(value)} mln €`;
}

function componentMillionEuro(value: number): string {
  return `${componentAmount.format(value)} mln €`;
}

function statementValue(statement: ParliamentStatement, key: string): number | null {
  return statement.values?.[key] ?? null;
}

function sortStatements(statements: ParliamentStatement[]): ParliamentStatement[] {
  return statements.slice().sort((left, right) => {
    if (left.kind !== right.kind) return left.kind.localeCompare(right.kind);
    return right.year - left.year;
  });
}

function chamberLabel(id: string): string {
  if (id === "camera") return "Camera";
  if (id === "senato") return "Senato";
  if (id === "quirinale") return "Quirinale";
  return id;
}

function StatementCard({ statement }: { statement: ParliamentStatement }) {
  const isAccount = statement.kind === "account";
  const mainValue = isAccount
    ? statementValue(statement, "effectivePayments") ??
      statementValue(statement, "effectiveCommitments")
    : statementValue(statement, "plannedExpenditure") ??
      statementValue(statement, "annualStateContribution");
  const items = isAccount ? statement.categories : statement.highlights;
  const maximum = Math.max(
    1,
    ...(items?.map((item) => ("paid" in item ? item.paid : item.value)) ?? []),
  );
  const isEndowmentSeries = statement.title.toLocaleLowerCase("it-IT").includes("serie della dotazione");

  return (
    <article className="panel" key={`${statement.kind}-${statement.year}-${statement.title}`}>
      <div className={styles.statementHeader}>
        <div>
          <span>{isAccount ? "Spese registrate" : isEndowmentSeries ? "Serie ufficiale" : "Spese previste"}</span>
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
          <h4>
            {isAccount
              ? "Per cosa sono stati pagati"
              : isEndowmentSeries
                ? "Dotazione per anno"
                : "Alcune voci previste"}
          </h4>
          <ul>
            {items.map((item) => {
              const value = "paid" in item ? item.paid : item.value;
              return (
                <li key={item.id}>
                  <div>
                    <span>{item.label}</span>
                    <strong>{millionEuro(value)}</strong>
                  </div>
                  {!isEndowmentSeries ? (
                    <i style={{ width: `${Math.max(2, (value / maximum) * 100)}%` }} />
                  ) : null}
                  {"components" in item && item.components ? (
                    <dl className={styles.categoryComponents}>
                      {item.components.map((component) => (
                        <div key={component.id}>
                          <dt>{component.label}</dt>
                          <dd>{componentMillionEuro(component.paid)}</dd>
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
}

function ChamberSection({ chamber }: { chamber: ParliamentChamber }) {
  return (
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
        {sortStatements(chamber.statements).map((statement) => (
          <StatementCard key={`${statement.kind}-${statement.year}-${statement.title}`} statement={statement} />
        ))}
      </div>
    </section>
  );
}

export default function ParliamentPage() {
  const chambers = parliamentSnapshot.chambers;
  const camera = chambers.find((chamber) => chamber.id === "camera");
  const quirinale = chambers.find((chamber) => chamber.id === "quirinale");
  const documentCoverage = INSTITUTIONAL_SOURCE_REGISTRY.filter(
    (source) => source.domain === "parliament",
  );

  const cameraAccounts = (camera?.statements ?? [])
    .filter((statement) => statement.kind === "account")
    .slice()
    .sort((left, right) => left.year - right.year);
  const endowmentSeries = quirinale?.statements.find((statement) =>
    statement.title.toLocaleLowerCase("it-IT").includes("serie della dotazione"),
  );

  const latestCameraAccount = cameraAccounts.at(-1);
  const latestCameraBudget = (camera?.statements ?? [])
    .filter((statement) => statement.kind === "budget")
    .sort((left, right) => right.year - left.year)[0];

  return (
    <main className="shell page">
      <div className="page-intro">
        <h1>Spese di Camera, Senato e Quirinale</h1>
        <p>
          Tre bilanci autonomi, tre fonti ufficiali. Qui trovi i totali verificati dei consuntivi
          Camera (2020-2025), le previsioni e la dotazione della Presidenza della Repubblica, e i
          documenti del Senato ancora in sola copertura documentale.
        </p>
      </div>

      <dl className="stat-strip">
        <div>
          <dt>Istituzioni con numeri</dt>
          <dd>{chambers.length}</dd>
          <span className="stat-note">Camera e Quirinale strutturati</span>
        </div>
        <div>
          <dt>Ultimo consuntivo Camera</dt>
          <dd>{latestCameraAccount?.year ?? "Non disponibile"}</dd>
          <span className="stat-note">
            {latestCameraAccount
              ? millionEuro(statementValue(latestCameraAccount, "effectivePayments") ?? 0)
              : "spese registrate"}
          </span>
        </div>
        <div>
          <dt>Ultimo bilancio Camera</dt>
          <dd>{latestCameraBudget?.year ?? "Non disponibile"}</dd>
          <span className="stat-note">spese previste</span>
        </div>
        <div>
          <dt>Controllato da noi</dt>
          <dd>{longDate(parliamentSnapshot.observedAt)}</dd>
          <span className="stat-note">snapshot statico pinnato</span>
        </div>
      </dl>

      {cameraAccounts.length > 1 ? (
        <section className="panel" aria-labelledby="serie-camera">
          <h2 id="serie-camera" className="panel-title">
            Camera: pagamenti della spesa effettiva nel tempo
          </h2>
          <p className={styles.plainText}>
            Totale dei pagamenti di competenza sui Titoli I, II e III (spesa effettiva), anno per
            anno. Il dettaglio per categoria resta sul consuntivo 2025.
          </p>
          <div className={`table-scroll ${styles.coverageTable}`} role="region" aria-label="Serie Camera pagamenti" tabIndex={0}>
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Anno</th>
                  <th scope="col">Pagamenti spesa effettiva</th>
                  <th scope="col">Impegni spesa effettiva</th>
                  <th scope="col">Impegni totali</th>
                  <th scope="col">Avanzo finale</th>
                  <th scope="col">Dotazione Stato</th>
                </tr>
              </thead>
              <tbody>
                {cameraAccounts.map((statement) => (
                  <tr key={statement.year}>
                    <th scope="row">{statement.year}</th>
                    <td>
                      {statementValue(statement, "effectivePayments") === null
                        ? "n.d."
                        : millionEuro(statementValue(statement, "effectivePayments")!)}
                    </td>
                    <td>
                      {statementValue(statement, "effectiveCommitments") === null
                        ? "n.d."
                        : millionEuro(statementValue(statement, "effectiveCommitments")!)}
                    </td>
                    <td>
                      {statementValue(statement, "totalCommitments") === null
                        ? "n.d."
                        : millionEuro(statementValue(statement, "totalCommitments")!)}
                    </td>
                    <td>
                      {statementValue(statement, "finalAdministrationSurplus") === null
                        ? "n.d."
                        : millionEuro(statementValue(statement, "finalAdministrationSurplus")!)}
                    </td>
                    <td>
                      {statementValue(statement, "annualStateContribution") === null
                        ? "n.d."
                        : millionEuro(statementValue(statement, "annualStateContribution")!)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {endowmentSeries?.highlights ? (
        <section className="panel" aria-labelledby="serie-quirinale">
          <h2 id="serie-quirinale" className="panel-title">
            Quirinale: dotazione a carico dello Stato
          </h2>
          <p className={styles.plainText}>
            Importo annuale della dotazione iscritta nel bilancio dello Stato (tabella ufficiale della
            nota illustrativa). Non coincide automaticamente con la spesa effettiva del Segretariato.
          </p>
          <div className={`table-scroll ${styles.coverageTable}`} role="region" aria-label="Serie Quirinale dotazione" tabIndex={0}>
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Anno</th>
                  <th scope="col">Dotazione</th>
                </tr>
              </thead>
              <tbody>
                {endowmentSeries.highlights.map((item) => (
                  <tr key={item.id}>
                    <th scope="row">{item.label}</th>
                    <td>{millionEuro(item.value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {chambers.map((chamber) => (
        <ChamberSection key={chamber.id} chamber={chamber} />
      ))}

      <details className="data-details">
        <summary>Documenti, copertura e limiti</summary>
        <div className="notice">
          <strong>Come leggere questi numeri</strong>
          <p>
            Il bilancio è quanto si prevede di spendere. Il consuntivo è quanto è stato impegnato o
            pagato. Camera, Senato e Quirinale restano su ambiti separati: nessun totale unico.
          </p>
        </div>

        <section className="panel" aria-labelledby="copertura-parlamento">
          <div className={styles.coverageHeader}>
            <div>
              <h2 id="copertura-parlamento">Copertura documentale (metadati)</h2>
              <p>Un documento censito non diventa automaticamente un dato numerico.</p>
            </div>
            <span>Fonti ufficiali</span>
          </div>
          <p className={styles.scrollHint}>Scorri la tabella verso destra per vedere approvazione, copertura e fonti.</p>
          <div
            className={`table-scroll ${styles.coverageTable}`}
            role="region"
            aria-label="Copertura dei documenti contabili"
            tabIndex={0}
          >
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
                    <th scope="row">{chamberLabel(source.subjectId)}</th>
                    <td>
                      {source.title}
                      <small>ID fonte: {source.sourceRecordId}</small>
                    </td>
                    <td>{longDate(source.updatedAt)}</td>
                    <td>
                      <span className={styles.metadataStatus}>Solo metadati</span>
                      <small>Numeri del PDF non verificati in questa tabella</small>
                    </td>
                    <td>
                      <a href={source.sourceUrl} target="_blank" rel="noreferrer">
                        Procedura ↗
                      </a>
                      {source.downloadUrl ? (
                        <small>
                          <a href={source.downloadUrl} target="_blank" rel="noreferrer">
                            PDF ufficiale ↗
                          </a>
                        </small>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="panel">
          <h2 className="panel-title">Cosa non pubblichiamo ancora</h2>
          <p className={styles.plainText}>{parliamentSnapshot.methodology.missingData}</p>
          <p className={styles.plainText}>{parliamentSnapshot.methodology.comparability}</p>
          <div className={styles.relatedLinks}>
            <Link href="/stato">Spese delle amministrazioni centrali</Link>
            <Link href="/fonti">Fonti collegate</Link>
            <a href="https://github.com/Italian-Builders-Org/DoveVannoINostriSoldi/issues/667">
              Issue #667
            </a>
          </div>
        </section>
      </details>
    </main>
  );
}
