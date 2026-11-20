"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { chartColor } from "@/lib/chart-colors";
import { ChartDataTable } from "@/components/charts/chart-data-table";
import styles from "./presenze-charts.module.css";

export type PresenceBin = { from: number; to: number; label: string; count: number };
export type PresenceGroup = {
  groupLabel: string;
  count: number;
  mean: number;
  median: number;
  p25: number;
  p75: number;
  min: number;
  max: number;
};

const pct = (n: number) =>
  `${n.toLocaleString("it-IT", { maximumFractionDigits: 1, minimumFractionDigits: 1 })}%`;

function TooltipBox({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: ReadonlyArray<{ value?: number | string; name?: string; payload?: Record<string, unknown> }>;
  label?: string | number;
}) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload ?? {};
  return (
    <div className={styles.tooltip}>
      <strong>{String(label ?? row.label ?? row.groupLabel ?? "")}</strong>
      {payload.map((item) => (
        <span key={String(item.name)}>
          {item.name}: {typeof item.value === "number" ? item.value.toLocaleString("it-IT") : item.value}
        </span>
      ))}
    </div>
  );
}

export function PresenceHistogram({ bins, total }: { bins: readonly PresenceBin[]; total: number }) {
  const data = bins.filter((bin) => bin.count > 0).map((bin) => ({
    ...bin,
    share: Math.round((bin.count / total) * 1000) / 10,
  }));
  const max = Math.max(...data.map((row) => row.count), 1);

  return (
    <figure className={styles.figure}>
      <div className={styles.chart} style={{ height: Math.max(280, data.length * 28) }} role="img" aria-label="Istogramma delle presenze per fascia del 5%">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart accessibilityLayer data={data} layout="vertical" margin={{ top: 4, right: 16, bottom: 4, left: 4 }}>
            <CartesianGrid horizontal={false} stroke="var(--color-neutral-300)" />
            <XAxis type="number" domain={[0, max]} tickFormatter={(value) => String(value)} stroke="var(--color-neutral-500)" fontSize={12} />
            <YAxis type="category" dataKey="label" width={72} stroke="var(--color-neutral-500)" fontSize={12} />
            <Tooltip content={<TooltipBox />} />
            <Bar dataKey="count" name="Deputati" radius={[0, 4, 4, 0]}>
              {data.map((row) => (
                <Cell key={row.label} fill={row.from >= 85 ? chartColor(0) : chartColor(1)} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <ChartDataTable
        label="Fasce di presenza"
        columns={["Deputati", "Quota %"]}
        rows={data.map((row) => ({
          label: row.label,
          values: [String(row.count), row.share.toLocaleString("it-IT", { maximumFractionDigits: 1 })],
        }))}
      />
    </figure>
  );
}

export function PresenceGroupChart({ groups }: { groups: readonly PresenceGroup[] }) {
  const data = [...groups]
    .sort((a, b) => b.median - a.median || b.count - a.count)
    .map((group) => ({
      ...group,
      shortLabel: group.groupLabel.length > 42 ? `${group.groupLabel.slice(0, 41).trimEnd()}…` : group.groupLabel,
    }));

  return (
    <figure className={styles.figure}>
      <div className={styles.chart} style={{ height: Math.max(320, data.length * 36) }} role="img" aria-label="Mediana di presenza per gruppo parlamentare">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart accessibilityLayer data={data} layout="vertical" margin={{ top: 4, right: 20, bottom: 4, left: 4 }}>
            <CartesianGrid horizontal={false} stroke="var(--color-neutral-300)" />
            <XAxis type="number" domain={[0, 100]} tickFormatter={(value) => `${value}%`} stroke="var(--color-neutral-500)" fontSize={12} />
            <YAxis type="category" dataKey="shortLabel" width={168} stroke="var(--color-neutral-500)" fontSize={11} />
            <Tooltip
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const row = payload[0]?.payload as PresenceGroup & { shortLabel: string };
                return (
                  <div className={styles.tooltip}>
                    <strong>{row.groupLabel}</strong>
                    <span>Mediana: {pct(row.median)}</span>
                    <span>Media: {pct(row.mean)}</span>
                    <span>P25-P75: {pct(row.p25)}-{pct(row.p75)}</span>
                    <span>n={row.count}</span>
                  </div>
                );
              }}
            />
            <Bar dataKey="median" name="Mediana %" fill={chartColor(0)} radius={[0, 4, 4, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <ChartDataTable
        label="Presenze per gruppo"
        columns={["n", "Mediana %", "Media %", "P25 %", "P75 %"]}
        rows={data.map((row) => ({
          label: row.groupLabel,
          values: [
            String(row.count),
            pct(row.median),
            pct(row.mean),
            pct(row.p25),
            pct(row.p75),
          ],
        }))}
      />
    </figure>
  );
}
