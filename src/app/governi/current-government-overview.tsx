import { GovernmentIndicatorChart } from "./government-indicator-chart";
import { formatScore, rawChangeLabel, sourceValue } from "./government-scorecard-format";
import styles from "./current-government-overview.module.css";

type CountryKey = "italy" | "france" | "germany" | "spain";

type Indicator = Readonly<{
  id: string;
  label: string;
  area: string;
  limitations: string;
  direction: "higher" | "lower";
  transformation: "log-change" | "point-change";
  baselineValue: number;
  endValue: number;
  rawChange: number;
  orientedChange: number;
  relativeChange: number;
  series: readonly Readonly<Record<CountryKey, number> & { year: number }>[];
}>;

type Calculation = Readonly<{
  baselineYear: number;
  endYear: number;
  score: number;
  indicators: readonly Indicator[];
}>;

const INDICATOR_COPY: Readonly<Record<string, { label: string; group: string; question: string }>> = {
  real_compensation: {
    label: "Stipendi reali",
    group: "Cittadini",
    question: "Quanto vale davvero lo stipendio dopo l’inflazione?",
  },
  unemployment: {
    label: "Disoccupazione",
    group: "Cittadini",
    question: "Quante persone cercano lavoro e non lo trovano?",
  },
  real_gdp_per_capita: {
    label: "Economia per abitante",
    group: "Cittadini",
    question: "La ricchezza prodotta per persona sta aumentando?",
  },
  investment_share: {
    label: "Investimenti",
    group: "Futuro",
    question: "Quanta economia viene destinata alla capacità futura?",
  },
  debt_ratio: {
    label: "Debito pubblico",
    group: "Stabilità",
    question: "Il peso del debito rispetto all’economia sta scendendo?",
  },
  primary_balance: {
    label: "Saldo primario",
    group: "Stabilità",
    question: "Lo Stato copre la spesa corrente prima degli interessi?",
  },
};

function median(values: readonly number[]) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

function improvement(indicator: Indicator, point: Indicator["series"][number], country: CountryKey) {
  const start = indicator.series[0]?.[country];
  if (start == null) return 0;
  const direction = indicator.direction === "higher" ? 1 : -1;
  return indicator.transformation === "log-change"
    ? direction * 100 * (Math.log(point[country]) - Math.log(start))
    : direction * (point[country] - start);
}

function sparklinePoints(values: readonly number[], minimum: number, maximum: number) {
  const range = maximum - minimum || 1;
  return values.map((value, index) => {
    const x = values.length === 1 ? 120 : 8 + index * (224 / (values.length - 1));
    const y = 54 - ((value - minimum) / range) * 44;
    return `${x},${y}`;
  }).join(" ");
}

function TrendSparkline({ indicator }: { indicator: Indicator }) {
  const italy = indicator.series.map((point) => improvement(indicator, point, "italy"));
  const peers = indicator.series.map((point) => median([
    improvement(indicator, point, "france"),
    improvement(indicator, point, "germany"),
    improvement(indicator, point, "spain"),
  ]));
  const minimum = Math.min(0, ...italy, ...peers);
  const maximum = Math.max(0, ...italy, ...peers);
  const zeroY = 54 - ((0 - minimum) / (maximum - minimum || 1)) * 44;

  return (
    <svg className={styles.sparkline} viewBox="0 0 240 64" role="img" aria-label={`${indicator.label}: andamento Italia e mediana dei peer`}>
      <line x1="8" x2="232" y1={zeroY} y2={zeroY} className={styles.zeroLine} />
      <polyline points={sparklinePoints(peers, minimum, maximum)} className={styles.peerLine} />
      <polyline points={sparklinePoints(italy, minimum, maximum)} className={styles.italyLine} />
    </svg>
  );
}

function comparisonLabel(indicator: Indicator) {
  const suffix = indicator.transformation === "log-change" ? "%" : " punti";
  const distance = Math.abs(indicator.relativeChange).toLocaleString("it-IT", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
  if (Math.abs(indicator.relativeChange) < 0.05) return "In linea con i peer";
  return `${indicator.relativeChange > 0 ? "Meglio" : "Peggio"} dei peer di ${distance}${suffix}`;
}

export function CurrentGovernmentOverview({
  governmentName,
  calculation,
}: {
  governmentName: string;
  calculation: Calculation;
}) {
  const improved = calculation.indicators.filter((indicator) => indicator.orientedChange > 0).length;
  const aheadOfPeers = calculation.indicators.filter((indicator) => indicator.relativeChange > 0).length;

  return (
    <>
      <section className={styles.summary} aria-labelledby="quadro-attuale">
        <div className={styles.summaryHeading}>
          <div>
            <span>Governo in carica · dati osservati {calculation.baselineYear}-{calculation.endYear}</span>
            <h2 id="quadro-attuale">Come sta andando con {governmentName}</h2>
          </div>
          <div className={styles.legend} aria-label="Legenda dei mini grafici">
            <span><i data-series="italy" />Italia</span>
            <span><i data-series="peer" />Mediana peer</span>
          </div>
        </div>

        <dl className={styles.summaryStats}>
          <div>
            <dt>Indicatori migliorati</dt>
            <dd>{improved}<small> su {calculation.indicators.length}</small></dd>
          </div>
          <div>
            <dt>Meglio dei peer</dt>
            <dd>{aheadOfPeers}<small> su {calculation.indicators.length}</small></dd>
          </div>
          <div>
            <dt>Core macro provvisorio</dt>
            <dd>{formatScore(calculation.score)}<small>/100</small></dd>
          </div>
        </dl>

        <div className={styles.indicatorGrid}>
          {calculation.indicators.map((indicator) => {
            const copy = INDICATOR_COPY[indicator.id] ?? {
              label: indicator.label,
              group: "Economia",
              question: indicator.limitations,
            };
            const improvedNow = indicator.orientedChange >= 0;
            const peerAhead = indicator.relativeChange >= 0;
            return (
              <article className={styles.indicatorCard} key={indicator.id} data-result={improvedNow ? "up" : "down"}>
                <div className={styles.cardHeading}>
                  <div>
                    <span>{copy.group}</span>
                    <h3>{copy.label}</h3>
                  </div>
                  <b>{improvedNow ? "↑ Migliora" : "↓ Peggiora"}</b>
                </div>
                <p>{copy.question}</p>
                <div className={styles.valueRow}>
                  <strong>{sourceValue(indicator.endValue, indicator.id)}</strong>
                  <span>{rawChangeLabel(indicator)} dal {calculation.baselineYear}</span>
                </div>
                <TrendSparkline indicator={indicator} />
                <div className={styles.cardFooter}>
                  <span>Era {sourceValue(indicator.baselineValue, indicator.id)}</span>
                  <b data-peer={peerAhead ? "ahead" : "behind"}>{comparisonLabel(indicator)}</b>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <section className={styles.peerSection} aria-labelledby="confronto-peer">
        <div className={styles.peerHeading}>
          <div>
            <span>Italia contro economie nello stesso periodo</span>
            <h2 id="confronto-peer">Confronto con Francia, Germania e Spagna</h2>
          </div>
          <p>Scegli un indicatore. Lo zero è il 2022; più in alto significa miglioramento.</p>
        </div>
        <GovernmentIndicatorChart indicators={calculation.indicators} />
      </section>
    </>
  );
}
