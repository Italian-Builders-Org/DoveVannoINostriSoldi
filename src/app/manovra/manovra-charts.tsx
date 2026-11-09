"use client";

import { useEffect, useState, type ReactNode } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import styles from "./manovra-charts.module.css";

export type YearComparePoint = {
  year: number;
  label: string;
  entrateMld: number;
  speseMld: number;
  saldoMld: number;
};

export type MissionSpendPoint = {
  mission: string;
  short: string;
  amountMld: number;
};

export type MissionDeltaPoint = {
  mission: string;
  short: string;
  deltaMld: number;
};

export type SharePoint = {
  aggregate: string;
  short: string;
  manovraPct: number;
  manovraMld: number | null;
  stanziamentoMld: number | null;
};

export type PilPoint = {
  year: number;
  indebitamento: number | null;
  primario: number | null;
  debito: number | null;
};

export type CompositionPoint = {
  year: number;
  tributarieMld: number;
  extraMld: number;
  alienazioniMld: number;
  correntiMld: number;
  interessiMld: number;
  capitaleMld: number;
};

export type MissionTotalPoint = {
  year: number;
  totalMld: number;
};

type Palette = {
  spese: string;
  entrate: string;
  up: string;
  down: string;
  axis: string;
  grid: string;
  cursor: string;
  label: string;
  lineDebt: string;
  linePrimary: string;
  lineDeficit: string;
  area: string;
};

const LIGHT: Palette = {
  spese: "#176575",
  entrate: "#386848",
  up: "#1f6b46",
  down: "#ec3013",
  axis: "#605d5d",
  grid: "#d5d0d0",
  cursor: "#eeeaea",
  label: "#444141",
  lineDebt: "#176575",
  linePrimary: "#386848",
  lineDeficit: "#ec3013",
  area: "#176575",
};

const DARK: Palette = {
  spese: "#65b7bf",
  entrate: "#87c89a",
  up: "#84cda5",
  down: "#ff765f",
  axis: "#bdb6b6",
  grid: "#373333",
  cursor: "#272424",
  label: "#f0ecec",
  lineDebt: "#65b7bf",
  linePrimary: "#87c89a",
  lineDeficit: "#ff765f",
  area: "#65b7bf",
};

function usePalette(): Palette {
  const [palette, setPalette] = useState<Palette>(LIGHT);
  useEffect(() => {
    const root = document.documentElement;
    const sync = () => {
      setPalette(root.getAttribute("data-theme") === "dark" ? DARK : LIGHT);
    };
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(root, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);
  return palette;
}

const mld = (value: number, digits = 1) =>
  `${value.toLocaleString("it-IT", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })} mld €`;

const pct = (value: number, digits = 2) =>
  `${value > 0 ? "+" : value < 0 ? "−" : ""}${Math.abs(value).toLocaleString("it-IT", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}%`;

function ChartShell({
  title,
  lead,
  height,
  children,
  ariaLabel,
  glossary,
  footnotes,
}: {
  title: string;
  lead?: string;
  height: number;
  children: ReactNode;
  ariaLabel: string;
  glossary?: Array<{ term: string; meaning: string }>;
  footnotes?: ReactNode;
}) {
  return (
    <figure className={styles.figure}>
      <figcaption>
        <h3>{title}</h3>
        {lead ? <p>{lead}</p> : null}
      </figcaption>
      <div className={styles.canvas} style={{ height }} role="img" aria-label={ariaLabel}>
        <ResponsiveContainer width="100%" height="100%">
          {children}
        </ResponsiveContainer>
      </div>
      {glossary && glossary.length > 0 ? (
        <dl className={styles.glossary}>
          {glossary.map((item) => (
            <div key={item.term}>
              <dt>{item.term}</dt>
              <dd>{item.meaning}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {footnotes ? <div className={styles.footnotes}>{footnotes}</div> : null}
    </figure>
  );
}

/** Etichette Y a capo: niente puntini di troncamento. */
function WrappedCategoryTick({
  x = 0,
  y = 0,
  payload,
  fill = "#444",
  maxChars = 30,
}: {
  x?: number;
  y?: number;
  payload?: { value?: string | number };
  fill?: string;
  maxChars?: number;
}) {
  const raw = String(payload?.value ?? "");
  const words = raw.split(/\s+/);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length > maxChars && current) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }
  if (current) lines.push(current);
  const lineHeight = 13;
  const startY = y - ((lines.length - 1) * lineHeight) / 2 + 4;
  return (
    <text x={x} y={startY} textAnchor="end" fill={fill} fontSize={11} fontWeight={600}>
      {lines.map((line, index) => (
        <tspan key={`${line}-${index}`} x={x} dy={index === 0 ? 0 : lineHeight}>
          {line}
        </tspan>
      ))}
    </text>
  );
}

/**
 * Valori sulle barre divergenti.
 * Positivi: fuori dalla punta a destra.
 * Negativi: subito a destra dello zero (mai sulla Y, dove ci sono i titoli).
 */
function DivergingBarLabel({
  x = 0,
  y = 0,
  width = 0,
  height = 0,
  value,
  fill = "#444",
  format,
}: {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  value?: number | string;
  fill?: string;
  format: (value: number) => string;
}) {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return null;
  const barRight = width >= 0 ? x + width : x;
  // Punta destra della barra: per i positivi è l'estremo; per i negativi è lo zero.
  const labelX = barRight + 8;
  return (
    <text
      x={labelX}
      y={y + height / 2}
      dy={4}
      textAnchor="start"
      fill={fill}
      fontSize={11}
      fontWeight={700}
    >
      {format(numeric)}
    </text>
  );
}

function divergingDomain(values: number[], padRatio = 0.22): [number, number] {
  const min = Math.min(0, ...values);
  const max = Math.max(0, ...values);
  const span = Math.max(Math.abs(min), Math.abs(max), 1);
  const pad = span * padRatio;
  // Più aria a destra: etichette dei positivi e dei negativi (accanto allo zero).
  return [min - pad * 0.35, max + pad];
}

function formatSignedTick(value: number, digits = 1): string {
  if (!Number.isFinite(value)) return "";
  const rounded = Number(value.toFixed(digits));
  if (Object.is(rounded, -0) || Math.abs(rounded) < 10 ** -digits / 2) return "0";
  const body = Math.abs(rounded).toLocaleString("it-IT", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
  return `${rounded > 0 ? "+" : rounded < 0 ? "−" : ""}${body}`;
}

function TooltipCard({
  title,
  rows,
}: {
  title: string;
  rows: Array<{ label: string; value: string; tone?: "up" | "down" | "flat" }>;
}) {
  return (
    <div className={styles.tooltip}>
      <strong>{title}</strong>
      {rows.map((row) => (
        <div key={row.label} className={row.tone ? styles[row.tone] : undefined}>
          <span>{row.label}</span>
          <b>{row.value}</b>
        </div>
      ))}
    </div>
  );
}

export function EntrateSpeseCompareChart({ data }: { data: YearComparePoint[] }) {
  const palette = usePalette();
  return (
    <ChartShell
      title="Quanto spendiamo e quanto incassiamo"
      lead="Primo anno di ogni manovra (2023→2026). Barre scure = spese; barre chiare = entrate."
      height={400}
      ariaLabel="Confronto entrate e spese finali per manovra dal 2023 al 2026"
    >
      <BarChart
        accessibilityLayer
        data={data}
        margin={{ top: 28, right: 12, bottom: 8, left: 8 }}
        barCategoryGap="28%"
      >
        <CartesianGrid vertical={false} stroke={palette.grid} strokeDasharray="3 6" />
        <XAxis
          dataKey="year"
          axisLine={false}
          tickLine={false}
          tick={{ fill: palette.axis, fontSize: 13, fontWeight: 600 }}
        />
        <YAxis
          axisLine={false}
          tickLine={false}
          width={56}
          tick={{ fill: palette.axis, fontSize: 11 }}
          tickFormatter={(value: number) => `${value}`}
          unit=" mld"
          domain={[0, "auto"]}
        />
        <Tooltip
          cursor={{ fill: palette.cursor }}
          content={({ active, payload }) => {
            if (!active || !payload?.length) return null;
            const point = payload[0]?.payload as YearComparePoint;
            return (
              <TooltipCard
                title={point.label}
                rows={[
                  { label: "Spese finali", value: mld(point.speseMld) },
                  { label: "Entrate finali", value: mld(point.entrateMld) },
                  {
                    label: "Saldo netto da finanziare",
                    value: mld(point.saldoMld),
                    tone: point.saldoMld >= 0 ? "up" : "down",
                  },
                ]}
              />
            );
          }}
        />
        <Legend verticalAlign="top" align="right" iconType="square" wrapperStyle={{ paddingBottom: 12, fontSize: 12 }} />
        <Bar dataKey="speseMld" name="Spese" fill={palette.spese} radius={[2, 2, 0, 0]} isAnimationActive={false}>
          <LabelList
            dataKey="speseMld"
            position="top"
            formatter={(value) => (typeof value === "number" ? value.toLocaleString("it-IT") : "")}
            style={{ fill: palette.label, fontSize: 11, fontWeight: 600 }}
          />
        </Bar>
        <Bar dataKey="entrateMld" name="Entrate" fill={palette.entrate} radius={[2, 2, 0, 0]} isAnimationActive={false}>
          <LabelList
            dataKey="entrateMld"
            position="top"
            formatter={(value) => (typeof value === "number" ? value.toLocaleString("it-IT") : "")}
            style={{ fill: palette.label, fontSize: 11, fontWeight: 600 }}
          />
        </Bar>
      </BarChart>
    </ChartShell>
  );
}

export function MissionSpendChart({
  data,
  year,
}: {
  data: MissionSpendPoint[];
  year: number;
}) {
  const palette = usePalette();
  return (
    <ChartShell
      title={`Dove vanno i soldi nel ${year}`}
      lead="Le 10 voci di spesa più grandi previste dalla legge di bilancio."
      height={Math.max(480, data.length * 58)}
      ariaLabel={`Missioni con maggiore stanziamento nel ${year}`}
      glossary={[
        {
          term: "Missione",
          meaning:
            "Grande capitolo di spesa dello Stato (scuola, sanità, debito, difesa…). È dove la legge mette i soldi, non un pagamento già fatto.",
        },
      ]}
    >
      <BarChart
        accessibilityLayer
        data={data}
        layout="vertical"
        margin={{ top: 8, right: 84, bottom: 8, left: 12 }}
      >
        <CartesianGrid horizontal={false} stroke={palette.grid} strokeDasharray="3 6" />
        <XAxis
          type="number"
          axisLine={false}
          tickLine={false}
          tick={{ fill: palette.axis, fontSize: 11 }}
          tickFormatter={(value: number) => `${value}`}
          unit=" mld"
        />
        <YAxis
          type="category"
          dataKey="mission"
          width={268}
          interval={0}
          axisLine={false}
          tickLine={false}
          tick={<WrappedCategoryTick fill={palette.label} maxChars={32} />}
        />
        <Tooltip
          cursor={{ fill: palette.cursor }}
          content={({ active, payload }) => {
            if (!active || !payload?.length) return null;
            const point = payload[0]?.payload as MissionSpendPoint;
            return (
              <TooltipCard
                title={point.mission}
                rows={[{ label: `Previsto ${year}`, value: mld(point.amountMld) }]}
              />
            );
          }}
        />
        <Bar dataKey="amountMld" radius={[0, 2, 2, 0]} minPointSize={3} isAnimationActive={false}>
          <LabelList
            dataKey="amountMld"
            position="right"
            formatter={(value) =>
              typeof value === "number" ? `${value.toLocaleString("it-IT")} mld` : ""
            }
            style={{ fill: palette.label, fontSize: 11, fontWeight: 600 }}
          />
          {data.map((point) => (
            <Cell key={point.mission} fill={palette.spese} />
          ))}
        </Bar>
      </BarChart>
    </ChartShell>
  );
}

export function MissionDeltaChart({
  data,
  fromYear,
  toYear,
}: {
  data: MissionDeltaPoint[];
  fromYear: number;
  toYear: number;
}) {
  const palette = usePalette();
  const domain = divergingDomain(data.map((point) => point.deltaMld));
  return (
    <ChartShell
      title={`Cosa cambia dal ${fromYear} al ${toYear}`}
      lead="A destra cresce, a sinistra si riduce. Scegli l’anno di confronto sopra il grafico."
      height={Math.max(520, data.length * 64)}
      ariaLabel={`Variazioni di stanziamento per missione dal ${fromYear} al ${toYear}`}
      glossary={[
        {
          term: "Missione",
          meaning:
            "Capitolo di spesa dello Stato. Qui vedi quanto cambia lo stanziamento tra due anni.",
        },
      ]}
    >
      <BarChart
        accessibilityLayer
        data={data}
        layout="vertical"
        margin={{ top: 8, right: 92, bottom: 8, left: 8 }}
      >
        <CartesianGrid horizontal={false} stroke={palette.grid} strokeDasharray="3 6" />
        <XAxis
          type="number"
          domain={domain}
          axisLine={false}
          tickLine={false}
          tick={{ fill: palette.axis, fontSize: 11 }}
          tickFormatter={(value: number) => formatSignedTick(value, 1)}
          unit=" mld"
        />
        <YAxis
          type="category"
          dataKey="short"
          width={188}
          interval={0}
          axisLine={false}
          tickLine={false}
          tick={<WrappedCategoryTick fill={palette.label} maxChars={26} />}
        />
        <ReferenceLine x={0} stroke={palette.axis} />
        <Tooltip
          cursor={{ fill: palette.cursor }}
          content={({ active, payload }) => {
            if (!active || !payload?.length) return null;
            const point = payload[0]?.payload as MissionDeltaPoint;
            return (
              <TooltipCard
                title={point.mission}
                rows={[
                  {
                    label: `Differenza ${fromYear}→${toYear}`,
                    value: `${point.deltaMld > 0 ? "+" : ""}${mld(point.deltaMld, 2)}`,
                    tone: point.deltaMld >= 0 ? "up" : "down",
                  },
                ]}
              />
            );
          }}
        />
        <Bar dataKey="deltaMld" radius={[2, 2, 2, 2]} minPointSize={4} isAnimationActive={false}>
          <LabelList
            dataKey="deltaMld"
            content={
              <DivergingBarLabel
                fill={palette.label}
                format={(value) =>
                  `${value > 0 ? "+" : ""}${value.toLocaleString("it-IT")} mld`
                }
              />
            }
          />
          {data.map((point) => (
            <Cell key={point.mission} fill={point.deltaMld >= 0 ? palette.up : palette.down} />
          ))}
        </Bar>
      </BarChart>
    </ChartShell>
  );
}

export function ManovraShareChart({
  data,
  year,
}: {
  data: SharePoint[];
  year: number;
}) {
  const palette = usePalette();
  const domain = divergingDomain(data.map((row) => row.manovraPct), 0.32);
  return (
    <ChartShell
      title={`Cosa sposta la manovra ${year}`}
      lead="Aggregati RGS (Tav. 2.2): % sul totale e miliardi di euro ricavati dalle spese finali. «Salute e istruzione» qui sono ancora insieme; sotto le trovi separate per missione."
      height={Math.max(520, data.length * 64)}
      ariaLabel={`Incidenza della manovra ${year} per aggregato in percentuale e miliardi`}
      glossary={[
        {
          term: "Aggregato",
          meaning:
            "Raggruppamento RGS di più missioni (es. salute+istruzione). Non è il dettaglio per scuola o sanità.",
        },
        {
          term: "Euro ricavati",
          meaning:
            "Si ottengono applicando la % pubblicata alle spese finali di competenza dello stesso anno.",
        },
      ]}
    >
      <BarChart
        accessibilityLayer
        data={data}
        layout="vertical"
        margin={{ top: 8, right: 118, bottom: 8, left: 8 }}
      >
        <CartesianGrid horizontal={false} stroke={palette.grid} strokeDasharray="3 6" />
        <XAxis
          type="number"
          domain={domain}
          axisLine={false}
          tickLine={false}
          tick={{ fill: palette.axis, fontSize: 11 }}
          tickFormatter={(value: number) => pct(Number(value.toFixed(1)), 1)}
        />
        <YAxis
          type="category"
          dataKey="aggregate"
          width={250}
          interval={0}
          axisLine={false}
          tickLine={false}
          tick={<WrappedCategoryTick fill={palette.label} maxChars={28} />}
        />
        <ReferenceLine x={0} stroke={palette.axis} />
        <Tooltip
          cursor={{ fill: palette.cursor }}
          content={({ active, payload }) => {
            if (!active || !payload?.length) return null;
            const point = payload[0]?.payload as SharePoint;
            return (
              <TooltipCard
                title={point.aggregate}
                rows={[
                  {
                    label: "Effetto manovra",
                    value: pct(point.manovraPct),
                    tone: point.manovraPct >= 0 ? "up" : "down",
                  },
                  {
                    label: "Effetto in mld €",
                    value:
                      point.manovraMld == null
                        ? "n.d."
                        : `${point.manovraMld > 0 ? "+" : ""}${mld(point.manovraMld, 2)}`,
                    tone:
                      point.manovraMld == null
                        ? undefined
                        : point.manovraMld >= 0
                          ? "up"
                          : "down",
                  },
                  {
                    label: "Stanziamento aggregato",
                    value:
                      point.stanziamentoMld == null ? "n.d." : mld(point.stanziamentoMld, 1),
                  },
                ]}
              />
            );
          }}
        />
        <Bar dataKey="manovraPct" radius={[2, 2, 2, 2]} minPointSize={6} isAnimationActive={false}>
          <LabelList
            dataKey="manovraPct"
            content={
              <DivergingBarLabel
                fill={palette.label}
                format={(value) => pct(value)}
              />
            }
          />
          {data.map((point) => (
            <Cell
              key={point.aggregate}
              fill={point.manovraPct >= 0 ? palette.up : palette.down}
            />
          ))}
        </Bar>
      </BarChart>
    </ChartShell>
  );
}

export function RgsMissionSpendChart({
  data,
  year,
}: {
  data: MissionSpendPoint[];
  year: number;
}) {
  const palette = usePalette();
  return (
    <ChartShell
      title={`Missioni RGS nel ${year}`}
      lead="Stanziamenti di Tav. A.3 in miliardi di euro. Scuola, università e salute sono missioni distinte (la sanità territoriale resta soprattutto regionale)."
      height={Math.max(560, data.length * 52)}
      ariaLabel={`Missioni del bilancio dello Stato nel ${year} in miliardi di euro`}
      glossary={[
        {
          term: "Missione",
          meaning:
            "Voce ufficiale del bilancio dello Stato (istruzione scolastica, previdenza, debito…). Più fine degli aggregati della manovra.",
        },
        {
          term: "Salute (Stato)",
          meaning:
            "Solo la quota nel bilancio centrale. La gran parte della sanità passa dalle Regioni e dai trasferimenti alle autonomie.",
        },
      ]}
    >
      <BarChart
        accessibilityLayer
        data={data}
        layout="vertical"
        margin={{ top: 8, right: 84, bottom: 8, left: 12 }}
      >
        <CartesianGrid horizontal={false} stroke={palette.grid} strokeDasharray="3 6" />
        <XAxis
          type="number"
          axisLine={false}
          tickLine={false}
          tick={{ fill: palette.axis, fontSize: 11 }}
          tickFormatter={(value: number) => `${value}`}
          unit=" mld"
        />
        <YAxis
          type="category"
          dataKey="short"
          width={188}
          interval={0}
          axisLine={false}
          tickLine={false}
          tick={<WrappedCategoryTick fill={palette.label} maxChars={26} />}
        />
        <Tooltip
          cursor={{ fill: palette.cursor }}
          content={({ active, payload }) => {
            if (!active || !payload?.length) return null;
            const point = payload[0]?.payload as MissionSpendPoint;
            return (
              <TooltipCard
                title={point.mission}
                rows={[{ label: `Stanziamento ${year}`, value: mld(point.amountMld) }]}
              />
            );
          }}
        />
        <Bar dataKey="amountMld" radius={[0, 2, 2, 0]} minPointSize={3} isAnimationActive={false}>
          <LabelList
            dataKey="amountMld"
            position="right"
            formatter={(value) =>
              typeof value === "number" ? `${value.toLocaleString("it-IT")} mld` : ""
            }
            style={{ fill: palette.label, fontSize: 11, fontWeight: 600 }}
          />
          {data.map((point) => (
            <Cell key={point.mission} fill={palette.spese} />
          ))}
        </Bar>
      </BarChart>
    </ChartShell>
  );
}

export function CompositionChart({ data }: { data: CompositionPoint[] }) {
  const palette = usePalette();
  return (
    <ChartShell
      title="Di che sono fatte entrate e spese"
      lead="Due barre per anno: a sinistra le entrate, a destra le spese."
      height={400}
      ariaLabel="Composizione di entrate e spese nel triennio della manovra"
      glossary={[
        {
          term: "Tasse e imposte",
          meaning: "Soldi che lo Stato incassa da IRPEF, IVA, IRES e altre imposte (entrate tributarie).",
        },
        {
          term: "Altre entrate",
          meaning:
            "Entrate non fiscali: contributi, dividendi, sanzioni, rimborsi e simili (entrate extra-tributarie).",
        },
        {
          term: "Vendite e dismissioni",
          meaning:
            "Incassi da vendita di beni o quote pubbliche (alienazioni e ammortamenti).",
        },
        {
          term: "Spese correnti",
          meaning: "Costi di funzionamento: stipendi, servizi, interessi sul debito, trasferimenti.",
        },
        {
          term: "Spese in conto capitale",
          meaning: "Investimenti e opere: infrastrutture, edifici, macchinari, partecipazioni.",
        },
      ]}
    >
      <BarChart
        accessibilityLayer
        data={data}
        margin={{ top: 16, right: 12, bottom: 8, left: 8 }}
      >
        <CartesianGrid vertical={false} stroke={palette.grid} strokeDasharray="3 6" />
        <XAxis
          dataKey="year"
          axisLine={false}
          tickLine={false}
          tick={{ fill: palette.axis, fontSize: 13, fontWeight: 600 }}
        />
        <YAxis
          axisLine={false}
          tickLine={false}
          width={56}
          tick={{ fill: palette.axis, fontSize: 11 }}
          tickFormatter={(value: number) => `${value}`}
          unit=" mld"
        />
        <Tooltip
          cursor={{ fill: palette.cursor }}
          content={({ active, payload, label }) => {
            if (!active || !payload?.length) return null;
            return (
              <TooltipCard
                title={`Anno ${label}`}
                rows={payload.map((entry) => ({
                  label: String(entry.name),
                  value: mld(Number(entry.value ?? 0)),
                }))}
              />
            );
          }}
        />
        <Legend verticalAlign="top" align="right" iconType="square" wrapperStyle={{ fontSize: 12 }} />
        <Bar
          dataKey="tributarieMld"
          name="Tasse e imposte"
          stackId="e"
          fill={palette.entrate}
          isAnimationActive={false}
        />
        <Bar
          dataKey="extraMld"
          name="Altre entrate"
          stackId="e"
          fill="#9db7ca"
          isAnimationActive={false}
        />
        <Bar
          dataKey="alienazioniMld"
          name="Vendite e dismissioni"
          stackId="e"
          fill="#bca0ed"
          isAnimationActive={false}
        />
        <Bar
          dataKey="correntiMld"
          name="Spese correnti"
          stackId="s"
          fill={palette.spese}
          isAnimationActive={false}
        />
        <Bar
          dataKey="capitaleMld"
          name="Spese in conto capitale"
          stackId="s"
          fill={palette.lineDeficit}
          isAnimationActive={false}
        />
      </BarChart>
    </ChartShell>
  );
}

export function MissionHistoryChart({
  data,
  title = "Totale spesa per missione nel tempo",
  lead = "Somma di tutti i capitoli di spesa previsti dalla legge di bilancio, anno per anno.",
  ariaLabel = "Totale stanziamenti per missione per anno",
}: {
  data: MissionTotalPoint[];
  title?: string;
  lead?: string;
  ariaLabel?: string;
}) {
  const palette = usePalette();
  return (
    <ChartShell
      title={title}
      lead={lead}
      height={360}
      ariaLabel={ariaLabel}
      glossary={[
        {
          term: "Missione",
          meaning: "Capitolo di spesa dello Stato. Qui sommiamo tutte le missioni di ogni anno.",
        },
      ]}
    >
      <AreaChart
        accessibilityLayer
        data={data}
        margin={{ top: 16, right: 16, bottom: 8, left: 8 }}
      >
        <CartesianGrid stroke={palette.grid} strokeDasharray="3 6" />
        <XAxis
          dataKey="year"
          axisLine={false}
          tickLine={false}
          tick={{ fill: palette.axis, fontSize: 12, fontWeight: 600 }}
        />
        <YAxis
          axisLine={false}
          tickLine={false}
          width={56}
          tick={{ fill: palette.axis, fontSize: 11 }}
          tickFormatter={(value: number) => `${value}`}
          unit=" mld"
        />
        <Tooltip
          content={({ active, payload, label }) => {
            if (!active || !payload?.length) return null;
            return (
              <TooltipCard
                title={`Anno ${label}`}
                rows={[
                  {
                    label: "Totale missioni",
                    value: mld(Number(payload[0]?.value ?? 0)),
                  },
                ]}
              />
            );
          }}
        />
        <Area
          type="monotone"
          dataKey="totalMld"
          name="Totale missioni"
          stroke={palette.area}
          fill={palette.area}
          fillOpacity={0.22}
          strokeWidth={2.5}
          isAnimationActive={false}
        />
      </AreaChart>
    </ChartShell>
  );
}

export function PilPathChart({ data }: { data: PilPoint[] }) {
  const palette = usePalette();
  const leftValues = data.flatMap((point) =>
    [point.indebitamento, point.primario].filter(
      (value): value is number => value != null && Number.isFinite(value),
    ),
  );
  const debtValues = data
    .map((point) => point.debito)
    .filter((value): value is number => value != null && Number.isFinite(value));
  const leftMin = leftValues.length ? Math.min(...leftValues) : -5;
  const leftMax = leftValues.length ? Math.max(...leftValues) : 5;
  // Keep 0 in view and give saldi room so the deficit/primary paths do not flatten.
  const leftPad = Math.max(0.6, (leftMax - leftMin) * 0.25);
  const leftDomain: [number, number] = [
    Math.min(leftMin - leftPad, -0.5),
    Math.max(leftMax + leftPad, 0.5),
  ];
  const debtMin = debtValues.length ? Math.min(...debtValues) : 120;
  const debtMax = debtValues.length ? Math.max(...debtValues) : 140;
  const debtSpan = Math.max(1, debtMax - debtMin);
  // Extra floor padding pulls debt into the upper half so it does not sit on the deficit line.
  const debtDomain: [number, number] = [
    Math.floor(debtMin - Math.max(4, debtSpan * 2.2)),
    Math.ceil(debtMax + Math.max(1, debtSpan * 0.6)),
  ];

  return (
    <ChartShell
      title="Percorso % del PIL"
      lead="Sinistra: indebitamento e saldo primario. Destra: debito pubblico. Scale separate per leggerli entrambi."
      height={400}
      ariaLabel="Percorso programmatico combinato: indebitamento e primario a sinistra, debito a destra, in percentuale del PIL"
      glossary={[
        {
          term: "Indebitamento netto",
          meaning: "Quanto lo Stato spende in più di quanto incassa, in % del PIL.",
        },
        {
          term: "Saldo primario",
          meaning: "Entrate meno spese, senza contare gli interessi sul debito.",
        },
        {
          term: "Debito pubblico",
          meaning: "Stock totale del debito dello Stato rispetto al PIL.",
        },
      ]}
    >
      <LineChart
        accessibilityLayer
        data={data}
        margin={{ top: 12, right: 18, bottom: 8, left: 8 }}
      >
        <CartesianGrid stroke={palette.grid} strokeDasharray="3 6" />
        <XAxis
          dataKey="year"
          axisLine={false}
          tickLine={false}
          tick={{ fill: palette.axis, fontSize: 12, fontWeight: 600 }}
        />
        <YAxis
          yAxisId="saldi"
          orientation="left"
          axisLine={false}
          tickLine={false}
          width={52}
          domain={leftDomain}
          tick={{ fill: palette.axis, fontSize: 11 }}
          tickFormatter={(value: number) =>
            `${value.toLocaleString("it-IT", { maximumFractionDigits: 1 })}%`
          }
          label={{
            value: "Saldi",
            angle: -90,
            position: "insideLeft",
            offset: 4,
            style: { fill: palette.axis, fontSize: 11 },
          }}
        />
        <YAxis
          yAxisId="debito"
          orientation="right"
          axisLine={false}
          tickLine={false}
          width={56}
          domain={debtDomain}
          tick={{ fill: palette.lineDebt, fontSize: 11 }}
          tickFormatter={(value: number) =>
            `${value.toLocaleString("it-IT", { maximumFractionDigits: 1 })}%`
          }
          label={{
            value: "Debito",
            angle: 90,
            position: "insideRight",
            offset: 4,
            style: { fill: palette.lineDebt, fontSize: 11 },
          }}
        />
        <Tooltip
          content={({ active, payload, label }) => {
            if (!active || !payload?.length) return null;
            return (
              <TooltipCard
                title={`Anno ${label}`}
                rows={payload.map((entry) => ({
                  label: String(entry.name),
                  value:
                    entry.value == null
                      ? "—"
                      : `${Number(entry.value).toLocaleString("it-IT", {
                          maximumFractionDigits: 1,
                        })}%`,
                }))}
              />
            );
          }}
        />
        <Legend verticalAlign="top" align="right" iconType="plainline" wrapperStyle={{ fontSize: 12 }} />
        <ReferenceLine yAxisId="saldi" y={0} stroke={palette.axis} strokeDasharray="4 4" />
        <Line
          yAxisId="saldi"
          type="monotone"
          dataKey="indebitamento"
          name="Indebitamento netto (asse sx)"
          stroke={palette.lineDeficit}
          strokeWidth={2.5}
          dot={{ r: 3 }}
          connectNulls
          isAnimationActive={false}
        />
        <Line
          yAxisId="saldi"
          type="monotone"
          dataKey="primario"
          name="Saldo primario (asse sx)"
          stroke={palette.linePrimary}
          strokeWidth={2.5}
          dot={{ r: 3 }}
          connectNulls
          isAnimationActive={false}
        />
        <Line
          yAxisId="debito"
          type="monotone"
          dataKey="debito"
          name="Debito pubblico (asse dx)"
          stroke={palette.lineDebt}
          strokeWidth={2.5}
          dot={{ r: 3 }}
          connectNulls
          isAnimationActive={false}
        />
      </LineChart>
    </ChartShell>
  );
}
