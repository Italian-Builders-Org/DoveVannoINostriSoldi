import type { GovernmentCurrentSignalsView } from "@/lib/government-current-signals";
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

function signedPercent(value: number) {
  return `${value > 0 ? "+" : value < 0 ? "−" : ""}${Math.abs(value).toLocaleString("it-IT", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
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

function SignalChart({ signal, startPeriod, latestPeriod }: { signal: Signal; startPeriod: string; latestPeriod: string }) {
  const italy = signal.series.map((point) => point.italy);
  const peers = signal.series.map((point) => point.peer);
  const minimum = Math.min(0, ...italy, ...peers);
  const maximum = Math.max(0, ...italy, ...peers);
  const zeroY = 54 - ((0 - minimum) / (maximum - minimum || 1)) * 44;
  return (
    <>
      <svg className={styles.signalChart} viewBox="0 0 240 64" role="img" aria-label={`${signal.label}: variazione cumulata dei prezzi da ${monthLabel(startPeriod)} a ${monthLabel(latestPeriod)}, Italia e mediana di Francia, Germania e Spagna`}>
        <line x1="8" x2="232" y1={zeroY} y2={zeroY} className={styles.zeroLine} />
        <polyline points={linePoints(peers, minimum, maximum)} className={styles.peerLine} />
        <polyline points={linePoints(italy, minimum, maximum)} className={styles.italyLine} />
      </svg>
      <div className={styles.signalPeriod}><span>{monthLabel(startPeriod)}</span><strong>→</strong><span>{monthLabel(latestPeriod)}</span></div>
    </>
  );
}

export function CurrentGovernmentSignals({ data }: { data: GovernmentCurrentSignalsView }) {
  return (
    <section className={styles.liveSignals} aria-labelledby="costo-vita-attuale">
      <div className={styles.liveHeading}>
        <div>
          <span>Dato mensile Eurostat · non entra nel voto</span>
          <h2 id="costo-vita-attuale">Costo della vita dall’insediamento a oggi</h2>
        </div>
        <div className={styles.liveMeta}>
          <p>Ultimo dato: <strong>{monthLabel(data.latestPeriod)}</strong>. La percentuale grande mostra quanto sono cambiati i prezzi da ottobre 2022.</p>
          <div className={styles.liveLegend} aria-label="Legenda dei grafici mensili">
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
              <div><span>Da ottobre 2022</span><strong>{signedPercent(signal.cumulativeChange)}</strong></div>
              <div><span>Ultimi 12 mesi</span><strong>{signedPercent(signal.latestAnnualRate)}</strong></div>
            </div>
            <SignalChart signal={signal} startPeriod={data.startPeriod} latestPeriod={data.latestPeriod} />
            <div className={styles.signalPeer}>
              <span>Mediana peer: {signedPercent(signal.peerMedianCumulativeChange)}</span>
              <b>Italia {signedPoints(signal.cumulativeDistanceFromPeers)} vs peer</b>
            </div>
            <small>{signal.limitations}</small>
          </article>
        ))}
      </div>
      <div className={styles.liveBoundary}>
        <p><strong>Questo non è un punto assegnato al governo.</strong> Descrive i prezzi osservati nello stesso periodo e li confronta con Francia, Germania e Spagna.</p>
        <a href={data.source.landingUrl} target="_blank" rel="noreferrer">Eurostat · {data.source.datasetCode} <span aria-hidden="true">↗</span></a>
      </div>
    </section>
  );
}
