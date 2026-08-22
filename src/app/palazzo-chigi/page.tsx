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
    "Impegni e pagamenti della Presidenza del Consiglio nel rendiconto ufficiale 2024, con fonte, perimetro e fasi contabili separate.",
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
          Mostriamo separatamente ciò che è stato impegnato e ciò che è stato pagato, senza
          sommarlo ai Ministeri o al Parlamento.
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
        <strong>Tre numeri diversi, tre significati diversi</strong>
        <p>
          Lo stanziamento indica quanto era disponibile. L&apos;impegno registra un&apos;obbligazione.
          Il pagamento indica quanto è uscito nel 2024. Non li sommiamo: sono fasi dello stesso
          ciclo contabile, non spese aggiuntive.
        </p>
      </div>

      <section className={styles.phaseGrid} aria-labelledby="fasi-contabili">
        <div className={styles.phaseHeading}>
          <h2 id="fasi-contabili">Come si compone il pagato</h2>
          <p>
            Il workbook distingue i pagamenti su impegni del 2024 da quelli riferiti a residui
            di esercizi precedenti.
          </p>
        </div>
        <dl className={styles.phaseValues}>
          <div>
            <dt>Conto competenza</dt>
            <dd>{exactEuro(euro(data.totals.paymentsCurrentCents))}</dd>
            <span>Pagamenti su impegni dello stesso esercizio.</span>
          </div>
          <div>
            <dt>Conto residui</dt>
            <dd>{exactEuro(euro(data.totals.paymentsResidualCents))}</dd>
            <span>Pagamenti su obbligazioni di esercizi precedenti.</span>
          </div>
          <div>
            <dt>Stanziamento definitivo di competenza</dt>
            <dd>{exactEuro(euro(data.totals.finalCompetenceAppropriationCents))}</dd>
            <span>Disponibilità finale: non è denaro già pagato.</span>
          </div>
        </dl>
      </section>

      <section className="panel" aria-labelledby="missioni-pcm">
        <div className={styles.sectionHeader}>
          <div>
            <h2 id="missioni-pcm">Pagamenti per missione</h2>
            <p>Le missioni descrivono la funzione pubblica a cui il capitolo è attribuito.</p>
          </div>
          <span>{data.missions.length} missioni nel file</span>
        </div>
        <PcmMissionTreemap
          missions={data.missions}
          totalCents={data.totals.paymentsTotalCents}
        />
        <div
          className={`table-scroll ${styles.exactTable}`}
          role="region"
          aria-label="Valori esatti dei pagamenti PCM per missione"
          tabIndex={0}
        >
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Missione</th>
                <th scope="col">Pagato nel 2024</th>
                <th scope="col">Quota del pagato PCM</th>
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
                <th scope="row">Totale PCM</th>
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
          le 572 righe con la formula del file: impegnato = pagato in conto competenza + rimasto da
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
