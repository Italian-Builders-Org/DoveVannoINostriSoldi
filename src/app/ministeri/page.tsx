import type { Metadata } from "next";
import { getStateAdministrationIdentity } from "@/lib/data/state-administration-identities";
import { compactEuro, exactEuro, longDate } from "@/lib/format";
import { rgsMinistriesMetadata, rgsMinistriesSnapshot } from "@/lib/rgs-ministries-snapshot";
import { MinistryCommitmentTreemap } from "./ministry-commitment-treemap";
import styles from "./ministeri.module.css";

export const metadata: Metadata = {
  title: "Spese dei Ministeri, rendiconto 2025",
  description:
    "Totale CP, Pagato CP e Rimasto da pagare CP dei 15 Ministeri nel rendiconto ufficiale RGS 2025, con valori esatti.",
};

const euro = (cents: number) => cents / 100;

export default function MinistriesPage() {
  const { ministries, totals, coverage } = rgsMinistriesSnapshot;
  const source = rgsMinistriesMetadata.source;

  return (
    <main className="shell page">
      <div className="page-intro">
        <h1>Spese dei Ministeri</h1>
        <p>
          Il rendiconto dello Stato 2025 copre 15 Ministeri. Qui seguiamo il quadro di
          competenza dell&apos;anno: separiamo Pagato CP da Rimasto da pagare CP e mostriamo
          come insieme formano il Totale CP. Non includiamo Palazzo Chigi, Camera, Senato o Regioni.
        </p>
      </div>

      <section className={styles.frameSection} aria-labelledby="quadro-cp" data-institutional-section>
        <div className={styles.sectionHeader}>
          <div>
            <h2 id="quadro-cp">Due componenti del Totale CP</h2>
            <p>
              Pagato CP è il pagamento in conto competenza. Rimasto da pagare CP è la voce RGS
              che completa il Totale CP: non è un totale di cassa e, da sola, non misura un
              debito da pagare.
            </p>
          </div>
          <span>Consuntivo · EUR</span>
        </div>
        <p className={styles.definitionNote}>
          <strong>Economie-Maggiori spese CP</strong>
          Nella fonte indica l&apos;importo di competenza rimasto inutilizzato rispetto alle
          previsioni o utilizzato oltre i limiti. È una voce diversa da Rimasto da pagare CP.
        </p>
        <dl className="stat-strip">
          <div>
            <dt>Totale CP</dt>
            <dd>{compactEuro(euro(totals.commitmentsCpCents))}</dd>
            <span className="stat-note">{exactEuro(euro(totals.commitmentsCpCents))} esatti</span>
          </div>
          <div>
            <dt>Pagato CP</dt>
            <dd>{compactEuro(euro(totals.paymentsCompetenceCpCents))}</dd>
            <span className="stat-note">{exactEuro(euro(totals.paymentsCompetenceCpCents))} esatti</span>
          </div>
          <div>
            <dt>Rimasto da pagare CP</dt>
            <dd>{compactEuro(euro(totals.remainingCpCents))}</dd>
            <span className="stat-note">{exactEuro(euro(totals.remainingCpCents))} esatti</span>
          </div>
        </dl>
      </section>

      <section className="panel" aria-labelledby="composizione-cp" data-institutional-section>
        <div className={styles.sectionHeader}>
          <div>
            <h2 id="composizione-cp">Come si distribuisce il Totale CP</h2>
            <p>
              La superficie di ogni riquadro mostra il peso di un Ministero nello stesso
              rendiconto e nello stesso quadro di competenza.
            </p>
          </div>
          <span>15 Ministeri</span>
        </div>
        <MinistryCommitmentTreemap ministries={ministries} />
      </section>

      <section className="panel" aria-labelledby="elenco-ministeri" data-institutional-section>
        <div className={styles.sectionHeader}>
          <div>
            <h2 id="elenco-ministeri">Valori esatti per Ministero</h2>
            <p>
              Totale CP è mostrato accanto alle sue due componenti: Pagato CP e Rimasto da pagare CP. Gli
              importi sono in euro e derivano da centesimi interi.
            </p>
          </div>
          <span>5.395 righe riconciliate</span>
        </div>
        <p className={styles.scrollHint}>Scorri la tabella verso destra per vedere tutti gli importi.</p>

        <div
          className={`table-scroll ${styles.ministryTable}`}
          role="region"
          aria-label="Valori esatti dei Ministeri nel rendiconto RGS 2025"
          tabIndex={0}
        >
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Ministero</th>
                <th scope="col">Totale CP</th>
                <th scope="col">Pagato CP</th>
                <th scope="col">Rimasto da pagare CP</th>
              </tr>
            </thead>
            <tbody>
              {ministries.map((ministry) => {
                const identity = getStateAdministrationIdentity(String(Number(ministry.code)), ministry.label);
                return (
                  <tr key={ministry.code}>
                    <th scope="row">
                      {ministry.label}
                      <small>Codice RGS {ministry.code} · IPA {identity?.ipaCode ?? "non collegato"}</small>
                    </th>
                    <td>{exactEuro(euro(ministry.commitmentsCpCents))}</td>
                    <td>{exactEuro(euro(ministry.paymentsCompetenceCpCents))}</td>
                    <td>{exactEuro(euro(ministry.remainingCpCents))}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row">Totale dei 15 Ministeri</th>
                <td>{exactEuro(euro(totals.commitmentsCpCents))}</td>
                <td>{exactEuro(euro(totals.paymentsCompetenceCpCents))}</td>
                <td>{exactEuro(euro(totals.remainingCpCents))}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </section>

      <section className="panel" aria-labelledby="fonte-ministeri" data-institutional-section>
        <h2 className="panel-title" id="fonte-ministeri">Fonte, perimetro e controlli</h2>
        <div className={styles.provenance}>
          <div><span>Titolare</span><strong>{source.owner}</strong></div>
          <div><span>Rilascio aggiornato</span><strong>{longDate(source.updatedAt)}</strong></div>
          <div><span>Controllato da noi</span><strong>{longDate(source.acquiredAt)}</strong></div>
          <div>
            <span>Copertura</span>
            <strong>{coverage.ministries} Ministeri · {coverage.rowsReconciled.toLocaleString("it-IT")} righe su {coverage.sourceRows.toLocaleString("it-IT")}</strong>
          </div>
        </div>
        <p className={styles.sourceNote}>
          Abbiamo verificato le 41 colonne e tutte le identità contabili prima di aggregare.
          Ogni importo è convertito in centesimi interi senza arrotondamenti intermedi; tutte
          le {coverage.sourceRows.toLocaleString("it-IT")} righe sorgente sono incluse. Nel quadro
          mostrato, Totale CP coincide esattamente con Pagato CP più Rimasto CP. Fonte {source.sourceRecordId},
          licenza {source.licenseName} dichiarata sulla scheda di questo rilascio.
        </p>
        <div className={styles.sourceLinks}>
          <a href={source.landingUrl} target="_blank" rel="noreferrer">Apri la scheda RGS ↗</a>
          <a href={source.resourceUrl} target="_blank" rel="noreferrer">Scarica il CSV ufficiale ↗</a>
        </div>
      </section>
    </main>
  );
}
