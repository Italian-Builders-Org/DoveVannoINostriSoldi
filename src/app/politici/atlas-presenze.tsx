"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { RepublicMap } from "@/lib/politici-repubblica";
import type { PresenceDistribution } from "@/lib/politici-presenze";
import { filterPresenceRows, histogram, summarize, tailRows, type PresenceBin, type PresenceRow, type PresenceSummary } from "@/lib/politici-presenze-stats";
import { longDate, type GraphSelection } from "./atlas-model";
import { Icon, Portrait, SourceLink, Status } from "./atlas-primitives";
import styles from "./politici.module.css";
import local from "./atlas-presenze.module.css";

const percent = new Intl.NumberFormat("it-IT", { maximumFractionDigits: 1, minimumFractionDigits: 1 });
const pct = (value: number) => `${percent.format(value)}%`;
const BIN_WIDTH = 5;
const TAIL_PREVIEW = 12;

/**
 * Atlas view "Presenze" (#871): how participation in the Camera's electronic votes
 * is distributed, with mean, median and percentiles, per group and in the tail.
 * Summaries follow the atlas filters (famiglia, incarico, ricerca).
 */
export function PresenceDistributionView({
  data,
  map,
  family,
  role,
  query,
  selectedId,
  onFamily,
  onSelect,
}: {
  data: PresenceDistribution;
  map: RepublicMap;
  family: string | null;
  role: string;
  query: string;
  selectedId: string | null;
  onFamily: (family: string | null) => void;
  onSelect: (selection: GraphSelection) => void;
}) {
  const rows = useMemo(() => filterPresenceRows(data.rows, { family, role, query }), [data.rows, family, role, query]);
  const summary = useMemo(() => summarize(rows.map((row) => row.presence)), [rows]);
  const filtered = rows.length !== data.rows.length;

  return <section className={local.view} aria-label="Distribuzione delle presenze alla Camera" data-presence-view="">
    <div className={styles.chamberHeading}>
      <div>
        <p className={styles.eyebrow}>Partecipazione alle votazioni elettroniche</p>
        <h2>Presenze alla Camera</h2>
      </div>
      <span className={styles.tag} data-presence-count={rows.length}>{rows.length} {rows.length === 1 ? "deputato" : "deputati"}</span>
    </div>
    <p className={styles.sectionLead}>
      Quanto partecipano i deputati alle votazioni in Aula: la distribuzione completa, i valori tipici e la coda di chi vota meno.
      {" "}{data.periodLabel}.
    </p>
    <p className={local.chamberNote} role="note">
      <Icon name="info" size={16} />
      <span>Solo Camera. {data.senateGap}</span>
    </p>
    {filtered ? <p className={styles.note} role="status" data-presence-filtered="">
      Filtri attivi: {rows.length} di {data.rows.length} righe della tabella ufficiale.
    </p> : null}
    {!summary ? <Status title="Nessun deputato corrisponde ai filtri">Cambia ricerca, famiglia politica o incarico.</Status> : <>
      <SummaryTiles summary={summary} />
      <Histogram rows={rows} summary={summary} />
      <GroupDistributions rows={rows} family={family} onFamily={onFamily} />
      <Tail rows={rows} summary={summary} map={map} selectedId={selectedId} onSelect={onSelect} />
    </>}
    <Method data={data} />
  </section>;
}

function SummaryTiles({ summary }: { summary: PresenceSummary; }) {
  const skew = summary.median - summary.mean;
  return <>
    <dl className={local.tiles} data-presence-summary="">
      <div data-stat="mean"><dt>Media</dt><dd>{pct(summary.mean)}</dd></div>
      <div data-stat="median"><dt>Mediana</dt><dd>{pct(summary.median)}</dd></div>
      <div data-stat="p10"><dt>10° percentile</dt><dd>{pct(summary.p10)}</dd></div>
      <div data-stat="p90"><dt>90° percentile</dt><dd>{pct(summary.p90)}</dd></div>
    </dl>
    <p className={local.reading}>
      Metà dei deputati ha partecipato ad almeno il {pct(summary.median)} delle votazioni; uno su dieci a meno del {pct(summary.p10)}.
      {" "}{skew >= 1
        ? `La media è più bassa della mediana di ${percent.format(skew)} punti: i valori sono simili per la maggior parte, ma una coda di presenze basse la trascina in giù.`
        : "Media e mediana sono vicine: la distribuzione non ha una coda marcata."}
    </p>
  </>;
}

const CHART = { width: 640, height: 240, left: 34, right: 12, top: 30, bottom: 26 };

/**
 * The viewBox follows the rendered width so axis labels keep their size at 390px
 * instead of shrinking with the drawing. The server renders the desktop width.
 */
function useChartWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(CHART.width);
  useEffect(() => {
    const element = ref.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => {
      const next = Math.round(entry?.contentRect.width ?? 0);
      if (next > 0) setWidth(Math.max(280, Math.min(900, next)));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return { ref, width };
}

function Histogram({ rows, summary }: { rows: readonly PresenceRow[]; summary: PresenceSummary; }) {
  const bins = useMemo(() => histogram(rows.map((row) => row.presence), BIN_WIDTH), [rows]);
  const [active, setActive] = useState<number | null>(null);
  const titleId = useId();
  const { ref, width } = useChartWidth();
  const compact = width < 480;
  const height = compact ? 210 : CHART.height;
  const plotWidth = width - CHART.left - CHART.right;
  const top = compact ? 44 : CHART.top;
  const plotHeight = height - top - CHART.bottom;
  const maxCount = Math.max(1, ...bins.map((bin) => bin.count));
  const step = niceStep(maxCount);
  const yMax = Math.ceil(maxCount / step) * step;
  const x = (value: number) => CHART.left + (value / 100) * plotWidth;
  const y = (count: number) => top + plotHeight - (count / yMax) * plotHeight;
  const ticks = Array.from({ length: Math.floor(yMax / step) + 1 }, (_, index) => index * step);
  const labels = placeLabels([
    { kind: "mean", x: x(summary.mean), text: `Media ${pct(summary.mean)}` },
    { kind: "median", x: x(summary.median), text: `Mediana ${pct(summary.median)}` },
  ], CHART.left, width - CHART.right);
  const readout = active === null ? null : bins[active]!;

  return <figure className={local.figure} aria-labelledby={titleId}>
    <figcaption id={titleId} className={local.figureTitle}>
      <strong>Distribuzione delle presenze</strong>
      <span>Numero di deputati per fascia di {BIN_WIDTH} punti percentuali</span>
    </figcaption>
    <p className={local.readout} aria-live="polite" data-presence-readout="">
      {readout ? <>
        <strong>da {readout.from} a {readout.to}%</strong> · {readout.count} {readout.count === 1 ? "deputato" : "deputati"}
      </> : <>Passa sopra o tocca una barra per leggere la fascia.</>}
    </p>
    <div ref={ref}>
    <svg className={local.histogram} viewBox={`0 0 ${width} ${height}`} data-chart-width={width} role="img" aria-label={`Istogramma: media ${pct(summary.mean)}, mediana ${pct(summary.median)}, 10° percentile ${pct(summary.p10)}, 90° percentile ${pct(summary.p90)}.`} onPointerLeave={() => setActive(null)}>
      <rect className={local.band} x={x(summary.p10)} y={top} width={Math.max(1, x(summary.p90) - x(summary.p10))} height={plotHeight} />
      {ticks.map((tick) => <g key={tick}>
        <line className={local.grid} x1={CHART.left} x2={width - CHART.right} y1={y(tick)} y2={y(tick)} />
        <text className={local.axisLabel} x={CHART.left - 6} y={y(tick)} dy="0.32em" textAnchor="end">{tick}</text>
      </g>)}
      {(compact ? [0, 50, 100] : [0, 25, 50, 75, 100]).map((tick) => <text key={tick} className={local.axisLabel} x={x(tick)} y={height - 6} textAnchor={tick === 0 ? "start" : tick === 100 ? "end" : "middle"}>{tick}%</text>)}
      {bins.map((bin, index) => {
        const left = x(bin.from) + 1;
        const width = Math.max(1, x(bin.to) - x(bin.from) - 2);
        return <g key={bin.from} data-bin={`${bin.from}-${bin.to}`} data-count={bin.count} data-active={active === index ? "true" : undefined} onPointerEnter={() => setActive(index)}>
          <rect className={local.hit} x={x(bin.from)} y={top} width={x(bin.to) - x(bin.from)} height={plotHeight} />
          {bin.count > 0 ? <path className={local.bar} d={topRoundedBar(left, y(bin.count), width, y(0) - y(bin.count))} /> : null}
        </g>;
      })}
      <line className={local.baseline} x1={CHART.left} x2={width - CHART.right} y1={y(0)} y2={y(0)} />
      {labels.map((label) => <Marker key={label.kind} {...label} top={top} bottom={y(0)} />)}
    </svg>
    </div>
    <ul className={local.legend} aria-label="Legenda">
      <li><span className={local.legendBar} aria-hidden="true" />Deputati per fascia</li>
      <li><span className={local.legendMedian} aria-hidden="true" />Mediana</li>
      <li><span className={local.legendMean} aria-hidden="true" />Media</li>
      <li><span className={local.legendBand} aria-hidden="true" />Tra 10° e 90° percentile</li>
    </ul>
    <BinTable bins={bins} />
  </figure>;
}

type MarkerLabel = { kind: "mean" | "median"; x: number; text: string; anchor: "start" | "end"; row: number; };

/**
 * Lower value to the left of its line, higher to the right; a label that would
 * leave the plot flips side, and two labels on the same side take two rows.
 */
function placeLabels(items: ReadonlyArray<Pick<MarkerLabel, "kind" | "x" | "text">>, left: number, right: number): MarkerLabel[] {
  const width = (text: string) => text.length * 6.6;
  const sorted = [...items].sort((a, b) => a.x - b.x);
  const placed = sorted.map((item, index): MarkerLabel => {
    let anchor: MarkerLabel["anchor"] = index === 0 ? "end" : "start";
    if (anchor === "start" && item.x + 5 + width(item.text) > right) anchor = "end";
    if (anchor === "end" && item.x - 5 - width(item.text) < left) anchor = "start";
    return { ...item, anchor, row: 0 };
  });
  // The label that runs across the other marker's line goes above it; that line stops below.
  if (placed.length === 2 && placed[0]!.anchor === placed[1]!.anchor) placed[placed[0]!.anchor === "end" ? 1 : 0]!.row = 1;
  return placed;
}

function Marker({ kind, x, top, bottom, text, anchor, row }: MarkerLabel & { top: number; bottom: number; }) {
  const labelY = top - 10 - row * 14;
  return <g className={kind === "mean" ? local.meanMarker : local.medianMarker} data-marker={kind}>
    <line x1={x} x2={x} y1={labelY + 4} y2={bottom} />
    <text x={anchor === "end" ? x - 5 : x + 5} y={labelY} textAnchor={anchor}>{text}</text>
  </g>;
}

function BinTable({ bins }: { bins: readonly PresenceBin[]; }) {
  return <details className={styles.disclosure}>
    <summary>Tabella dei dati</summary>
    <table className={local.table}>
      <caption className={styles.srOnly}>Deputati per fascia di presenza</caption>
      <thead><tr><th scope="col">Fascia di presenza</th><th scope="col">Deputati</th></tr></thead>
      <tbody>{bins.map((bin) => <tr key={bin.from}><th scope="row">da {bin.from} a {bin.to}%</th><td>{bin.count}</td></tr>)}</tbody>
    </table>
  </details>;
}

type GroupSummary = { id: string | null; shortLabel: string; label: string; summary: PresenceSummary; values: number[]; };

function GroupDistributions({ rows, family, onFamily }: { rows: readonly PresenceRow[]; family: string | null; onFamily: (family: string | null) => void; }) {
  const groups = useMemo(() => {
    const byKey = new Map<string, { group: PresenceRow["group"]; values: number[]; }>();
    for (const row of rows) {
      const key = row.group.id ?? `label:${row.group.label}`;
      const entry = byKey.get(key) ?? { group: row.group, values: [] };
      entry.values.push(row.presence);
      byKey.set(key, entry);
    }
    return [...byKey.values()]
      .map(({ group, values }): GroupSummary => ({ ...group, values, summary: summarize(values)! }))
      .sort((a, b) => b.summary.median - a.summary.median || b.summary.count - a.summary.count || a.label.localeCompare(b.label, "it"));
  }, [rows]);

  return <section className={local.block} aria-labelledby="presenze-gruppi">
    <div className={styles.sectionHeading}>
      <h3 id="presenze-gruppi" className={local.blockTitle}>Per gruppo parlamentare</h3>
      <span className={styles.tag}>{groups.length} {groups.length === 1 ? "gruppo" : "gruppi"}</span>
    </div>
    <p className={styles.note}>
      Ogni punto è un deputato. Il riquadro va dal 25° al 75° percentile, la linea verticale è la mediana, il rombo la media; i baffi arrivano al 10° e al 90° percentile.
      Gruppi ordinati per mediana. Tocca un gruppo per filtrare l’intera vista.
    </p>
    <div className={local.stripAxis} aria-hidden="true">
      <span>0%</span><span>50%</span><span>100%</span>
    </div>
    <ul className={local.groupList}>
      {groups.map((group) => {
        const pressed = Boolean(family) && family === group.id;
        return <li key={group.id ?? group.label}>
          <button
            type="button"
            className={local.groupRow}
            aria-pressed={group.id ? pressed : undefined}
            disabled={!group.id}
            data-family={group.id ?? undefined}
            data-group-row={group.id ?? group.label}
            data-median={group.summary.median}
            title={group.label}
            onClick={() => { if (group.id) onFamily(pressed ? null : group.id); }}>
            <span className={local.groupHead}>
              <span className={local.groupSwatch} aria-hidden="true" />
              <strong>{group.shortLabel}</strong>
              <span className={local.groupCount}>{group.summary.count}</span>
              <span className={local.groupStats}>mediana {pct(group.summary.median)} · media {pct(group.summary.mean)}</span>
            </span>
            <GroupStrip group={group} />
          </button>
        </li>;
      })}
    </ul>
  </section>;
}

/** HTML rather than a stretched SVG: dots stay round at every width. */
function GroupStrip({ group }: { group: GroupSummary; }) {
  const { summary } = group;
  const at = (value: number) => `${value}%`;
  return <span className={local.strip} aria-hidden="true">
    <span className={local.stripTrack} />
    <span className={local.whisker} style={{ left: at(summary.p10), width: at(summary.p90 - summary.p10) }} />
    <span className={local.box} style={{ left: at(summary.p25), width: at(summary.p75 - summary.p25) }} />
    {group.values.map((value, index) => <span key={index} className={local.dot} style={{ left: at(value), top: `calc(50% + ${(jitter(index) * 10).toFixed(2)}px)` }} />)}
    <span className={local.boxMedian} style={{ left: at(summary.median) }} />
    <span className={local.boxMean} style={{ left: at(summary.mean) }} />
  </span>;
}

function Tail({ rows, summary, map, selectedId, onSelect }: { rows: readonly PresenceRow[]; summary: PresenceSummary; map: RepublicMap; selectedId: string | null; onSelect: (selection: GraphSelection) => void; }) {
  const tail = useMemo(() => tailRows(rows), [rows]);
  const people = useMemo(() => new Map(map.people.map((person) => [person.id, person])), [map.people]);
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? tail : tail.slice(0, TAIL_PREVIEW);
  const withRole = tail.filter((row) => row.roleLabel).length;
  return <section className={local.block} aria-labelledby="presenze-coda">
    <div className={styles.sectionHeading}>
      <h3 id="presenze-coda" className={local.blockTitle}>La coda: chi vota meno</h3>
      <span className={styles.tag}>{tail.length}</span>
    </div>
    <p className={styles.note}>
      Deputati con presenze pari o inferiori al 10° percentile ({pct(summary.p10)}).
      {withRole ? ` ${withRole} di loro ${withRole === 1 ? "ha" : "hanno"} un incarico di Governo o di Presidenza, che riduce la presenza in Aula per ruolo.` : ""}
      {" "}Il dato non distingue gli impegni istituzionali dalle assenze.
    </p>
    <ul className={local.tailList}>
      {visible.map((row) => {
        const person = row.personId ? people.get(row.personId) : undefined;
        return <li key={row.key}>
          <button
            type="button"
            className={styles.convictionRow}
            data-tail-row={row.personId ?? row.key}
            data-selected={selectedId && row.personId === selectedId ? "true" : undefined}
            disabled={!person}
            onClick={() => { if (person) onSelect({ kind: "person", id: person.id }); }}>
            {person ? <Portrait person={person} size={40} /> : <span className={styles.convictionInitials} aria-hidden="true">{row.name.slice(0, 2).toLocaleUpperCase("it-IT")}</span>}
            <span className={styles.convictionBody}>
              <span className={styles.convictionName}>
                <strong>{row.name}</strong>
                {row.roleLabel ? <span className={local.roleBadge}>{row.roleLabel}</span> : null}
              </span>
              <span className={styles.convictionMeta}>
                {row.group.shortLabel} · voti {pct(row.votesPercent)} · missioni {pct(row.missionsPercent)} · assenze {pct(row.absencesPercent)}
              </span>
            </span>
            <span className={local.tailValue}>{pct(row.presence)}</span>
          </button>
        </li>;
      })}
    </ul>
    {tail.length > TAIL_PREVIEW ? <button type="button" className={styles.textButton} aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>
      {expanded ? "Mostra meno" : `Mostra tutti i ${tail.length}`}
    </button> : null}
  </section>;
}

function Method({ data }: { data: PresenceDistribution; }) {
  return <details className={styles.disclosure} data-presence-method="">
    <summary>Come si contano presenze, assenze e missioni</summary>
    <ul className={styles.bulletList}>
      <li><strong>Presenza</strong> = voti espressi (favorevole, contrario, astenuto) + missioni, in percentuale delle votazioni elettroniche del periodo.</li>
      <li><strong>Missione</strong>: assenza per incarichi istituzionali autorizzati. Conta come presenza nella statistica della Camera, ma non è una presenza fisica in Aula.</li>
      <li><strong>Assenza</strong>: nessun voto e nessuna missione. La Camera indica a parte le assenze giustificate.</li>
      <li>Media e mediana sono calcolate qui sulle {data.coverage.rows} righe della tabella ufficiale, senza pesi; i percentili usano l’interpolazione lineare.</li>
      <li>Il gruppo è quello indicato dalla Camera nella tabella del periodo: chi ha cambiato gruppo dopo può comparire altrove nell’emiciclo di oggi.</li>
      {data.caveats.map((caveat) => <li key={caveat}>{caveat}</li>)}
    </ul>
    <p className={styles.note}>
      Periodo: {data.periodLabel}. Dati aggiornati al {longDate(data.observedDate)}, acquisiti il {longDate(data.acquiredAt)}. {data.license}.
    </p>
    <SourceLink href={data.sourceUrl}>{data.sourceLabel}</SourceLink>
  </details>;
}

/** Deterministic vertical offset in [-1, 1]: same picture on server and client. */
function jitter(index: number): number {
  const value = Math.sin((index + 1) * 12.9898) * 43758.5453;
  return (value - Math.floor(value)) * 2 - 1;
}

function niceStep(max: number): number {
  const raw = max / 4;
  const power = 10 ** Math.floor(Math.log10(Math.max(1, raw)));
  const normalized = raw / power;
  return (normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10) * power;
}

/** Bar with a 4px rounded data end and a square base on the axis. */
function topRoundedBar(x: number, y: number, width: number, height: number): string {
  const r = Math.min(4, width / 2, height);
  return `M${x},${y + height}V${y + r}Q${x},${y} ${x + r},${y}H${x + width - r}Q${x + width},${y} ${x + width},${y + r}V${y + height}Z`;
}
