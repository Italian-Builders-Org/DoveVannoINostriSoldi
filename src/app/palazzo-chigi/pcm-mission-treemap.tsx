"use client";

import { ResponsiveContainer, Tooltip, Treemap } from "recharts";
import type { TreemapNode } from "recharts";
import type { PcmFinancialMission } from "@/lib/data/pcm-financial-contract";
import styles from "./pcm-mission-treemap.module.css";

const compactEuro = new Intl.NumberFormat("it-IT", {
  style: "currency",
  currency: "EUR",
  notation: "compact",
  maximumFractionDigits: 1,
});

const exactEuro = new Intl.NumberFormat("it-IT", {
  style: "currency",
  currency: "EUR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const percentage = new Intl.NumberFormat("it-IT", {
  style: "percent",
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

type MissionNode = TreemapNode & {
  shortLabel?: string;
  fullLabel?: string;
  paymentsCents?: number;
  share?: number;
};

function tile(props: TreemapNode) {
  const node = props as MissionNode;
  const showLabel = node.width >= 128 && node.height >= 62;
  const showAmount = node.width >= 150 && node.height >= 92;

  return (
    <g>
      <rect
        x={node.x}
        y={node.y}
        width={node.width}
        height={node.height}
        fill="var(--color-accent)"
        fillOpacity={0.96 - (node.index % 4) * 0.1}
        stroke="var(--color-raised)"
        strokeWidth={2}
      />
      {showLabel ? (
        <>
          <text x={node.x + 12} y={node.y + 25} className={styles.tileLabel}>
            {node.shortLabel}
          </text>
          <text x={node.x + 12} y={node.y + 45} className={styles.tileShare}>
            {percentage.format(node.share ?? 0)}
          </text>
          {showAmount ? (
            <text x={node.x + 12} y={node.y + 66} className={styles.tileAmount}>
              {compactEuro.format((node.paymentsCents ?? 0) / 100)}
            </text>
          ) : null}
        </>
      ) : null}
    </g>
  );
}

function shortLabel(label: string): string {
  const replacements: Array<[RegExp, string]> = [
    [/^Organi costituzionali.+$/i, "Presidenza e organi"],
    [/^Diritti sociali.+$/i, "Diritti sociali e famiglia"],
    [/^Servizi istituzionali.+$/i, "Servizi istituzionali"],
    [/^Competitività.+$/i, "Sviluppo delle imprese"],
    [/^Sviluppo sostenibile.+$/i, "Ambiente e territorio"],
  ];
  return replacements.find(([pattern]) => pattern.test(label))?.[1] ?? label;
}

export function PcmMissionTreemap({
  missions,
  totalCents,
}: {
  missions: PcmFinancialMission[];
  totalCents: number;
}) {
  const data = missions
    .filter((mission) => mission.paymentsCents > 0)
    .map((mission) => ({
      name: mission.code,
      shortLabel: shortLabel(mission.label === "0" ? "Voce senza descrizione" : mission.label),
      fullLabel: mission.label === "0" ? "Voce senza descrizione nella fonte" : mission.label,
      paymentsCents: mission.paymentsCents,
      share: mission.paymentsCents / totalCents,
    }));

  return (
    <figure className={styles.figure}>
      <div
        className={styles.chart}
        role="img"
        aria-label="Composizione dei pagamenti 2024 della Presidenza del Consiglio per missione"
      >
        <ResponsiveContainer width="100%" height="100%">
          <Treemap
            data={data}
            dataKey="paymentsCents"
            nameKey="fullLabel"
            nodeGap={1}
            content={tile}
            isAnimationActive={false}
          >
            <Tooltip
              content={({ active, payload }) => {
                const point = payload?.[0]?.payload as MissionNode | undefined;
                if (!active || !point) return null;
                return (
                  <div className={styles.tooltip}>
                    <span>{point.fullLabel}</span>
                    <strong>{exactEuro.format((point.paymentsCents ?? 0) / 100)}</strong>
                    <small>{percentage.format(point.share ?? 0)} del pagato PCM</small>
                  </div>
                );
              }}
            />
          </Treemap>
        </ResponsiveContainer>
      </div>
      <figcaption>
        Ogni area rappresenta la quota di una missione sul totale pagato PCM 2024. Le due missioni
        a zero restano nella tabella e non occupano area. I valori esatti sono nella tabella.
      </figcaption>
    </figure>
  );
}
