"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { MissionEnactedAllocation } from "@/lib/bdap-legge-bilancio";
import { ChartDataTable } from "@/components/charts/chart-data-table";
import { MissionPicker, type MissionSummary } from "./MissionPicker";
import { encodePiano, orderedMissionList } from "./piano-codec";
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

function signedCompactEuro(value: number): string {
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  return `${sign}${compactEuro(Math.abs(value))}`;
}

const SLIDER_MIN = -50;
const SLIDER_MAX = 50;
const SLIDER_STEP = 1;

type ChartPoint = {
  label: string;
  amountEur: number | null;
  observedAmountEur: number | null;
  hypotheticalAmountEur: number | null;
  isHypothesis: boolean;
};

function ScenarioTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload?: ChartPoint }>;
}) {
  if (!active || !payload?.length) return null;
  const point = payload[0]?.payload;
  if (!point) return null;

  return (
    <div className={styles.tooltip}>
      <strong>{point.label}</strong>
      {point.observedAmountEur !== null ? (
        <span>
          Stanziamento pubblicato <b>{exactEuro.format(point.observedAmountEur)}</b>
        </span>
      ) : null}
      {point.isHypothesis && point.hypotheticalAmountEur !== null ? (
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
  initialScenario = {},
}: {
  years: number[];
  missions: string[];
  allocations: MissionEnactedAllocation[];
  initialScenario?: Record<string, number>;
}) {
  const patternId = useId();
  const router = useRouter();
  const pathname = usePathname();
  const orderedMissions = useMemo(() => orderedMissionList(missions), [missions]);
  const latestYear = years.at(-1) ?? null;
  const previousYear = years.length > 1 ? years.at(-2)! : null;

  const missionSummaries = useMemo<MissionSummary[]>(
    () =>
      missions.map((mission) => {
        const rows = allocations.filter((allocation) => allocation.mission === mission);
        const latestRow = latestYear === null ? null : rows.find((row) => row.year === latestYear) ?? null;
        const previousRow =
          previousYear === null ? null : rows.find((row) => row.year === previousYear) ?? null;
        const realDeltaPct =
          latestRow && previousRow && previousRow.amountEur !== 0
            ? ((latestRow.amountEur - previousRow.amountEur) / previousRow.amountEur) * 100
            : null;
        return {
          mission,
          latestAmountEur: latestRow?.amountEur ?? 0,
          realDeltaPct,
        };
      }),
    [missions, allocations, latestYear, previousYear],
  );

  const defaultMission = useMemo(
    () =>
      // Se apri un link con un piano condiviso, parti dalla prima voce toccata.
      orderedMissions.find((mission) => (initialScenario[mission] ?? 0) !== 0) ??
      [...missionSummaries].sort((left, right) => right.latestAmountEur - left.latestAmountEur)[0]
        ?.mission ??
      missions[0] ??
      "",
    [missionSummaries, missions, orderedMissions, initialScenario],
  );

  const [selectedMission, setSelectedMission] = useState(defaultMission);
  // Piano di riallocazione: variazione ipotetica (punti %) per missione toccata.
  // Resta quando cambi missione, così vedi tutto lo scenario che hai costruito.
  const [scenarioByMission, setScenarioByMission] =
    useState<Record<string, number>>(initialScenario);

  // Tiene la query string allineata al piano, così il link è condivisibile.
  const skipFirstUrlSync = useRef(true);
  useEffect(() => {
    if (skipFirstUrlSync.current) {
      skipFirstUrlSync.current = false;
      return;
    }
    const encoded = encodePiano(scenarioByMission, orderedMissions);
    const params = new URLSearchParams(window.location.search);
    if (encoded) params.set("piano", encoded);
    else params.delete("piano");
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }, [scenarioByMission, orderedMissions, router, pathname]);

  const sliderPct = scenarioByMission[selectedMission] ?? 0;

  const setSliderPct = useCallback(
    (pct: number) =>
      setScenarioByMission((previous) => {
        const next = { ...previous };
        if (pct === 0) {
          delete next[selectedMission];
        } else {
          next[selectedMission] = pct;
        }
        return next;
      }),
    [selectedMission],
  );

  const clearMissionScenario = useCallback(
    (mission: string) =>
      setScenarioByMission((previous) => {
        if (!(mission in previous)) return previous;
        const next = { ...previous };
        delete next[mission];
        return next;
      }),
    [],
  );

  const clearAllScenario = useCallback(() => setScenarioByMission({}), []);

  const series = useMemo(
    () =>
      allocations
        .filter((allocation) => allocation.mission === selectedMission)
        .sort((left, right) => left.year - right.year),
    [allocations, selectedMission],
  );

  const latest = series.at(-1) ?? null;

  if (missions.length === 0 || !latest) {
    return (
      <div className={styles.errorState} role="alert">
        <strong>Nessuna missione disponibile in questa finestra di anni.</strong>
      </div>
    );
  }

  const hypothesisYear = latest.year + 1;
  const hypothesisLabel = `${hypothesisYear} (ipotesi)`;

  const observedLatestEur = latest.amountEur;
  const hypothesisAmountEur = observedLatestEur * (1 + sliderPct / 100);
  const deltaEur = hypothesisAmountEur - observedLatestEur;

  // Verde quando aumenti l'allocazione, rosso quando la riduci, neutro a zero.
  const scenarioTone: "up" | "down" | "flat" =
    sliderPct > 0 ? "up" : sliderPct < 0 ? "down" : "flat";
  const scenarioToneClass =
    scenarioTone === "up" ? styles.toneUp : scenarioTone === "down" ? styles.toneDown : "";
  const scenarioAccent =
    scenarioTone === "up"
      ? "var(--color-positive)"
      : scenarioTone === "down"
        ? "var(--color-critical)"
        : "var(--color-accent)";
  const hypothesisFill =
    scenarioTone === "up"
      ? `url(#${patternId}-up)`
      : scenarioTone === "down"
        ? `url(#${patternId}-down)`
        : "var(--color-neutral-300)";
  const hypothesisStroke =
    scenarioTone === "up"
      ? "var(--color-positive)"
      : scenarioTone === "down"
        ? "var(--color-critical)"
        : "var(--color-neutral-400)";

  const chartData: ChartPoint[] = [
    ...series.map((point) => ({
      label: String(point.year),
      amountEur: point.amountEur,
      observedAmountEur: point.amountEur,
      hypotheticalAmountEur: null,
      isHypothesis: false,
    })),
    {
      label: hypothesisLabel,
      amountEur: hypothesisAmountEur,
      observedAmountEur: null,
      hypotheticalAmountEur: hypothesisAmountEur,
      isHypothesis: true,
    },
  ];

  return (
    <div className={styles.simulator}>
      <MissionPicker
        summaries={missionSummaries}
        selectedMission={selectedMission}
        onSelect={setSelectedMission}
        onClearMission={clearMissionScenario}
        onClearAll={clearAllScenario}
        latestYear={latest.year}
        scenarioByMission={scenarioByMission}
      />

      <figure className={styles.figure}>
        <div className={styles.figureHeader}>
          <div>
            <span>STANZIAMENTO PUBBLICATO · LEGGE DI BILANCIO</span>
            <h2>{selectedMission}</h2>
          </div>
          <b>{years[0]}–{hypothesisYear}</b>
        </div>

        <div className={styles.workbench}>
          <div className={styles.controls}>
            <div className={styles.controlField}>
              <span className={styles.controlLabel}>Ipotesi · {hypothesisYear}</span>
              <output className={`${styles.sliderValue} ${scenarioToneClass}`}>
                {signedPercent(sliderPct)}
              </output>
              <p className={styles.controlImpact}>
                {sliderPct === 0 ? (
                  <span className={styles.controlImpactMuted}>
                    Sposta il cursore per simulare un aumento o un taglio su{" "}
                    {compactEuro(observedLatestEur)}.
                  </span>
                ) : (
                  <>
                    {compactEuro(observedLatestEur)} <span aria-hidden="true">→</span>{" "}
                    <b className={scenarioToneClass}>{compactEuro(hypothesisAmountEur)}</b>
                    <span className={`${styles.controlDelta} ${scenarioToneClass}`}>
                      {signedCompactEuro(deltaEur)}
                    </span>
                  </>
                )}
              </p>
              <input
                className={styles.slider}
                style={{ accentColor: scenarioAccent }}
                type="range"
                min={SLIDER_MIN}
                max={SLIDER_MAX}
                step={SLIDER_STEP}
                value={sliderPct}
                onChange={(event) => setSliderPct(Number(event.target.value))}
                aria-label={`Variazione ipotetica percentuale sullo stanziamento ${latest.year} di ${selectedMission}`}
                aria-valuetext={signedPercent(sliderPct)}
              />
              <div className={styles.sliderScale} aria-hidden="true">
                <span>{SLIDER_MIN}%</span>
                <span>0</span>
                <span>+{SLIDER_MAX}%</span>
              </div>
            </div>

            <div className={styles.controlFooter}>
              <button
                type="button"
                className={`btn btn-secondary ${styles.controlReset}`}
                onClick={() => setSliderPct(0)}
                disabled={sliderPct === 0}
              >
                Azzera questa voce
              </button>
              <small className={styles.controlHint}>
                La modifica resta nel piano di riallocazione anche quando cambi missione.
              </small>
            </div>
          </div>

          <div className={styles.chartBox}>
          <div
            className={styles.chart}
            role="img"
            aria-label={`Stanziamento pubblicato per la missione ${selectedMission} dal ${years[0]} al ${years.at(-1)}, con lo scenario ipotetico impostato a ${signedPercent(sliderPct)} in una colonna dedicata "${hypothesisLabel}"`}
          >
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart
                data={chartData}
                margin={{ top: 12, right: 16, bottom: 0, left: 4 }}
                barCategoryGap="20%"
                accessibilityLayer
              >
                <defs>
                  <pattern
                    id={`${patternId}-up`}
                    patternUnits="userSpaceOnUse"
                    width="6"
                    height="6"
                    patternTransform="rotate(45)"
                  >
                    <rect width="6" height="6" fill="var(--color-positive-bg)" />
                    <line x1="0" y1="0" x2="0" y2="6" stroke="var(--color-positive)" strokeWidth="2" />
                  </pattern>
                  <pattern
                    id={`${patternId}-down`}
                    patternUnits="userSpaceOnUse"
                    width="6"
                    height="6"
                    patternTransform="rotate(45)"
                  >
                    <rect width="6" height="6" fill="var(--color-critical-bg)" />
                    <line x1="0" y1="0" x2="0" y2="6" stroke="var(--color-critical)" strokeWidth="2" />
                  </pattern>
                </defs>
                <CartesianGrid vertical={false} stroke="var(--color-neutral-300)" />
                <XAxis
                  dataKey="label"
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: "var(--color-neutral-600)", fontSize: 11 }}
                />
                <YAxis
                  axisLine={false}
                  tickLine={false}
                  width={70}
                  tickCount={5}
                  tick={{ fill: "var(--color-neutral-600)", fontSize: 10 }}
                  tickFormatter={compactEuro}
                />
                <Tooltip
                  animationDuration={120}
                  cursor={{ fill: "var(--color-neutral-100)" }}
                  content={<ScenarioTooltip />}
                />
                <Line
                  type="monotone"
                  dataKey="observedAmountEur"
                  name="Andamento"
                  stroke="var(--color-neutral-500)"
                  strokeWidth={2}
                  strokeDasharray="5 3"
                  dot={false}
                  activeDot={false}
                  connectNulls
                  isAnimationActive={false}
                />
                <Bar
                  dataKey="amountEur"
                  name="Stanziamento pubblicato"
                  radius={[2, 2, 0, 0]}
                  maxBarSize={26}
                  isAnimationActive={false}
                >
                  {chartData.map((point) => (
                    <Cell
                      key={point.label}
                      fill={point.isHypothesis ? hypothesisFill : "var(--chart-primary)"}
                      stroke={point.isHypothesis ? hypothesisStroke : "none"}
                      strokeWidth={point.isHypothesis ? 1.5 : 0}
                      strokeDasharray={point.isHypothesis ? "4 2" : undefined}
                    />
                  ))}
                </Bar>
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          </div>
        </div>

        <div className={styles.legend} aria-hidden="true">
          <span><i className={styles.legendObserved} /> Stanziamento pubblicato (dato osservato)</span>
          <span><i className={styles.legendHypothetical} /> Scenario ipotetico: verde se aumenti, rosso se riduci</span>
          <span><i className={styles.legendTrend} /> Andamento nel periodo</span>
        </div>

        <figcaption>
          Ogni barra piena è lo stanziamento di competenza pubblicato dalla Legge di Bilancio per il
          primo anno (campo RGS &laquo;Legge di Bilancio CP A1&raquo;), sommato su tutte le
          amministrazioni. La colonna a righe &laquo;{hypothesisLabel}&raquo; è la tua ipotesi
          applicata all&apos;ultimo anno pubblicato, non un dato osservato.
        </figcaption>

        <ChartDataTable
          label={`Stanziamento pubblicato e scenario ipotetico per ${selectedMission}`}
          columns={["Stanziamento pubblicato", "Scenario ipotetico (non reale)"]}
          rows={chartData.map((point) => ({
            label: point.label,
            values: [
              point.observedAmountEur === null ? "non applicabile" : exactEuro.format(point.observedAmountEur),
              point.hypotheticalAmountEur === null ? "non applicabile" : exactEuro.format(point.hypotheticalAmountEur),
            ],
          }))}
        />
      </figure>
    </div>
  );
}
