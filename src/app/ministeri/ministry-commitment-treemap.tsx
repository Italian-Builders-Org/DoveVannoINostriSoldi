"use client";

import { ResponsiveContainer, Tooltip, Treemap } from "recharts";
import type { TreemapNode } from "recharts";
import type { RgsMinistry } from "@/lib/data/rgs-ministries-contract";
import { institutionalCategoryColor } from "@/lib/chart-category-colors";
import styles from "./ministry-commitment-treemap.module.css";


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

type MinistryNode = TreemapNode & {
  code?: string;
  fullLabel?: string;
  shortLabel?: string;
  totalCpCents?: number;
  share?: number;
};

const SHORT_LABELS: Readonly<Record<string, string>> = {
  "02": "Economia e finanze",
  "03": "Imprese",
  "04": "Lavoro",
  "05": "Giustizia",
  "06": "Esteri",
  "07": "Istruzione",
  "08": "Interno",
  "09": "Ambiente",
  "10": "Infrastrutture",
  "11": "Università",
  "12": "Difesa",
  "13": "Agricoltura",
  "14": "Cultura",
  "15": "Salute",
  "16": "Turismo",
};

function shortLabel(code: string): string {
  return SHORT_LABELS[code] ?? code;
}

function tile(props: TreemapNode) {
  const node = props as MinistryNode;
  const showLabel = node.width >= Math.max(118, (node.shortLabel?.length ?? 0) * 7.5 + 24) && node.height >= 62;
  const showShare = node.width >= 155 && node.height >= 88;

  return (
    <g>
      <rect
        x={node.x}
        y={node.y}
        width={node.width}
        height={node.height}
        fill={`color-mix(in srgb, ${institutionalCategoryColor(node.index)} 40%, var(--color-raised))`}
        stroke="var(--color-raised)"
        strokeWidth={2}
      />
      {showLabel ? (
        <>
          <text x={node.x + node.width / 2} y={node.y + node.height / 2 - (showShare ? 12 : 0)} textAnchor="middle" className={styles.tileLabel}>
            {node.shortLabel}
          </text>
          {showShare ? (
            <text x={node.x + node.width / 2} y={node.y + node.height / 2 + 18} textAnchor="middle" className={styles.tileShare}>
              {percentage.format(node.share ?? 0)}
            </text>
          ) : null}
        </>
      ) : null}
    </g>
  );
}

export function MinistryCommitmentTreemap({ ministries }: { ministries: RgsMinistry[] }) {
  const totalCpCents = ministries.reduce((sum, ministry) => sum + ministry.commitmentsCpCents, 0);
  const data = ministries.map((ministry) => ({
    name: ministry.code,
    code: ministry.code,
    fullLabel: ministry.label,
    shortLabel: shortLabel(ministry.code),
    totalCpCents: ministry.commitmentsCpCents,
    share: ministry.commitmentsCpCents / totalCpCents,
  }));

  return (
    <figure className={styles.figure}>
      <div
        className={styles.chart}
        role="img"
        aria-label="Come si spezza il totale impegnato 2025 tra i 15 ministeri"
        aria-describedby="ministeri-totale-cp-caption"
      >
        <ResponsiveContainer width="100%" height="100%">
          <Treemap
            data={data}
            dataKey="totalCpCents"
            nameKey="fullLabel"
            nodeGap={1}
            content={tile}
            isAnimationActive={false}
          >
            <Tooltip
              content={({ active, payload }) => {
                const point = payload?.[0]?.payload as MinistryNode | undefined;
                if (!active || !point) return null;
                return (
                  <div className={styles.tooltip}>
                    <span>{point.fullLabel}</span>
                    <strong>{exactEuro.format((point.totalCpCents ?? 0) / 100)}</strong>
                    <small>{percentage.format(point.share ?? 0)} del totale dei 15 ministeri</small>
                  </div>
                );
              }}
            />
          </Treemap>
        </ResponsiveContainer>
      </div>
      <figcaption id="ministeri-totale-cp-caption">
        Quota sul totale impegnato nel 2025: pagato + ancora da pagare nell’anno (Totale CP = Pagato CP + Rimasto CP).
      </figcaption>
    </figure>
  );
}
