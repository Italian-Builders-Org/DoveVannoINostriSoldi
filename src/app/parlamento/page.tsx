import type { Metadata } from "next";
import Link from "next/link";
import { longDate } from "@/lib/format";
import { parliamentSnapshot } from "@/lib/parliament-snapshot";
import type { ParliamentStatement } from "@/lib/data/parliament-contract";
import { INSTITUTIONAL_SOURCE_REGISTRY } from "@/lib/data/institutional-source-registry";
import { ParliamentYearFilter } from "./ParliamentYearFilter";
import styles from "./parlamento.module.css";

export const metadata: Metadata = {
  title: "Spese Camera, Senato e Quirinale",
  description:
    "Consuntivi Camera 2020-2025 (categorie 2023-2025), rendiconto Senato 2024 per capitolo, previsioni Quirinale per comparti e serie della dotazione, con periodi e fonti distinti.",
};

const amount = new Intl.NumberFormat("it-IT", {
  maximumFractionDigits: 1,
  minimumFractionDigits: 1,
  useGrouping: "always",
});

function millionEuro(value: number): string {
  return `${amount.format(value)} mln €`;
}

function statementValue(statement: ParliamentStatement, key: string): number | null {
  return statement.values?.[key] ?? null;
}

function chamberLabel(id: string): string {
  if (id === "camera") return "Camera";
  if (id === "senato") return "Senato";
  if (id === "quirinale") return "Quirinale";
  return id;
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
          Tre bilanci autonomi, tre fonti ufficiali. Per la Camera trovi i totali 2020-2025 e, dal
          2023, la ripartizione per categoria. Per il Senato il rendiconto 2024 è ripartito per
          capitolo (senatori, personale, funzionamento, previdenza). Il Quirinale espone previsioni
          per comparti e la serie della dotazione.
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
            anno. Dal 2023 il dettaglio per categoria è sotto, selezionando l&apos;anno.
          </p>
          <div
            className={`table-scroll ${styles.coverageTable}`}
            role="region"
            aria-label="Serie Camera pagamenti"
            tabIndex={0}
          >
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
          <div
            className={`table-scroll ${styles.coverageTable}`}
            role="region"
            aria-label="Serie Quirinale dotazione"
            tabIndex={0}
          >
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

      <ParliamentYearFilter chambers={chambers} />

      <details className="data-details">
        <summary>Documenti, copertura e limiti</summary>
        <div className="notice">
          <strong>Come leggere questi numeri</strong>
          <p>
            Il bilancio è quanto si prevede di spendere. Il consuntivo è quanto è stato impegnato o
            pagato. Camera e Senato hanno bilanci autonomi; lo stesso vale per la Presidenza della
            Repubblica. Nessun totale unico tra le tre istituzioni.
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
          <p className={styles.scrollHint}>
            Scorri la tabella verso destra per vedere approvazione, copertura e fonti.
          </p>
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
                      {source.subjectId === "senato" &&
                      source.title.toLocaleLowerCase("it-IT").includes("2024") ? (
                        <>
                          <span className={styles.metadataStatus}>Numeri pubblicati</span>
                          <small>Rendiconto 2024 ripartito nello snapshot</small>
                        </>
                      ) : (
                        <>
                          <span className={styles.metadataStatus}>Solo metadati</span>
                          <small>Numeri del PDF non verificati in questa tabella</small>
                        </>
                      )}
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
