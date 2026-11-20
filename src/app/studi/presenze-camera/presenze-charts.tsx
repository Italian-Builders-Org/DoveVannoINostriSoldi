"use client";

import { useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";
import { chartColor } from "@/lib/chart-colors";
import { ChartDataTable } from "@/components/charts/chart-data-table";
import styles from "./presenze-charts.module.css";

export type PresenceBin = { from: number; to: number; label: string; count: number };
export type ShareRow = {
  label: string;
  count: number;
  presence: number;
  votes: number;
  meanVotes: number;
  meanMissions: number;
  meanAbsences: number;
};
export type DeputyRow = {
  name: string;
  group: string;
  presence: number;
  votes: number;
  missions: number;
  absences: number;
  justified: number;
  votable: number;
  role?: string;
  government?: boolean;
  unmatched?: boolean;
};

/** Votes cast always carry the accent: they are the measure this study is about. */
const VOTES = chartColor(0);
const MISSIONS = chartColor(1);
const ABSENCES = "var(--color-neutral-300)";
const PRESENCE = chartColor(2);

const LEGEND_ORDER = ["Voti espressi", "Missioni", "Assenze", "Presenza ufficiale", "Altri deputati", "Ufficio di Presidenza", "Membri del Governo"];
const legendProps = {
  itemSorter: (item: { value?: unknown }) => LEGEND_ORDER.indexOf(String(item.value)),
  formatter: (value: unknown) => <span className={styles.legendText}>{String(value)}</span>,
};

const pct = (n: number, digits = 1) =>
  `${n.toLocaleString("it-IT", { maximumFractionDigits: digits, minimumFractionDigits: digits })}%`;

export function PresenceVotesHistogram({
  presence,
  votes,
}: {
  presence: readonly PresenceBin[];
  votes: readonly PresenceBin[];
}) {
  const data = presence.map((bin, index) => ({
    label: `${bin.from}`,
    range: bin.label,
    presenza: bin.count,
    voti: votes[index]?.count ?? 0,
  }));

  return (
    <figure className={styles.figure}>
      <div className={styles.chart} style={{ height: 320 }} role="img" aria-label="Numero di deputati per fascia del 5%: presenza ufficiale e voti espressi a confronto">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart accessibilityLayer data={data} margin={{ top: 8, right: 8, bottom: 4, left: -16 }} barCategoryGap={2}>
            <CartesianGrid vertical={false} stroke="var(--color-neutral-300)" />
            <XAxis dataKey="label" stroke="var(--color-neutral-500)" fontSize={11} interval={1} tickFormatter={(value) => `${value}%`} />
            <YAxis stroke="var(--color-neutral-500)" fontSize={11} allowDecimals={false} />
            <Tooltip
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const row = payload[0]?.payload as (typeof data)[number];
                return (
                  <div className={styles.tooltip}>
                    <strong>Fascia {row.range}</strong>
                    <span>Presenza ufficiale: {row.presenza} deputati</span>
                    <span>Voti espressi: {row.voti} deputati</span>
                  </div>
                );
              }}
            />
            <Legend {...legendProps} wrapperStyle={{ fontSize: 12 }} />
            <Bar dataKey="presenza" name="Presenza ufficiale" fill={PRESENCE} radius={[2, 2, 0, 0]} />
            <Bar dataKey="voti" name="Voti espressi" fill={VOTES} radius={[2, 2, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <figcaption className={styles.caption}>
        Ogni barra conta i deputati che cadono in una fascia di 5 punti. In grigio la presenza come la
        calcola la Camera (voti più missioni), in rosso i soli voti espressi.
      </figcaption>
      <ChartDataTable
        label="Deputati per fascia"
        columns={["Presenza ufficiale", "Voti espressi"]}
        rows={data.map((row) => ({ label: row.range, values: [String(row.presenza), String(row.voti)] }))}
      />
    </figure>
  );
}

type ScatterPoint = { x: number; y: number; name: string; group: string; presence: number };

export function MissionsScatter({ deputies }: { deputies: readonly DeputyRow[] }) {
  const series = useMemo(() => {
    const point = (d: DeputyRow): ScatterPoint => ({ x: d.missions, y: d.votes, name: d.name, group: d.group, presence: d.presence });
    return {
      government: deputies.filter((d) => d.government).map(point),
      presidency: deputies.filter((d) => !d.government && d.role).map(point),
      others: deputies.filter((d) => !d.government && !d.role).map(point),
    };
  }, [deputies]);

  return (
    <figure className={styles.figure}>
      <div className={styles.chart} style={{ height: 360 }} role="img" aria-label="Ogni punto è un deputato: quota di missioni in orizzontale, quota di voti espressi in verticale">
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart margin={{ top: 8, right: 12, bottom: 20, left: -8 }}>
            <CartesianGrid stroke="var(--color-neutral-300)" />
            <XAxis type="number" dataKey="x" name="Missioni" domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} tickFormatter={(v) => `${v}%`} stroke="var(--color-neutral-500)" fontSize={11}
              label={{ value: "Missioni", position: "insideBottom", offset: -12, fontSize: 12, fill: "var(--color-neutral-600)" }} />
            <YAxis type="number" dataKey="y" name="Voti espressi" domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} tickFormatter={(v) => `${v}%`} stroke="var(--color-neutral-500)" fontSize={11} />
            <ZAxis range={[28, 28]} />
            <Tooltip
              cursor={{ strokeDasharray: "3 3" }}
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const row = payload[0]?.payload as ScatterPoint;
                return (
                  <div className={styles.tooltip}>
                    <strong>{row.name} ({row.group})</strong>
                    <span>Voti espressi: {pct(row.y)}</span>
                    <span>Missioni: {pct(row.x)}</span>
                    <span>Presenza ufficiale: {pct(row.presence)}</span>
                  </div>
                );
              }}
            />
            <Legend {...legendProps} verticalAlign="top" wrapperStyle={{ fontSize: 12, paddingBottom: 8 }} />
            <Scatter name="Altri deputati" data={series.others} fill={PRESENCE} fillOpacity={0.55} />
            <Scatter name="Ufficio di Presidenza" data={series.presidency} fill={MISSIONS} />
            <Scatter name="Membri del Governo" data={series.government} fill={VOTES} />
          </ScatterChart>
        </ResponsiveContainer>
      </div>
      <figcaption className={styles.caption}>
        I punti in basso a destra sono deputati quasi sempre in missione: la statistica ufficiale li
        conta presenti, ma votano di rado. La diagonale che scende da sinistra in alto raccoglie chi ha
        poche assenze.
      </figcaption>
    </figure>
  );
}

/** 100% stacked bars of the mean shares: votes + missions + absences = 100. */
export function ShareStack({ rows, label, labelWidth = 150 }: { rows: readonly ShareRow[]; label: string; labelWidth?: number }) {
  const data = rows.map((row) => ({ ...row, name: `${row.label} (${row.count})` }));
  return (
    <figure className={styles.figure}>
      <div className={styles.chart} style={{ height: Math.max(170, data.length * 38 + 60), minHeight: 0 }} role="img" aria-label={label}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart accessibilityLayer data={data} layout="vertical" stackOffset="expand" margin={{ top: 4, right: 12, bottom: 4, left: 4 }}>
            <CartesianGrid horizontal={false} stroke="var(--color-neutral-300)" />
            <XAxis type="number" tickFormatter={(v) => `${Math.round(v * 100)}%`} stroke="var(--color-neutral-500)" fontSize={11} />
            <YAxis type="category" dataKey="name" width={labelWidth} stroke="var(--color-neutral-500)" fontSize={11} />
            <Tooltip
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const row = payload[0]?.payload as (typeof data)[number];
                return (
                  <div className={styles.tooltip}>
                    <strong>{row.label}, {row.count} deputati</strong>
                    <span>Voti espressi: {pct(row.meanVotes)}</span>
                    <span>Missioni: {pct(row.meanMissions)}</span>
                    <span>Assenze: {pct(row.meanAbsences)}</span>
                  </div>
                );
              }}
            />
            <Legend {...legendProps} wrapperStyle={{ fontSize: 12 }} />
            <Bar dataKey="meanVotes" name="Voti espressi" stackId="s" fill={VOTES} />
            <Bar dataKey="meanMissions" name="Missioni" stackId="s" fill={MISSIONS} />
            <Bar dataKey="meanAbsences" name="Assenze" stackId="s" fill={ABSENCES} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <ChartDataTable
        label={label}
        columns={["Deputati", "Voti espressi (media)", "Missioni (media)", "Assenze (media)", "Presenza (mediana)", "Voti espressi (mediana)"]}
        rows={rows.map((row) => ({
          label: row.label,
          values: [String(row.count), pct(row.meanVotes), pct(row.meanMissions), pct(row.meanAbsences), pct(row.presence), pct(row.votes)],
        }))}
      />
    </figure>
  );
}

type SortKey = "name" | "presence" | "votes" | "missions" | "absences";
const COLUMNS: ReadonlyArray<{ key: SortKey; label: string }> = [
  { key: "name", label: "Deputato" },
  { key: "presence", label: "Presenza" },
  { key: "votes", label: "Voti espressi" },
  { key: "missions", label: "Missioni" },
  { key: "absences", label: "Assenze" },
];
const PAGE = 25;

function fold(value: string): string {
  return value.normalize("NFKD").replaceAll(/\p{M}/gu, "").toLocaleLowerCase("it-IT");
}

export function DeputiesTable({ deputies, groups, totalVotes }: { deputies: readonly DeputyRow[]; groups: readonly string[]; totalVotes: number }) {
  const [query, setQuery] = useState("");
  const [group, setGroup] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: "presence", desc: false });
  const [limit, setLimit] = useState(PAGE);

  const rows = useMemo(() => {
    const tokens = fold(query).split(/\s+/).filter(Boolean);
    const filtered = deputies.filter((d) => (!group || d.group === group) && tokens.every((t) => fold(`${d.name} ${d.role ?? ""}`).includes(t)));
    const sign = sort.desc ? -1 : 1;
    return [...filtered].sort((a, b) => {
      if (sort.key === "name") return sign * a.name.localeCompare(b.name, "it");
      return sign * (a[sort.key] - b[sort.key]) || a.name.localeCompare(b.name, "it");
    });
  }, [deputies, query, group, sort]);

  const visible = rows.slice(0, limit);
  const toggle = (key: SortKey) => {
    setSort((current) => (current.key === key ? { key, desc: !current.desc } : { key, desc: key === "missions" || key === "absences" }));
    setLimit(PAGE);
  };

  return (
    <div className={styles.directory} data-deputies-table="">
      <div className={styles.filters}>
        <label>
          <span>Cerca un deputato</span>
          <input type="search" value={query} placeholder="Nome, cognome o incarico" onChange={(event) => { setQuery(event.target.value); setLimit(PAGE); }} />
        </label>
        <label>
          <span>Gruppo</span>
          <select value={group} onChange={(event) => { setGroup(event.target.value); setLimit(PAGE); }}>
            <option value="">Tutti i gruppi</option>
            {groups.map((g) => <option key={g} value={g}>{g}</option>)}
          </select>
        </label>
      </div>
      <p className={styles.count} aria-live="polite">
        {rows.length === deputies.length ? `${rows.length} deputati` : `${rows.length} deputati su ${deputies.length}`}
      </p>
      <div className={styles.tableScroll} role="region" aria-label="Presenze per deputato" tabIndex={0}>
        <table className={styles.table}>
          <thead>
            <tr>
              {COLUMNS.map((column) => (
                <th key={column.key} scope="col" aria-sort={sort.key === column.key ? (sort.desc ? "descending" : "ascending") : "none"} className={column.key === "name" ? undefined : styles.num}>
                  <button type="button" onClick={() => toggle(column.key)}>
                    {column.label}
                    <span aria-hidden="true">{sort.key === column.key ? (sort.desc ? " ↓" : " ↑") : ""}</span>
                  </button>
                </th>
              ))}
              <th scope="col" className={styles.num}>Gruppo</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((d) => (
              <tr key={`${d.name}-${d.group}`}>
                <th scope="row">
                  {d.name}
                  {d.role ? <span className={styles.role}>{d.role}</span> : null}
                  {d.votable < totalVotes ? <span className={styles.role}>Mandato parziale: {d.votable.toLocaleString("it-IT")} votazioni</span> : null}
                </th>
                <td className={styles.num}>{pct(d.presence)}</td>
                <td className={styles.num}>{pct(d.votes)}</td>
                <td className={styles.num}>{pct(d.missions)}</td>
                <td className={styles.num}>{pct(d.absences)}</td>
                <td className={styles.num}>{d.group}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length > limit ? (
        <button type="button" className={styles.more} onClick={() => setLimit((value) => value + 50)}>
          Mostra altri {Math.min(50, rows.length - limit)}
        </button>
      ) : null}
    </div>
  );
}
