"use client";

import { useId } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ChartDataTable } from "@/components/charts/chart-data-table";
import {
  PAYCHECK_CURVE_MAX_ANNUAL_EUR,
  PAYCHECK_CURVE_MIN_ANNUAL_EUR,
  PAYCHECK_CURVE_STEP_EUR,
  eurosToCents,
  formatPaycheckEuro,
  type PaycheckCurvePoint,
} from "@/lib/paycheck-counter";
import styles from "./busta-paga.module.css";

type CurveRow = {
  ral: number;
  company: number;
  net: number;
  monthlyNetEur: number;
  isCurrent: boolean;
};

const SERIES = [
  {
    key: "ral" as const,
    label: "RAL dipendente",
    detail: "stipendio annuo lordo",
    fill: "var(--color-text)",
  },
  {
    key: "net" as const,
    label: "Netto dipendente",
    detail: "netto annuo, dopo trattenute",
    fill: "var(--chart-data-primary)",
  },
  {
    key: "company" as const,
    label: "Costo azienda annuale",
    detail: "RAL + INPS, INAIL e TFR",
    fill: "var(--chart-country-italy)",
  },
];

function axisEuro(value: number): string {
  const rounded = Math.round(Number(value));
  if (!Number.isFinite(rounded)) return "";
  const sign = rounded < 0 ? "-" : "";
  return sign + String(Math.abs(rounded)).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

function euro(value: number): string {
  return formatPaycheckEuro(eurosToCents(value));
}

function TooltipCard({
  active,
  payload,
}: {
  active?: boolean;
  payload?: ReadonlyArray<{ payload?: CurveRow }>;
}) {
  const point = payload?.[0]?.payload;
  if (!active || !point) return null;
  return (
    <div className={styles.tooltip}>
      <span>{point.isCurrent ? "RAL inserita" : "Passo da 5.000 €"}</span>
      <strong>RAL dipendente</strong>
      <b>{euro(point.ral)}</b>
      <strong>Netto dipendente</strong>
      <b>{euro(point.net)}</b>
      <strong>Costo azienda annuale</strong>
      <b>{euro(point.company)}</b>
      <strong>Netto mensile</strong>
      <b>{euro(point.monthlyNetEur)}</b>
    </div>
  );
}

function RalTick({
  x = 0,
  y = 0,
  payload,
  currentRal,
}: {
  x?: number;
  y?: number;
  payload?: { value?: number };
  currentRal: number | null;
}) {
  const value = Number(payload?.value ?? 0);
  const current = currentRal != null && value === currentRal;
  return (
    <text
      x={x}
      y={y}
      dy={8}
      textAnchor="end"
      fill={current ? "var(--color-accent-700)" : "var(--color-neutral-700)"}
      fontSize={11}
      fontWeight={current ? 700 : 450}
      transform={`rotate(-60 ${x} ${y})`}
    >
      {axisEuro(value)}
    </text>
  );
}

export function PaycheckCurveChart({
  points,
  enteredAnnualEur,
}: {
  points: readonly PaycheckCurvePoint[];
  enteredAnnualEur: number;
}) {
  const titleId = useId();
  const data: CurveRow[] = points.map((point) => ({
    ral: point.annualGrossEur,
    company: point.companyAnnualEur,
    net: point.annualNetEur,
    monthlyNetEur: point.monthlyNetEur,
    isCurrent: point.isCurrent,
  }));
  const current = data.find((point) => point.isCurrent) ?? null;
  const enteredLabel = euro(enteredAnnualEur);
  const onGrid = current != null;

  return (
    <section className={styles.curve} id="busta-curva" aria-labelledby={titleId}>
      <div className={styles.curveHead}>
        <h2 id={titleId} className="panel-title">
          RAL, netto e costo azienda
        </h2>
        <p className={styles.hint}>
          Colonne da {axisEuro(PAYCHECK_CURVE_MIN_ANNUAL_EUR)} a{" "}
          {axisEuro(PAYCHECK_CURVE_MAX_ANNUAL_EUR)} €, a passi di{" "}
          {axisEuro(PAYCHECK_CURVE_STEP_EUR)} €. Per ogni RAL ci sono sempre tre colonne:
          RAL dipendente, netto dipendente e costo azienda annuale. Stessa Regione, stesse
          mensilità, stesso profilo INPS e stesso tasso INAIL.
        </p>
      </div>

      <ul className={styles.legend}>
        {SERIES.map((series) => (
          <li key={series.key}>
            <span
              className={`${styles.swatch} ${
                series.key === "company"
                  ? styles.swatchCompany
                  : series.key === "ral"
                    ? styles.swatchGross
                    : styles.swatchNet
              }`}
              aria-hidden="true"
            />
            <span>
              {series.label}
              <small>{series.detail}</small>
            </span>
          </li>
        ))}
      </ul>

      <div className={styles.chartScroll}>
        <div
          className={styles.chart}
          role="img"
          aria-label={`Grafico a colonne. Asse orizzontale: RAL da ${axisEuro(PAYCHECK_CURVE_MIN_ANNUAL_EUR)} a ${axisEuro(PAYCHECK_CURVE_MAX_ANNUAL_EUR)} euro, a passi di ${axisEuro(PAYCHECK_CURVE_STEP_EUR)}. Per ogni passo tre colonne: RAL dipendente, netto dipendente e costo azienda annuale.`}
          data-testid="paycheck-curve"
        >
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={data}
              margin={{ top: 12, right: 8, bottom: 8, left: 0 }}
              barGap={2}
              barCategoryGap="22%"
              accessibilityLayer
            >
              <CartesianGrid vertical={false} stroke="var(--color-neutral-300)" />
              <XAxis
                dataKey="ral"
                type="category"
                interval={0}
                height={78}
                axisLine={false}
                tickLine={false}
                tick={<RalTick currentRal={current?.ral ?? null} />}
              />
              <YAxis
                domain={[0, "auto"]}
                tickFormatter={axisEuro}
                axisLine={false}
                tickLine={false}
                width={72}
                stroke="var(--color-neutral-700)"
                tick={{ fill: "var(--color-neutral-700)", fontSize: 12 }}
              />
              <Tooltip
                content={<TooltipCard />}
                cursor={{ fill: "var(--color-neutral-100)" }}
                animationDuration={0}
              />
              {SERIES.map((series) => (
                <Bar
                  key={series.key}
                  dataKey={series.key}
                  name={series.label}
                  fill={series.fill}
                  maxBarSize={22}
                  isAnimationActive={false}
                />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
      <p className={styles.hint}>
        {onGrid
          ? `La RAL inserita (${enteredLabel}) è il passo evidenziato sull’asse: costo azienda ${euro(current.company)}, netto annuo ${euro(current.net)}.`
          : `La RAL inserita (${enteredLabel}) non cade su un passo da ${axisEuro(PAYCHECK_CURVE_STEP_EUR)} €: le colonne restano tutte, sui multipli.`}{" "}
        Il netto sale meno della RAL perché IRPEF e addizionali sono progressive. L’asse verticale
        è in euro all’anno.
      </p>

      <ChartDataTable
        label="RAL dipendente, netto dipendente e costo azienda annuale"
        columns={["Netto dipendente", "Costo azienda annuale", "Netto mensile"]}
        rows={points.map((point) => ({
          label: `${euro(point.annualGrossEur)}${point.isCurrent ? " · inserita" : ""}`,
          values: [
            euro(point.annualNetEur),
            euro(point.companyAnnualEur),
            euro(point.monthlyNetEur),
          ],
        }))}
      />
    </section>
  );
}
