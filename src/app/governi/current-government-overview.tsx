import type { GovernmentCurrentSignalsView } from "@/lib/government-current-signals";
import { ChartDataTable } from "@/components/charts/chart-data-table";
import { CurrentGovernmentSignals } from "./current-government-signals";
import { GovernmentIndicatorChart } from "./government-indicator-chart";
import { formatScore, italySourceCodes, rawChangeLabel, relativeChangeLabel, sourceValue } from "./government-scorecard-format";
import styles from "./current-government-overview.module.css";

type CountryKey = "italy" | "france" | "germany" | "spain";

type Indicator = Readonly<{
  id: string;
  label: string;
  area: string;
  limitations: string;
  direction: "higher" | "lower";
  transformation: "log-change" | "point-change";
  unit: string;
  sourceCodes: Readonly<Record<CountryKey, readonly string[]>>;
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
  robustness: Readonly<{
    minimumScore: number;
    maximumScore: number;
    maximumDeviation: number;
    label: string;
    checks: readonly unknown[];
  }>;
}>;

export type AmecoCitation = Readonly<{
  release: string;
  landingUrl: string;
  observedThrough: number;
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

const MOVEMENT_EPSILON = 0.05;

function movement(value: number) {
  if (Math.abs(value) < MOVEMENT_EPSILON) return { state: "flat", label: "→ Stabile" } as const;
  return value > 0
    ? { state: "up", label: "↑ Migliora" } as const
    : { state: "down", label: "↓ Peggiora" } as const;
}

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

function levelChange(indicator: Indicator, point: Indicator["series"][number], country: CountryKey) {
  const start = indicator.series[0]?.[country];
  if (start == null) return 0;
  return indicator.transformation === "log-change"
    ? 100 * (Math.log(point[country]) - Math.log(start))
    : point[country] - start;
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
  const italyLevel = indicator.series.map((point) => levelChange(indicator, point, "italy"));
  const peersLevel = indicator.series.map((point) => median([
    levelChange(indicator, point, "france"),
    levelChange(indicator, point, "germany"),
    levelChange(indicator, point, "spain"),
  ]));
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
    <>
      <svg className={styles.sparkline} viewBox="0 0 240 64" role="img" aria-label={`${indicator.label}: andamento dal ${indicator.series[0]?.year} al ${indicator.series.at(-1)?.year}, Italia e mediana dei peer. Nel grafico verso l’alto significa miglioramento.`}>
        <line x1="8" x2="232" y1={zeroY} y2={zeroY} className={styles.zeroLine} />
        <polyline points={sparklinePoints(peers, minimum, maximum)} className={styles.peerLine} />
        <polyline points={sparklinePoints(italy, minimum, maximum)} className={styles.italyLine} />
      </svg>
      <div className={styles.chartPeriod}>
        <span>Periodo del grafico</span>
        <strong>{indicator.series[0]?.year} → {indicator.series.at(-1)?.year}</strong>
      </div>
      <p className={styles.chartHint}>Nel grafico verso l’alto significa miglioramento, anche se il livello scende.</p>
      <ChartDataTable
        label={`${indicator.label}: variazione di livello annuale di Italia e mediana di Francia, Germania e Spagna; stesso segno della variazione nel mandato`}
        columns={["Italia · variazione di livello", "Mediana peer · variazione di livello"]}
        rows={indicator.series.map((point, index) => ({
          label: `Anno ${point.year}`,
          values: [
            relativeChangeLabel({ relativeChange: italyLevel[index] ?? 0, transformation: indicator.transformation }),
            relativeChangeLabel({ relativeChange: peersLevel[index] ?? 0, transformation: indicator.transformation }),
          ],
        }))}
      />
    </>
  );
}

function comparisonLabel(indicator: Indicator) {
  const suffix = indicator.transformation === "log-change" ? "%" : " punti";
  const distance = Math.abs(indicator.relativeChange).toLocaleString("it-IT", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
  if (Math.abs(indicator.relativeChange) < 0.05) return "In linea con i peer";
  const peer = `${indicator.relativeChange > 0 ? "Meglio" : "Peggio"} dei peer di ${distance}${suffix}`;
  if (indicator.orientedChange < -MOVEMENT_EPSILON && indicator.relativeChange > MOVEMENT_EPSILON) {
    return `${peer}. Il livello italiano è sceso, i peer di più`;
  }
  return peer;
}

function currentValueLabel(indicator: Indicator) {
  if (indicator.id === "real_compensation") {
    return `Indice ${indicator.endValue.toLocaleString("it-IT", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}`;
  }
  return sourceValue(indicator.endValue, indicator.id);
}

function currentValueMeaning(indicator: Indicator, endYear: number) {
  if (indicator.id === "real_compensation") {
    const distance = Math.abs(indicator.endValue - 100).toLocaleString("it-IT", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
    return `2020 = 100: nel ${endYear} è ${distance}% ${indicator.endValue >= 100 ? "sopra" : "sotto"} quel livello.`;
  }
  return `Valore osservato nel ${endYear}`;
}

export function CurrentGovernmentOverview({
  governmentName,
  calculation,
  currentSignals,
  ameco,
}: {
  governmentName: string;
  calculation: Calculation;
  currentSignals: GovernmentCurrentSignalsView;
  ameco: AmecoCitation;
}) {
  const improved = calculation.indicators.filter((indicator) => indicator.orientedChange >= MOVEMENT_EPSILON).length;
  const aheadOfPeers = calculation.indicators.filter((indicator) => indicator.relativeChange >= MOVEMENT_EPSILON).length;

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
            <span><i data-series="peer" />Mediana peer (Francia, Germania, Spagna)</span>
          </div>
        </div>

        <p className={styles.summaryDefinition}>Il risultato combina per metà l’andamento dell’Italia rispetto alla propria storia e per metà l’andamento rispetto a Francia, Germania e Spagna negli stessi anni. Descrive il periodo, non prova da solo l’effetto del governo.</p>

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
            <dt>Risultato nel periodo</dt>
            <dd>{formatScore(calculation.score)}<small>/100</small></dd>
          </div>
        </dl>

        <dl className={styles.robustnessStrip} aria-label="Controlli di robustezza e attribuzione">
          <div>
            <dt>Intervallo stress test</dt>
            <dd>
              {formatScore(calculation.robustness.minimumScore)} a {formatScore(calculation.robustness.maximumScore)}
              <small>{calculation.robustness.checks.length} prove su pesi, indicatori e peer</small>
            </dd>
          </div>
          <div>
            <dt>Sensibilità</dt>
            <dd>
              {calculation.robustness.label}
              <small>scarto massimo ±{formatScore(calculation.robustness.maximumDeviation)} punti</small>
            </dd>
          </div>
          <div>
            <dt>Attribuzione al governo</dt>
            <dd>
              Non stimata
              <small>il numero descrive il periodo, non prova causalità</small>
            </dd>
          </div>
        </dl>
        <p className={styles.computedNote}>
          Il risultato, lo stress test e i conteggi sui sei indicatori sono un indice calcolato dal sito con AMECO {ameco.release} (osservati al {ameco.observedThrough}). Non è un voto pubblicato dalla Commissione.{" "}
          <a href={ameco.landingUrl} target="_blank" rel="noreferrer">Dataset AMECO <span aria-hidden="true">↗</span></a>
        </p>

        <div className={styles.indicatorGrid}>
          {calculation.indicators.map((indicator) => {
            const copy = INDICATOR_COPY[indicator.id] ?? {
              label: indicator.label,
              group: "Economia",
              question: indicator.limitations,
            };
            const trend = movement(indicator.orientedChange);
            const peerPosition = Math.abs(indicator.relativeChange) < MOVEMENT_EPSILON
              ? "aligned"
              : indicator.relativeChange > 0 ? "ahead" : "behind";
            return (
              <article className={styles.indicatorCard} key={indicator.id} data-result={trend.state}>
                <div className={styles.cardHeading}>
                  <div>
                    <span>{copy.group}</span>
                    <h3>{copy.label}</h3>
                  </div>
                  <b>{trend.label}</b>
                </div>
                <p>{copy.question}</p>
                <div className={styles.valueRow}>
                  <div className={styles.changeValue}>
                    <span>Variazione nel mandato</span>
                    <strong>{rawChangeLabel(indicator)}</strong>
                    <small>dal {calculation.baselineYear} al {calculation.endYear}</small>
                  </div>
                  <div className={styles.currentValue}>
                    <span>Valore attuale</span>
                    <strong>{currentValueLabel(indicator)}</strong>
                    <small>{currentValueMeaning(indicator, calculation.endYear)}</small>
                  </div>
                </div>
                <TrendSparkline indicator={indicator} />
                <div className={styles.cardFooter}>
                  <span>Era {sourceValue(indicator.baselineValue, indicator.id)}</span>
                  <b data-peer={peerPosition}>{comparisonLabel(indicator)}</b>
                </div>
                <p className={styles.sourceLine}>
                  <a href={ameco.landingUrl} target="_blank" rel="noreferrer">
                    Fonte: AMECO · {italySourceCodes(indicator.sourceCodes)} · {ameco.release}
                  </a>
                </p>
              </article>
            );
          })}
        </div>
      </section>

      <CurrentGovernmentSignals data={currentSignals} />
    </>
  );
}

export function CurrentGovernmentPeerComparison({
  indicators,
  baselineYear,
}: {
  indicators: readonly Indicator[];
  baselineYear: number;
}) {
  return (
      <section className={styles.peerSection} aria-labelledby="confronto-peer">
        <div className={styles.peerHeading}>
          <div>
            <span>Italia contro economie nello stesso periodo</span>
            <h2 id="confronto-peer">Confronto con Francia, Germania e Spagna</h2>
          </div>
          <p>Scegli un indicatore. Lo zero è il {baselineYear}; più in alto significa miglioramento.</p>
        </div>
        <GovernmentIndicatorChart indicators={indicators} />
      </section>
  );
}
