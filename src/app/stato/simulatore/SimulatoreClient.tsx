"use client";

import { useId, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { MissionEnactedAllocation } from "@/lib/bdap-legge-bilancio";
import { ChartDataTable } from "@/components/charts/chart-data-table";
import styles from "./simulatore.module.css";

const exactEuro = new Intl.NumberFormat("it-IT", {
  style: "currency",
  currency: "EUR",
  maximumFractionDigits: 0,
  useGrouping: "always",
});

function compactEuro(value: number): string {
  const absolute = Math.abs(value);
  if (absolute >= 1_000_000_000) {
    return `${(value / 1_000_000_000).toLocaleString("it-IT", { maximumFractionDigits: 1 })} mld €`;
  }
  if (absolute >= 1_000_000) {
    return `${(value / 1_000_000).toLocaleString("it-IT", { maximumFractionDigits: 1 })} mln €`;
  }
  return exactEuro.format(value);
}

function signedPercent(value: number): string {
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toLocaleString("it-IT", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
}

const SLIDER_MIN = -50;
const SLIDER_MAX = 50;
const SLIDER_STEP = 1;

type ChartPoint = {
  year: number;
  observedAmountEur: number;
  hypotheticalAmountEur: number | null;
};

function ScenarioTooltip({
  active,
  payload,
  isLatestYear,
}: {
  active?: boolean;
  payload?: Array<{ payload?: ChartPoint }>;
  isLatestYear: (year: number) => boolean;
}) {
  if (!active || !payload?.length) return null;
  const point = payload[0]?.payload;
  if (!point) return null;

  return (
    <div className={styles.tooltip}>
      <strong>{point.year}</strong>
      <span>
        Stanziamento pubblicato <b>{exactEuro.format(point.observedAmountEur)}</b>
      </span>
      {isLatestYear(point.year) && point.hypotheticalAmountEur !== null ? (
        <span className={styles.tooltipHypothetical}>
          Scenario ipotetico (non reale) <b>{exactEuro.format(point.hypotheticalAmountEur)}</b>
        </span>
      ) : null}
    </div>
  );
}

export function SimulatoreClient({
  years,
  missions,
  allocations,
}: {
  years: number[];
  missions: string[];
  allocations: MissionEnactedAllocation[];
}) {
  const patternId = useId();
  const [selectedMission, setSelectedMission] = useState(missions[0] ?? "");
  const [sliderPct, setSliderPct] = useState(0);

  const series = useMemo(
    () =>
      allocations
        .filter((allocation) => allocation.mission === selectedMission)
        .sort((left, right) => left.year - right.year),
    [allocations, selectedMission],
  );

  const latest = series.at(-1) ?? null;
  const previous = series.length > 1 ? series.at(-2)! : null;
  const hypotheticalAmountEur = latest ? latest.amountEur * (1 + sliderPct / 100) : null;

  const chartData: ChartPoint[] = series.map((point) => ({
    year: point.year,
    observedAmountEur: point.amountEur,
    hypotheticalAmountEur: point.year === latest?.year ? hypotheticalAmountEur : null,
  }));

  const realDeltaPct = previous && previous.amountEur !== 0
    ? ((latest!.amountEur - previous.amountEur) / previous.amountEur) * 100
    : null;
  const scenarioVsRealPct = latest && latest.amountEur !== 0 && hypotheticalAmountEur !== null
    ? ((hypotheticalAmountEur - latest.amountEur) / latest.amountEur) * 100
    : null;

  if (missions.length === 0 || !latest) {
    return (
      <div className={styles.errorState} role="alert">
        <strong>Nessuna missione disponibile in questa finestra di anni.</strong>
      </div>
    );
  }

  return (
    <div className={styles.simulator}>
      <div className={styles.controls}>
        <label className={styles.controlField}>
          <span>Missione</span>
          <select
            className="input"
            value={selectedMission}
            onChange={(event) => setSelectedMission(event.target.value)}
          >
            {missions.map((mission) => (
              <option key={mission} value={mission}>
                {mission}
              </option>
            ))}
          </select>
        </label>

        <label className={styles.controlField}>
          <span>
            Scenario ipotetico sull&apos;ultimo stanziamento ({latest.year}):{" "}
            <b className={styles.sliderValue}>{signedPercent(sliderPct)}</b>
          </span>
          <input
            className={styles.slider}
            type="range"
            min={SLIDER_MIN}
            max={SLIDER_MAX}
            step={SLIDER_STEP}
            value={sliderPct}
            onChange={(event) => setSliderPct(Number(event.target.value))}
            aria-label={`Variazione ipotetica percentuale sullo stanziamento ${latest.year} di ${selectedMission}`}
            aria-valuetext={signedPercent(sliderPct)}
          />
        </label>

        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => setSliderPct(0)}
          disabled={sliderPct === 0}
        >
          Azzera scenario
        </button>
      </div>

      <figure className={styles.figure}>
        <div className={styles.figureHeader}>
          <div>
            <span>STANZIAMENTO PUBBLICATO · LEGGE DI BILANCIO</span>
            <h2>{selectedMission}</h2>
          </div>
          <b>{years[0]}-{years.at(-1)}</b>
        </div>

        <div
          className={styles.chart}
          role="img"
          aria-label={`Stanziamento pubblicato per la missione ${selectedMission} dal ${years[0]} al ${years.at(-1)}, con lo scenario ipotetico impostato a ${signedPercent(sliderPct)} sull'ultimo anno`}
        >
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} margin={{ top: 12, right: 16, bottom: 0, left: 4 }} accessibilityLayer>
              <defs>
                <pattern
                  id={patternId}
                  patternUnits="userSpaceOnUse"
                  width="6"
                  height="6"
                  patternTransform="rotate(45)"
                >
                  <rect width="6" height="6" fill="var(--color-accent-100)" />
                  <line x1="0" y1="0" x2="0" y2="6" stroke="var(--color-accent-600)" strokeWidth="2" />
                </pattern>
              </defs>
              <CartesianGrid vertical={false} stroke="var(--color-neutral-300)" />
              <XAxis
                dataKey="year"
                axisLine={false}
                tickLine={false}
                tick={{ fill: "var(--color-neutral-600)", fontSize: 11 }}
              />
              <YAxis
                axisLine={false}
                tickLine={false}
                width={72}
                tick={{ fill: "var(--color-neutral-600)", fontSize: 11 }}
                tickFormatter={compactEuro}
              />
              <Tooltip
                animationDuration={120}
                cursor={{ fill: "var(--color-neutral-100)" }}
                content={<ScenarioTooltip isLatestYear={(year) => year === latest.year} />}
              />
              <Bar
                dataKey="observedAmountEur"
                name="Stanziamento pubblicato"
                fill="var(--chart-primary)"
                radius={0}
                isAnimationActive={false}
              />
              <Bar
                dataKey="hypotheticalAmountEur"
                name="Scenario ipotetico (non reale)"
                fill={`url(#${patternId})`}
                stroke="var(--color-accent-600)"
                strokeWidth={1.5}
                strokeDasharray="4 2"
                radius={0}
                isAnimationActive={false}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className={styles.legend} aria-hidden="true">
          <span><i className={styles.legendObserved} /> Stanziamento pubblicato (dato osservato)</span>
          <span><i className={styles.legendHypothetical} /> Scenario ipotetico (non reale, costruito da te)</span>
        </div>

        <figcaption>
          Ogni barra piena è lo stanziamento di competenza pubblicato dalla Legge di Bilancio per il
          primo anno (campo RGS &laquo;Legge di Bilancio CP A1&raquo;), sommato su tutte le
          amministrazioni. La barra a righe sull&apos;ultimo anno è la tua ipotesi, non un dato
          osservato.
        </figcaption>

        <ChartDataTable
          label={`Stanziamento pubblicato e scenario ipotetico per ${selectedMission}`}
          columns={["Stanziamento pubblicato", "Scenario ipotetico (non reale)"]}
          rows={chartData.map((point) => ({
            label: String(point.year),
            values: [
              exactEuro.format(point.observedAmountEur),
              point.hypotheticalAmountEur === null ? "non disponibile" : exactEuro.format(point.hypotheticalAmountEur),
            ],
          }))}
        />
      </figure>

      <div className={styles.readout}>
        <div className={styles.readoutItem}>
          <span>Variazione reale, ultimo anno vs precedente</span>
          <strong>{realDeltaPct === null ? "non calcolabile" : signedPercent(realDeltaPct)}</strong>
          <small>
            {previous
              ? `${exactEuro.format(previous.amountEur)} (${previous.year}) → ${exactEuro.format(latest.amountEur)} (${latest.year})`
              : "Serve almeno un anno precedente nella finestra mostrata."}
          </small>
        </div>
        <div className={`${styles.readoutItem} ${styles.readoutHypothetical}`}>
          <span>Scenario ipotetico vs stanziamento reale {latest.year}</span>
          <strong>{scenarioVsRealPct === null ? "non calcolabile" : signedPercent(scenarioVsRealPct)}</strong>
          <small>
            {hypotheticalAmountEur === null
              ? "non disponibile"
              : `${exactEuro.format(latest.amountEur)} → ${exactEuro.format(hypotheticalAmountEur)}, un'ipotesi tua`}
          </small>
        </div>
      </div>
    </div>
  );
}
