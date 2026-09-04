"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { ResponsiveContainer, Tooltip, Treemap } from "recharts";
import type { TreemapNode } from "recharts";
import { institutionalCategoryColor } from "@/lib/chart-category-colors";
import {
  computePlan,
  effectiveAmount,
  MAJOR_SHARE_THRESHOLD,
  type MissionSummary,
  netToneColor,
  scenarioPctOf,
  shortLabel,
  toneColor,
} from "./reallocation";
import styles from "./simulatore.module.css";

/** Passo del ritocco rapido con i bottoni −/+ (punti percentuali). */
const STEP_PCT = 5;

const compactEuro = new Intl.NumberFormat("it-IT", {
  style: "currency",
  currency: "EUR",
  notation: "compact",
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

const exactEuro = new Intl.NumberFormat("it-IT", {
  style: "currency",
  currency: "EUR",
  maximumFractionDigits: 0,
});

const percentage = new Intl.NumberFormat("it-IT", {
  style: "percent",
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

const integerFmt = new Intl.NumberFormat("it-IT", { maximumFractionDigits: 0 });

function signedPercent(value: number | null): string {
  if (value === null) return "n/d";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toLocaleString("it-IT", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
}

function signedCompactEuro(value: number): string {
  return `${value >= 0 ? "+" : "−"}${compactEuro.format(Math.abs(value))}`;
}

/** Miliardi con separatore di migliaia: leggibile per i grandi totali. */
function billionsEuro(value: number): string {
  return `${integerFmt.format(value / 1_000_000_000)} Mld €`;
}

export type { MissionSummary };

/** Geometria di una tile abbastanza grande da ospitare i bottoni −/+ in overlay. */
type StepTile = {
  mission: string;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
  pct: number;
};

/** Sotto questa soglia i −/+ non ci stanno: si regola da chip, HUD o slider. */
const STEP_TILE_MIN_WIDTH = 96;
const STEP_TILE_MIN_HEIGHT = 64;

function sameStepTiles(a: StepTile[], b: StepTile[]): boolean {
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index += 1) {
    const previous = a[index];
    const next = b[index];
    if (
      previous.mission !== next.mission ||
      previous.x !== next.x ||
      previous.y !== next.y ||
      previous.width !== next.width ||
      previous.height !== next.height ||
      previous.pct !== next.pct
    ) {
      return false;
    }
  }
  return true;
}

type MissionNode = TreemapNode & {
  mission?: string;
  shortLabel?: string;
  /** Importo che dimensiona il riquadro: ipotetico se la missione è stata toccata. */
  sizeEur?: number;
  observedEur?: number;
  effectiveEur?: number;
  scenarioPct?: number;
  share?: number;
  deltaPct?: number | null;
};

export function MissionPicker({
  summaries,
  selectedMission,
  onSelect,
  onAdjust,
  onClearMission,
  onClearAll,
  onShare,
  latestYear,
  scenarioByMission,
}: {
  summaries: MissionSummary[];
  selectedMission: string;
  onSelect: (mission: string) => void;
  /** Ritocco rapido: aggiunge `deltaPct` punti alla missione (e la seleziona). */
  onAdjust: (mission: string, deltaPct: number) => void;
  onClearMission: (mission: string) => void;
  onClearAll: () => void;
  onShare: () => void;
  latestYear: number;
  /** Variazione ipotetica (punti percentuali) per missione toccata. */
  scenarioByMission: Record<string, number>;
}) {
  const hatchId = useId();

  // I bottoni −/+ vivono in un layer HTML sopra il treemap, non dentro l'SVG:
  // il rendering dei <foreignObject> annidati in Recharts è inaffidabile e il
  // tooltip finiva sopra i bottoni. Ogni tile marca il suo <g> con data-*;
  // dopo il render misuriamo i rettangoli e disegniamo l'overlay HTML.
  const treemapRef = useRef<HTMLDivElement>(null);
  const [stepTiles, setStepTiles] = useState<StepTile[]>([]);

  const plan = useMemo(
    () => computePlan(summaries, scenarioByMission),
    [summaries, scenarioByMission],
  );

  const hasScenario = plan.entries.length > 0;

  const { treemapData, minor } = useMemo(() => {
    const observedTotal = summaries.reduce((acc, item) => acc + item.latestAmountEur, 0);
    const effectiveTotal = summaries.reduce(
      (acc, item) => acc + effectiveAmount(item, scenarioByMission),
      0,
    );
    const ranked = [...summaries].sort((left, right) => right.latestAmountEur - left.latestAmountEur);
    const major: MissionSummary[] = [];
    const rest: MissionSummary[] = [];
    for (const item of ranked) {
      const observedShare = observedTotal > 0 ? item.latestAmountEur / observedTotal : 0;
      if (item.latestAmountEur > 0 && observedShare >= MAJOR_SHARE_THRESHOLD) {
        major.push(item);
      } else {
        rest.push(item);
      }
    }
    return {
      minor: rest,
      treemapData: major.map((item) => {
        const observed = item.latestAmountEur;
        const effective = effectiveAmount(item, scenarioByMission);
        return {
          name: item.mission,
          mission: item.mission,
          shortLabel: shortLabel(item.mission),
          sizeEur: Math.max(effective, 1),
          observedEur: observed,
          effectiveEur: effective,
          scenarioPct: scenarioPctOf(scenarioByMission, item.mission),
          share: effectiveTotal > 0 ? effective / effectiveTotal : 0,
          deltaPct: item.realDeltaPct,
        };
      }),
    };
  }, [summaries, scenarioByMission]);

  useEffect(() => {
    const container = treemapRef.current;
    if (!container) return;

    const measure = () => {
      const next: StepTile[] = [];
      container.querySelectorAll<SVGGElement>("g[data-mission]").forEach((group) => {
        const rect = group.querySelector<SVGRectElement>("rect");
        if (!rect) return;
        const width = rect.width.baseVal.value;
        const height = rect.height.baseVal.value;
        if (width < STEP_TILE_MIN_WIDTH || height < STEP_TILE_MIN_HEIGHT) return;
        next.push({
          mission: group.dataset.mission ?? "",
          label: group.dataset.label || group.dataset.mission || "",
          x: rect.x.baseVal.value,
          y: rect.y.baseVal.value,
          width,
          height,
          pct: Number(group.dataset.pct ?? 0),
        });
      });
      setStepTiles((previous) => (sameStepTiles(previous, next) ? previous : next));
    };

    measure();
    // ResponsiveContainer può assestare le dimensioni un frame dopo il mount:
    // rimisuriamo su rAF e con un fallback, oltre che a ogni resize reale.
    const raf = requestAnimationFrame(measure);
    const timer = window.setTimeout(measure, 300);
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(timer);
      observer.disconnect();
    };
  }, [treemapData]);

  const renderTile = (props: unknown) => {
    const node = props as MissionNode;
    const width = node.width ?? 0;
    const height = node.height ?? 0;
    const mission = node.mission ?? node.name ?? "";
    // Recharts calls `content` anche per il nodo radice che avvolge l'intera area.
    if (!mission || node.depth === 0 || width <= 0 || height <= 0) return <g />;
    const x = node.x ?? 0;
    const y = node.y ?? 0;
    const selected = mission === selectedMission;
    const showLabel = width >= 46 && height >= 24;
    const showMeta = width >= 74 && height >= 46;
    const select = () => onSelect(mission);

    const pct = node.scenarioPct ?? 0;
    const adjusted = pct !== 0;
    const tone = toneColor(pct);
    // L'id del pattern include l'indice della tile: più missioni "toccate" nello
    // stesso render creerebbero altrimenti <pattern> duplicati con lo stesso id.
    const tileHatchId = `${hatchId}-${node.index ?? 0}`;
    const hatchRef = pct >= 0 ? `url(#${tileHatchId}-up)` : `url(#${tileHatchId}-down)`;
    const observed = node.observedEur ?? 0;
    const effective = node.effectiveEur ?? observed;

    // Le voci toccate mostrano il bordo nel colore del verso (verde su, rosso giù);
    // la selezione resta leggibile dallo spessore maggiore e dal velo a righe.
    const stroke = adjusted
      ? tone
      : selected
        ? "var(--color-accent-600)"
        : "var(--color-raised)";

    return (
      <g
        className={styles.tile}
        role="button"
        tabIndex={0}
        data-mission={mission}
        data-label={node.shortLabel ?? mission}
        data-pct={pct}
        aria-pressed={selected}
        aria-label={`${node.shortLabel ?? mission}: ${
          adjusted
            ? `ipotesi ${exactEuro.format(effective)} (${signedPercent(pct)} sullo stanziamento ${latestYear} di ${exactEuro.format(observed)})`
            : `stanziamento ${latestYear} ${exactEuro.format(
                observed,
              )}, variazione dello stanziamento pubblicato ${signedPercent(node.deltaPct ?? null)}`
        }`}
        onClick={select}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            select();
          }
        }}
      >
        <rect
          x={x}
          y={y}
          width={width}
          height={height}
          fill={institutionalCategoryColor(node.index ?? 0)}
          stroke={stroke}
          strokeWidth={selected ? 4 : adjusted ? 3 : 2}
          strokeDasharray={adjusted && !selected ? "5 3" : undefined}
        />
        {adjusted ? (
          <>
            <defs>
              <pattern
                id={`${tileHatchId}-up`}
                patternUnits="userSpaceOnUse"
                width="6"
                height="6"
                patternTransform="rotate(45)"
              >
                <rect width="6" height="6" fill="var(--color-positive-bg)" />
                <line x1="0" y1="0" x2="0" y2="6" stroke="var(--color-positive)" strokeWidth="2" />
              </pattern>
              <pattern
                id={`${tileHatchId}-down`}
                patternUnits="userSpaceOnUse"
                width="6"
                height="6"
                patternTransform="rotate(45)"
              >
                <rect width="6" height="6" fill="var(--color-critical-bg)" />
                <line x1="0" y1="0" x2="0" y2="6" stroke="var(--color-critical)" strokeWidth="2" />
              </pattern>
            </defs>
            {/* velo a righe: marca il riquadro come ipotesi, non dato pubblicato */}
            <rect
              x={x}
              y={y}
              width={width}
              height={height}
              fill={hatchRef}
              fillOpacity={0.2}
              pointerEvents="none"
            />
          </>
        ) : null}
        {showLabel ? (
          <foreignObject x={x} y={y} width={width} height={height} className={styles.tileFo}>
            <div className={styles.tileBox}>
              <span className={styles.tileLabel}>{node.shortLabel}</span>
              {showMeta ? (
                <span className={styles.tileMeta}>
                  {adjusted
                    ? `${compactEuro.format(observed)} → ${compactEuro.format(effective)}`
                    : `${compactEuro.format(observed)} · ${signedPercent(node.deltaPct ?? null)}`}
                </span>
              ) : null}
              {adjusted && showMeta ? (
                <span
                  className={styles.tileScenarioTag}
                  style={{
                    color: tone,
                    borderColor: tone,
                    background: pct > 0 ? "var(--color-positive-bg)" : "var(--color-critical-bg)",
                  }}
                >
                  ipotesi {signedPercent(pct)}
                </span>
              ) : null}
            </div>
          </foreignObject>
        ) : null}
      </g>
    );
  };

  return (
    <div className={styles.picker}>
      <p className={styles.pickerHeader}>Scegli una missione</p>

      {hasScenario ? (
        <div className={styles.plan}>
          <div className={styles.planHead}>
            <span>
              <span className={styles.scenarioSwatch} aria-hidden="true" /> Il tuo piano di
              riallocazione ({plan.entries.length}{" "}
              {plan.entries.length === 1 ? "missione" : "missioni"})
            </span>
            <div className={styles.planHeadActions}>
              <button type="button" className="btn btn-secondary" onClick={onClearAll}>
                Ricomincia
              </button>
              <button type="button" className="btn btn-primary" onClick={onShare}>
                Condividi la tua finanziaria
              </button>
            </div>
          </div>
          <ul className={styles.planList}>
            {plan.entries.map((entry) => (
              <li key={entry.mission}>
                <button
                  type="button"
                  className={styles.planJump}
                  onClick={() => onSelect(entry.mission)}
                >
                  {shortLabel(entry.mission)}
                </button>
                <span className={styles.planNums}>
                  <b style={{ color: toneColor(entry.pct) }}>{signedPercent(entry.pct)}</b> ipotesi
                  {entry.realDeltaPct !== null ? ` · ${signedPercent(entry.realDeltaPct)} reale` : ""}
                  {" · "}
                  {compactEuro.format(entry.observed)} → {compactEuro.format(entry.effective)}
                </span>
                <button
                  type="button"
                  className={styles.planRemove}
                  aria-label={`Rimuovi l'ipotesi su ${entry.mission}`}
                  onClick={() => onClearMission(entry.mission)}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
          {(() => {
            const scale = Math.max(plan.increasesTotal, Math.abs(plan.cutsTotal), 1);
            const netAbsShare =
              plan.observedTotal > 0 ? Math.abs(plan.net) / plan.observedTotal : 0;
            let verdict: string;
            if (plan.increasesCount > 0 && plan.cutsCount > 0 && netAbsShare < 0.0025) {
              verdict = "aumenti e tagli quasi si compensano";
            } else if (plan.net > 0) {
              verdict = "in più, da trovare come copertura";
            } else if (plan.net < 0) {
              verdict = "in meno: risorse liberate";
            } else {
              verdict = "nessuno scostamento";
            }
            return (
              <div className={styles.saldoWrap}>
                <p className={styles.saldoTitle}>Come cambia la Legge di Bilancio {latestYear}</p>
                <div className={styles.saldo}>
                  <div className={styles.saldoBars}>
                    <div className={styles.saldoRow}>
                      <span className={styles.saldoName}>Aumenti</span>
                      <span
                        className={styles.saldoValue}
                        style={
                          plan.increasesCount > 0 ? { color: "var(--color-positive)" } : undefined
                        }
                      >
                        {plan.increasesCount > 0 ? signedCompactEuro(plan.increasesTotal) : "0"}
                      </span>
                      <span className={styles.saldoTrack}>
                        {plan.increasesCount > 0 ? (
                          <i
                            className={styles.saldoBarUp}
                            style={{ inlineSize: `${(plan.increasesTotal / scale) * 100}%` }}
                          />
                        ) : null}
                      </span>
                      <span className={styles.saldoCount}>
                        {plan.increasesCount} {plan.increasesCount === 1 ? "voce" : "voci"}
                      </span>
                    </div>
                    <div className={styles.saldoRow}>
                      <span className={styles.saldoName}>Tagli</span>
                      <span
                        className={styles.saldoValue}
                        style={plan.cutsCount > 0 ? { color: "var(--color-critical)" } : undefined}
                      >
                        {plan.cutsCount > 0 ? signedCompactEuro(plan.cutsTotal) : "0"}
                      </span>
                      <span className={styles.saldoTrack}>
                        {plan.cutsCount > 0 ? (
                          <i
                            className={styles.saldoBarDown}
                            style={{ inlineSize: `${(Math.abs(plan.cutsTotal) / scale) * 100}%` }}
                          />
                        ) : null}
                      </span>
                      <span className={styles.saldoCount}>
                        {plan.cutsCount} {plan.cutsCount === 1 ? "voce" : "voci"}
                      </span>
                    </div>
                  </div>
                  <div className={styles.saldoNet} style={{ borderColor: netToneColor(plan.net) }}>
                    <span className={styles.saldoNetLabel}>Saldo netto</span>
                    <span className={styles.saldoNetValue} style={{ color: netToneColor(plan.net) }}>
                      {signedCompactEuro(plan.net)}
                    </span>
                    <span className={styles.saldoNetSub}>
                      {verdict} · {signedPercent(plan.netPct)} sul totale
                    </span>
                    <span className={styles.saldoNetSub}>
                      Bilancio <b>{billionsEuro(plan.observedTotal)}</b> →{" "}
                      <b>{billionsEuro(plan.effectiveTotal)}</b>
                    </span>
                  </div>
                </div>
                <p className={styles.planNet}>
                  Somma delle {summaries.length} missioni confrontabili (campo RGS «Legge di Bilancio
                  CP A1»), non l&apos;intera manovra; numeri tuoi, non un dato pubblicato.
                </p>
              </div>
            );
          })()}
        </div>
      ) : null}

      {hasScenario ? (
        <p className={styles.treemapBadge}>
          I riquadri qui sotto sono dimensionati sulla <b>tua ipotesi di riallocazione</b>, non sullo
          stanziamento pubblicato {latestYear}. Le voci toccate sono a righe e con bordo tratteggiato.
        </p>
      ) : null}

      <div
        ref={treemapRef}
        className={`${styles.treemap} ${hasScenario ? styles.treemapScenario : ""}`}
        style={hasScenario ? { borderColor: netToneColor(plan.net) } : undefined}
        role="group"
        aria-label={
          hasScenario
            ? `Missioni dimensionate sulla tua ipotesi di riallocazione. ${plan.entries.length} voci modificate.`
            : `Scegli una missione. I riquadri sono dimensionati sullo stanziamento pubblicato ${latestYear}; le missioni più piccole sono nell'elenco sotto il grafico.`
        }
      >
        <ResponsiveContainer width="100%" height="100%">
          <Treemap
            data={treemapData}
            dataKey="sizeEur"
            nameKey="name"
            nodeGap={2}
            content={renderTile}
            isAnimationActive={false}
          >
            <Tooltip
              position={{ x: 8, y: 8 }}
              wrapperStyle={{ pointerEvents: "none", zIndex: 1 }}
              content={({ active, payload }) => {
                const point = payload?.[0]?.payload as MissionNode | undefined;
                if (!active || !point) return null;
                const adjusted = (point.scenarioPct ?? 0) !== 0;
                return (
                  <div className={styles.tooltip}>
                    <span>{point.mission}</span>
                    <strong>{exactEuro.format(point.observedEur ?? 0)}</strong>
                    {adjusted ? (
                      <b>
                        ipotesi {exactEuro.format(point.effectiveEur ?? 0)} ({signedPercent(point.scenarioPct ?? 0)})
                        · {percentage.format(point.share ?? 0)} del totale ipotetico
                      </b>
                    ) : (
                      <b>
                        {percentage.format(point.share ?? 0)} del totale · variazione dello
                        stanziamento pubblicato{" "}
                        {signedPercent(point.deltaPct ?? null)}
                      </b>
                    )}
                  </div>
                );
              }}
            />
          </Treemap>
        </ResponsiveContainer>

        <div className={styles.tileStepLayer}>
          {stepTiles.map((tile) => (
            <span
              key={tile.mission}
              className={styles.tileSteppers}
              style={{ left: tile.x + tile.width, top: tile.y + tile.height }}
            >
              <button
                type="button"
                className={styles.tileStep}
                onClick={() => onAdjust(tile.mission, -STEP_PCT)}
                aria-label={`Riduci ${tile.label} di ${STEP_PCT} punti`}
              >
                −
              </button>
              <button
                type="button"
                className={styles.tileStep}
                onClick={() => onAdjust(tile.mission, STEP_PCT)}
                aria-label={`Aumenta ${tile.label} di ${STEP_PCT} punti`}
              >
                +
              </button>
            </span>
          ))}
        </div>
      </div>

      {minor.length > 0 ? (
        <div className={styles.minorStrip} role="group" aria-label="Missioni minori">
          <p className={styles.minorLabel}>
            Missioni minori (sotto lo {percentage.format(MAJOR_SHARE_THRESHOLD)} del totale {latestYear})
          </p>
          {minor.map((item) => {
            const selected = item.mission === selectedMission;
            const pct = scenarioPctOf(scenarioByMission, item.mission);
            const adjusted = pct !== 0;
            const effective = effectiveAmount(item, scenarioByMission);
            const label = shortLabel(item.mission);
            return (
              <div
                key={item.mission}
                className={`${styles.minorChip} ${selected ? styles.minorChipActive : ""} ${
                  adjusted ? styles.minorChipAdjusted : ""
                }`}
                style={adjusted && !selected ? { borderColor: toneColor(pct) } : undefined}
              >
                <button
                  type="button"
                  className={styles.minorChipSelect}
                  aria-pressed={selected}
                  onClick={() => onSelect(item.mission)}
                >
                  <span>{label}</span>
                  <small style={adjusted ? { color: toneColor(pct) } : undefined}>
                    {adjusted
                      ? `${compactEuro.format(item.latestAmountEur)} → ${compactEuro.format(effective)} (${signedPercent(pct)})`
                      : `${item.latestAmountEur > 0 ? compactEuro.format(item.latestAmountEur) : "≈ 0"} · ${signedPercent(item.realDeltaPct)}`}
                  </small>
                </button>
                <span className={styles.minorChipSteppers}>
                  <button
                    type="button"
                    className={styles.minorChipStep}
                    aria-label={`Riduci ${label} di ${STEP_PCT} punti`}
                    onClick={() => onAdjust(item.mission, -STEP_PCT)}
                  >
                    −
                  </button>
                  <button
                    type="button"
                    className={styles.minorChipStep}
                    aria-label={`Aumenta ${label} di ${STEP_PCT} punti`}
                    onClick={() => onAdjust(item.mission, STEP_PCT)}
                  >
                    +
                  </button>
                </span>
              </div>
            );
          })}
        </div>
      ) : null}

      <p className={styles.pickerCaption}>
        {hasScenario
          ? `Il treemap è dimensionato sulla tua ipotesi. «Ricomincia» rimette tutto sullo stanziamento pubblicato ${latestYear}.`
          : "Tocca − / + su un riquadro per aumentarlo o tagliarlo; la barra in basso segue il saldo."}
      </p>
    </div>
  );
}
