"use client";

import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { integer } from "@/lib/format";
import {
  formatStaffAxisTick,
  staffChartUsesDualAxis,
  toStaffChartPoints,
} from "@/lib/staff-series-chart";
import styles from "./conto-annuale.module.css";

type TooltipPayload = Readonly<{
  year: number;
  permanent: number;
  flexible: number;
}>;

function StaffTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload?: TooltipPayload }>;
}) {
  if (!active || !payload?.length) return null;
  const point = payload[0]?.payload;
  if (!point) return null;
  return (
    <div className={styles.chartTooltip}>
      <strong>{point.year}</strong>
      <dl>
        <div>
          <dt>Personale</dt>
          <dd>{formatStaffAxisTick(point.permanent, "permanent")}</dd>
        </div>
        <div>
          <dt>Lavoro flessibile</dt>
          <dd>{formatStaffAxisTick(point.flexible, "flexible")}</dd>
        </div>
      </dl>
    </div>
  );
}

type ChartPointInput = Readonly<{
  year: number;
  permanent: number;
  flexible: number;
}>;

export function StaffSeriesChart({
  points,
  id,
  label,
}: {
  points: readonly ChartPointInput[];
  id: string;
  label: string;
}) {
  if (points.length === 0) return <p>Serie non disponibile.</p>;

  const data = toStaffChartPoints(points);
  const dualAxis = staffChartUsesDualAxis(data);
  const firstYear = data[0]!.year;
  const lastYear = data.at(-1)!.year;
  const maxPermanent = Math.max(...data.map((point) => point.permanent));
  const maxFlexible = Math.max(...data.map((point) => point.flexible));

  return (
    <figure className={styles.chartFigure}>
      <div
        className={styles.chartPlot}
        role="img"
        aria-labelledby={`${id}-title ${id}-desc`}
        data-testid="staff-series-chart"
      >
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 12, right: dualAxis ? 56 : 16, left: 4, bottom: 4 }} accessibilityLayer>
            <CartesianGrid vertical={false} stroke="var(--color-neutral-300)" />
            <XAxis
              dataKey="year"
              axisLine={false}
              tickLine={false}
              interval="preserveStartEnd"
              minTickGap={28}
              tick={{ fill: "var(--color-neutral-600)", fontSize: 11 }}
            />
            <YAxis
              yAxisId="permanent"
              axisLine={false}
              tickLine={false}
              width={72}
              domain={[0, Math.max(1, maxPermanent * 1.05)]}
              tick={{ fill: "var(--color-neutral-600)", fontSize: 11 }}
              tickFormatter={(value: number) => formatStaffAxisTick(value, "permanent")}
            />
            {dualAxis ? (
              <YAxis
                yAxisId="flexible"
                orientation="right"
                axisLine={false}
                tickLine={false}
                width={64}
                domain={[0, Math.max(1, maxFlexible * 1.1)]}
                tick={{ fill: "var(--color-neutral-600)", fontSize: 11 }}
                tickFormatter={(value: number) => formatStaffAxisTick(value, "flexible")}
              />
            ) : null}
            <Tooltip isAnimationActive={false} content={<StaffTooltip />} />
            <Line
              yAxisId="permanent"
              type="monotone"
              dataKey="permanent"
              name="Personale"
              stroke="var(--accent, var(--chart-primary))"
              strokeWidth={2.5}
              dot={{ r: 3, fill: "var(--accent, var(--chart-primary))" }}
              activeDot={{ r: 4 }}
              isAnimationActive={false}
            />
            <Line
              yAxisId={dualAxis ? "flexible" : "permanent"}
              type="monotone"
              dataKey="flexible"
              name="Lavoro flessibile"
              stroke="var(--chart-secondary, #7a5c00)"
              strokeWidth={2}
              strokeDasharray="5 4"
              dot={{ r: 2.5, fill: "var(--chart-secondary, #7a5c00)" }}
              activeDot={{ r: 3.5 }}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <title id={`${id}-title`}>{`${label}: personale e lavoro flessibile dal ${firstYear} al ${lastYear}`}</title>
      <desc id={`${id}-desc`}>
        Personale al 31 dicembre in persone
        {dualAxis ? " (asse sinistro)" : ""}
        ; lavoro flessibile in unità annue
        {dualAxis ? " (asse destro)" : ""}
        . Valori esatti nella tabella.
      </desc>
      <figcaption className={styles.legend}>
        <span><i className={styles.legendPermanent} aria-hidden="true" />Personale al 31 dicembre ({integer(maxPermanent)} max.)</span>
        <span><i className={styles.legendFlexible} aria-hidden="true" />Lavoro flessibile ({formatStaffAxisTick(maxFlexible, "flexible")} max.)</span>
      </figcaption>
    </figure>
  );
}
