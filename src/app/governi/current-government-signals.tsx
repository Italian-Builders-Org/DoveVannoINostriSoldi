import type { GovernmentCurrentSignalsView } from "@/lib/government-current-signals";
import { ChartDataTable } from "@/components/charts/chart-data-table";
import styles from "./current-government-overview.module.css";

type Signal = GovernmentCurrentSignalsView["indicators"][number];

const MONTHS = [
  "gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno",
  "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre",
] as const;

function monthLabel(period: string) {
  const [year, month] = period.split("-").map(Number);
  return `${MONTHS[month - 1]} ${year}`;
}

function signedPercent(value: number, digits = 1) {
  return `${value > 0 ? "+" : value < 0 ? "−" : ""}${Math.abs(value).toLocaleString("it-IT", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}%`;
}

function signedPoints(value: number) {
  return `${value > 0 ? "+" : value < 0 ? "−" : ""}${Math.abs(value).toLocaleString("it-IT", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })} punti`;
}

function linePoints(values: readonly number[], minimum: number, maximum: number) {
  const range = maximum - minimum || 1;
  return values.map((value, index) => {
    const x = values.length === 1 ? 120 : 8 + index * (224 / (values.length - 1));
    const y = 54 - ((value - minimum) / range) * 44;
    return `${x},${y}`;
  }).join(" ");
}

function SignalChart({
  signal,
  startPeriod,
  latestPeriod,
  source,
}: {
  signal: Signal;
  startPeriod: string;
  latestPeriod: string;
  source: GovernmentCurrentSignalsView["source"];
}) {
  const italy = signal.series.map((point) => point.italy);
  const peers = signal.series.map((point) => point.peer);
  const minimum = Math.min(0, ...italy, ...peers);
  const maximum = Math.max(0, ...italy, ...peers);
  const zeroY = 54 - ((0 - minimum) / (maximum - minimum || 1)) * 44;
  const titleId = `${signal.id}-signal-chart-title`;
  const descriptionId = `${signal.id}-signal-chart-description`;
  const chartLabel = `${signal.label}: variazione cumulata dei prezzi in percentuale, da ${monthLabel(startPeriod)} a ${monthLabel(latestPeriod)}, Italia e mediana di Francia, Germania e Spagna`;
  return (
    <>
      <svg className={styles.signalChart} viewBox="0 0 240 64" role="img" aria-labelledby={`${titleId} ${descriptionId}`} aria-label={chartLabel}>
        <title id={titleId}>{chartLabel}</title>
        <desc id={descriptionId}>La linea continua è l’Italia; la linea tratteggiata è la mediana dei tre peer. I valori della serie sono disponibili nella tabella sottostante.</desc>
        <line x1="8" x2="232" y1={zeroY} y2={zeroY} className={styles.zeroLine} />
        <polyline points={linePoints(peers, minimum, maximum)} className={styles.peerLine} />
        <polyline points={linePoints(italy, minimum, maximum)} className={styles.italyLine} />
      </svg>
      <div className={styles.signalPeriod}><span>{monthLabel(startPeriod)}</span><strong>→</strong><span>{monthLabel(latestPeriod)}</span></div>
      <ChartDataTable
        label={`${signal.label}: valori mensili della variazione cumulata in percentuale; periodo ${monthLabel(startPeriod)}-${monthLabel(latestPeriod)}; fonte ${source.owner} · ${source.datasetCode}`}
        columns={["Italia · variazione cumulata (%)", "Mediana peer · variazione cumulata (%)"]}
        rows={signal.series.map((point) => ({
          label: monthLabel(point.period),
          values: [signedPercent(point.italy, 2), signedPercent(point.peer, 2)],
        }))}
      />
    </>
  );
}

export function CurrentGovernmentSignals({ data }: { data: GovernmentCurrentSignalsView }) {
  return (
    <section className={styles.liveSignals} aria-labelledby="costo-vita-attuale">
      <div className={styles.liveHeading}>
        <div>
          <span>Dato mensile Eurostat · non entra nel voto</span>
          <h2 id="costo-vita-attuale">Prezzi al consumo dall’insediamento a oggi</h2>
        </div>
        <div className={styles.liveMeta}>
          <p>Ultimo dato: <strong>{monthLabel(data.latestPeriod)}</strong>. La percentuale grande mostra quanto sono cambiati i prezzi da {monthLabel(data.startPeriod)}.</p>
          <div className={styles.liveLegend} role="group" aria-label="Legenda dei grafici mensili">
            <span><i data-series="italy" />Italia</span>
            <span><i data-series="peer" />Mediana peer</span>
          </div>
        </div>
      </div>
      <div className={styles.liveGrid}>
        {data.indicators.map((signal) => (
          <article key={signal.id} className={styles.signalCard}>
            <div className={styles.signalCardHeading}>
              <h3>{signal.label}</h3>
              <span>{signal.latestAnnualRate > 0 ? "12 mesi: in aumento" : signal.latestAnnualRate < 0 ? "12 mesi: in calo" : "12 mesi: stabili"}</span>
            </div>
            <p>{signal.question}</p>
            <div className={styles.signalValues}>
              <div><span>Da {monthLabel(data.startPeriod)} · %</span><strong>{signedPercent(signal.cumulativeChange)}</strong></div>
              <div><span>Ultimi 12 mesi · %</span><strong>{signedPercent(signal.latestAnnualRate)}</strong></div>
            </div>
            <SignalChart signal={signal} startPeriod={data.startPeriod} latestPeriod={data.latestPeriod} source={data.source} />
            <div className={styles.signalPeer}>
              <span>Mediana peer: {signedPercent(signal.peerMedianCumulativeChange)}</span>
              <b>Italia {signedPoints(signal.cumulativeDistanceFromPeers)} vs peer</b>
            </div>
            <small>Unità: variazione percentuale (%) dell’indice armonizzato. Fonte: <a href={data.source.landingUrl} target="_blank" rel="noreferrer">{data.source.owner} · {data.source.datasetCode}</a>. {signal.limitations}</small>
          </article>
        ))}
      </div>
      <div className={styles.liveBoundary}>
        <p><strong>Questo non è un punto assegnato al governo.</strong> L’IPCA confronta i prezzi fra Paesi, ma non misura il costo della vita della singola famiglia.</p>
        <a href={data.source.landingUrl} target="_blank" rel="noreferrer">Eurostat · {data.source.datasetCode} <span aria-hidden="true">↗</span></a>
      </div>
    </section>
  );
}
