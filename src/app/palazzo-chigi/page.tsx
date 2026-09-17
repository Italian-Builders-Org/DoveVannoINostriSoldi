import type { Metadata } from "next";
import { compactEuro, exactEuro, longDate } from "@/lib/format";
import {
  pcmFinancialMetadata,
  pcmFinancialSnapshot,
} from "@/lib/pcm-financial-snapshot";
import { PcmMissionTreemap } from "./pcm-mission-treemap";
import styles from "./palazzo-chigi.module.css";

export const metadata: Metadata = {
  title: "Spese di Palazzo Chigi, rendiconto 2024",
  description:
    "Soldi impegnati e pagati dalla Presidenza del Consiglio nel rendiconto ufficiale 2024, con fonte e numeri separati.",
};

function euro(cents: number): number {
  return cents / 100;
}

const percentage = new Intl.NumberFormat("it-IT", {
  style: "percent",
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

function missionLabel(label: string): string {
  return label === "0" ? "Voce senza descrizione nella fonte" : label;
}

export default function PalazzoChigiPage() {
  const data = pcmFinancialSnapshot;
  const source = pcmFinancialMetadata.source;

  return (
    <main className="shell page">
      <div className="page-intro">
        <h1>Spese di Palazzo Chigi</h1>
        <p>
          Il rendiconto 2024 riguarda soltanto la Presidenza del Consiglio dei ministri.
          Mostriamo separatamente quanto è stato impegnato e quanto è stato pagato, senza
          sommarlo ai ministeri o al Parlamento.
        </p>
      </div>

      <dl className="stat-strip">
        <div>
          <dt>Pagato nel 2024</dt>
          <dd>{compactEuro(euro(data.totals.paymentsTotalCents))}</dd>
          <span className="stat-note">
            {exactEuro(euro(data.totals.paymentsTotalCents))} esatti
          </span>
        </div>
        <div>
          <dt>Impegnato nel 2024</dt>
          <dd>{compactEuro(euro(data.totals.commitmentsCents))}</dd>
          <span className="stat-note">
            {exactEuro(euro(data.totals.commitmentsCents))} esatti
          </span>
        </div>
        <div>
          <dt>Periodo e copertura</dt>
          <dd>{data.referenceYear}</dd>
          <span className="stat-note">
            {data.coverage.sourceRows.toLocaleString("it-IT")} righe riconciliate
          </span>
        </div>
      </dl>

      <div className="notice">
        <strong>Tre numeri diversi</strong>
        <p>
          <strong>Disponibile</strong>: in bilancio.
          <strong> Impegnato</strong>: deciso da spendere.
          <strong> Pagato</strong>: davvero uscito nel 2024.
        </p>
      </div>

      <section className={styles.phaseGrid} aria-labelledby="fasi-contabili">
        <div className={styles.phaseHeading}>
          <h2 id="fasi-contabili">Come si compone il pagato</h2>
          <p>
            Il file separa i pagamenti legati all&apos;anno 2024 da quelli che chiudono
            debiti degli anni precedenti.
          </p>
        </div>
        <dl className={styles.phaseValues}>
          <div>
            <dt>Pagamenti dell&apos;anno 2024</dt>
            <dd>{exactEuro(euro(data.totals.paymentsCurrentCents))}</dd>
            <span>Uscite su impegni presi nello stesso anno.</span>
          </div>
          <div>
            <dt>Pagamenti di anni precedenti</dt>
            <dd>{exactEuro(euro(data.totals.paymentsResidualCents))}</dd>
            <span>Uscite su impegni presi prima del 2024.</span>
          </div>
          <div>
            <dt>Disponibile in bilancio</dt>
            <dd>{exactEuro(euro(data.totals.finalCompetenceAppropriationCents))}</dd>
            <span>Quanto restava a disposizione in bilancio.</span>
          </div>
        </dl>
      </section>

      <section className="panel" aria-labelledby="missioni-pcm">
        <div className={styles.sectionHeader}>
          <div>
            <h2 id="missioni-pcm">Per cosa sono stati pagati</h2>
            <p>Ogni area di lavoro raccoglie i capitoli di spesa collegati a quella funzione.</p>
          </div>
          <span>{data.missions.length} aree nel file</span>
        </div>
        <PcmMissionTreemap
          missions={data.missions}
          totalCents={data.totals.paymentsTotalCents}
        />
        <p className={styles.scrollHint}>Scorri la tabella verso destra per vedere importi e quote.</p>
        <div
          className={`table-scroll ${styles.exactTable}`}
          role="region"
          aria-label="Valori esatti dei pagamenti di Palazzo Chigi per area di lavoro"
          tabIndex={0}
        >
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Area di lavoro</th>
                <th scope="col">Pagato nel 2024</th>
                <th scope="col">Quota del pagato</th>
              </tr>
            </thead>
            <tbody>
              {data.missions.map((mission) => (
                <tr key={mission.code}>
                  <th scope="row">
                    {missionLabel(mission.label)}
                    <small>Codice {mission.code}</small>
                  </th>
                  <td>{exactEuro(euro(mission.paymentsCents))}</td>
                  <td>{percentage.format(mission.paymentsCents / data.totals.paymentsTotalCents)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row">Totale Palazzo Chigi</th>
                <td>{exactEuro(euro(data.totals.paymentsTotalCents))}</td>
                <td>{percentage.format(1)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </section>

      <section className="panel" aria-labelledby="fonte-pcm">
        <h2 className="panel-title" id="fonte-pcm">Fonte e controlli</h2>
        <div className={styles.provenance}>
          <div>
            <span>Titolare</span>
            <strong>{source.owner}</strong>
          </div>
          <div>
            <span>Pubblicato</span>
            <strong>{longDate(source.publishedAt)}</strong>
          </div>
          <div>
            <span>Acquisito da noi</span>
            <strong>{longDate(source.acquiredAt)}</strong>
          </div>
          <div>
            <span>File verificato</span>
            <strong>{pcmFinancialMetadata.asset.bytes.toLocaleString("it-IT")} byte · XLSX</strong>
          </div>
        </div>
        <p className={styles.sourceNote}>
          Abbiamo escluso una riga vuota, convertito gli importi in centesimi e riconciliato tutte
          le 572 righe con la formula del file: impegnato = pagato dell&apos;anno + ancora da
          pagare. La pagina ufficiale non dichiara una licenza per il workbook.
        </p>
        <div className={styles.sourceLinks}>
          <a href={source.resourceUrl} target="_blank" rel="noreferrer">Scarica il file ufficiale XLSX ↗</a>
          <a href={source.landingUrl} target="_blank" rel="noreferrer">Apri il rendiconto PCM ↗</a>
        </div>
      </section>
    </main>
  );
}
