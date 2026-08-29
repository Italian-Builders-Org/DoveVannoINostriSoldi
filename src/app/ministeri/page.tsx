import type { Metadata } from "next";
import { getStateAdministrationIdentity } from "@/lib/data/state-administration-identities";
import { compactEuro, exactEuro, longDate } from "@/lib/format";
import { rgsMinistriesMetadata, rgsMinistriesSnapshot } from "@/lib/rgs-ministries-snapshot";
import { MinistryCommitmentTreemap } from "./ministry-commitment-treemap";
import styles from "./ministeri.module.css";

export const metadata: Metadata = {
  title: "Spese dei Ministeri, rendiconto 2025",
  description:
    "Totale impegnato, già pagato e ancora da pagare dei 15 ministeri nel rendiconto ufficiale RGS 2025, con valori esatti.",
};

const euro = (cents: number) => cents / 100;

const percentage = new Intl.NumberFormat("it-IT", {
  style: "percent",
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

export default function MinistriesPage() {
  const { ministries, totals, coverage } = rgsMinistriesSnapshot;
  const source = rgsMinistriesMetadata.source;

  return (
    <main className="shell page">
      <div className="page-intro">
        <h1>Spese dei Ministeri</h1>
        <p>
          Il rendiconto dello Stato 2025 copre 15 ministeri. Qui vedi tre numeri:
          quanto hanno impegnato nell&apos;anno, quanto hanno già pagato, e quanto resta
          da pagare. Non includiamo Palazzo Chigi, Camera, Senato o Regioni.
        </p>
      </div>

      <section className={styles.frameSection} aria-labelledby="quadro-cp" data-institutional-section>
        <div className={styles.sectionHeader}>
          <div>
            <h2 id="quadro-cp">Già pagato e ancora da pagare</h2>
            <p>
              <strong>Già pagato</strong> è uscito nel 2025. <strong>Ancora da pagare</strong> è
              impegnato ma non ancora uscito. Insieme formano il totale impegnato: somma di già
              pagato e ancora da pagare nell&apos;anno (nella fonte: Totale CP = Pagato CP + Rimasto
              da pagare CP).
            </p>
          </div>
          <span>Consuntivo · EUR</span>
        </div>
        <p className={styles.definitionNote}>
          <strong>Economie / maggiori spese</strong>
          Nella fonte indica soldi dell&apos;anno non usati rispetto al piano, oppure usati oltre
          i limiti. È una voce diversa da “ancora da pagare”.
        </p>
        <dl className="stat-strip">
          <div>
            <dt>Totale impegnato</dt>
            <dd>{compactEuro(euro(totals.commitmentsCpCents))}</dd>
            <span className="stat-note">
              {exactEuro(euro(totals.commitmentsCpCents))} esatti · Totale CP
            </span>
          </div>
          <div>
            <dt>Già pagato</dt>
            <dd>{compactEuro(euro(totals.paymentsCompetenceCpCents))}</dd>
            <span className="stat-note">
              {exactEuro(euro(totals.paymentsCompetenceCpCents))} esatti · Pagato CP
            </span>
          </div>
          <div>
            <dt>Ancora da pagare</dt>
            <dd>{compactEuro(euro(totals.remainingCpCents))}</dd>
            <span className="stat-note">
              {exactEuro(euro(totals.remainingCpCents))} esatti · Rimasto da pagare CP
            </span>
          </div>
        </dl>
      </section>

      <section className="panel" aria-labelledby="composizione-cp" data-institutional-section>
        <div className={styles.sectionHeader}>
          <div>
            <h2 id="composizione-cp">Come si spezza il totale tra i ministeri</h2>
            <p>
              La superficie di ogni riquadro mostra quanto pesa un ministero sullo stesso
              rendiconto e sullo stesso totale impegnato.
            </p>
          </div>
          <span>15 Ministeri</span>
        </div>
        <MinistryCommitmentTreemap ministries={ministries} />
      </section>

      <section className="panel" aria-labelledby="elenco-ministeri" data-institutional-section>
        <div className={styles.sectionHeader}>
          <div>
            <h2 id="elenco-ministeri">Valori esatti per ministero</h2>
            <p>
              Totale impegnato accanto a già pagato e ancora da pagare. Gli importi sono in euro
              e partono da centesimi interi.
            </p>
          </div>
          <span>5.395 righe riconciliate</span>
        </div>
        <p className={styles.scrollHint}>Scorri la tabella verso destra per vedere tutti gli importi.</p>

        <div
          className={`table-scroll ${styles.ministryTable}`}
          role="region"
          aria-label="Valori esatti dei ministeri nel rendiconto RGS 2025"
          tabIndex={0}
        >
          <table className="table">
            <caption className="table-caption">Valori contabili dei ministeri: impegnato, pagato e residuo</caption>
            <thead>
              <tr>
                <th scope="col">Ministero</th>
                <th scope="col">
                  Totale impegnato
                  <small>Totale CP</small>
                </th>
                <th scope="col">Quota</th>
                <th scope="col">
                  Già pagato
                  <small>Pagato CP</small>
                </th>
                <th scope="col">
                  Ancora da pagare
                  <small>Rimasto da pagare CP</small>
                </th>
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
                    <td>{percentage.format(ministry.commitmentsCpCents / totals.commitmentsCpCents)}</td>
                    <td>{exactEuro(euro(ministry.paymentsCompetenceCpCents))}</td>
                    <td>{exactEuro(euro(ministry.remainingCpCents))}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row">Totale dei 15 ministeri</th>
                <td>{exactEuro(euro(totals.commitmentsCpCents))}</td>
                <td>{percentage.format(1)}</td>
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
          mostrato, il totale impegnato coincide esattamente con già pagato più ancora da pagare
          (Totale CP = Pagato CP + Rimasto CP). Fonte {source.sourceRecordId},
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
