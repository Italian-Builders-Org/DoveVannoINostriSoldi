"use client";

import { ResponsiveContainer, Tooltip, Treemap } from "recharts";
import type { TreemapNode } from "recharts";
import type { IstatRegionalAdministration } from "@/lib/data/istat-regions-contract";
import styles from "./region-title-treemap.module.css";

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

type TitleNode = TreemapNode & {
  shortLabel?: string;
  fullLabel?: string;
  commitmentsCents?: number;
  share?: number;
};

function tile(props: TreemapNode) {
  const node = props as TitleNode;
  const showLabel = node.width >= 118 && node.height >= 58;
  const showAmount = node.width >= 145 && node.height >= 88;
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
          <text x={node.x + 12} y={node.y + 25} className={styles.tileLabel}>{node.shortLabel}</text>
          <text x={node.x + 12} y={node.y + 45} className={styles.tileShare}>{percentage.format(node.share ?? 0)}</text>
          {showAmount ? (
            <text x={node.x + 12} y={node.y + 66} className={styles.tileAmount}>
              {compactEuro.format((node.commitmentsCents ?? 0) / 100)}
            </text>
          ) : null}
        </>
      ) : null}
    </g>
  );
}

function shortLabel(code: string) {
  return `Titolo ${code}`;
}

export function RegionTitleTreemap({ entity }: { entity: IstatRegionalAdministration }) {
  const data = entity.titles
    .filter((title) => title.commitmentsCents > 0)
    .map((title) => ({
      name: title.code,
      shortLabel: shortLabel(title.code),
      fullLabel: title.label,
      commitmentsCents: title.commitmentsCents,
      share: title.commitmentsCents / entity.commitmentsCents,
    }));

  return (
    <figure className={styles.figure}>
      <div
        className={styles.chart}
        role="img"
        aria-label={`Composizione degli impegni 2024 di ${entity.label} per Titolo`}
        aria-describedby="regioni-treemap-caption"
      >
        <ResponsiveContainer width="100%" height="100%">
          <Treemap
            data={data}
            dataKey="commitmentsCents"
            nameKey="fullLabel"
            nodeGap={1}
            content={tile}
            isAnimationActive={false}
          >
            <Tooltip
              content={({ active, payload }) => {
                const point = payload?.[0]?.payload as TitleNode | undefined;
                if (!active || !point) return null;
                return (
                  <div className={styles.tooltip}>
                    <span>{point.fullLabel}</span>
                    <strong>{exactEuro.format((point.commitmentsCents ?? 0) / 100)}</strong>
                    <small>{percentage.format(point.share ?? 0)} degli impegni</small>
                  </div>
                );
              }}
            />
          </Treemap>
        </ResponsiveContainer>
      </div>
      <figcaption id="regioni-treemap-caption">
        Le aree sono additive: un solo consuntivo, una sola amministrazione, impegni 2024 in euro.
        Il Titolo a zero resta nella tabella esatta ma non occupa spazio nel grafico.
      </figcaption>
    </figure>
  );
}
