"use client";

import { ResponsiveContainer, Tooltip, Treemap } from "recharts";
import type { TreemapNode } from "recharts";
import type { IstatRegionalAdministration } from "@/lib/data/istat-regions-contract";
import { institutionalCategoryColor } from "@/lib/chart-category-colors";
import { siopeTitleCopy } from "@/lib/siope-titles";
import styles from "./region-title-treemap.module.css";

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
  explanation?: string;
  commitmentsCents?: number;
  share?: number;
};

function tile(props: TreemapNode) {
  const node = props as TitleNode;
  const showLabel = node.width >= Math.max(118, (node.shortLabel?.length ?? 0) * 7.5 + 24) && node.height >= 62;
  const showShare = node.width >= 145 && node.height >= 88;
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

export function RegionTitleTreemap({ entity }: { entity: IstatRegionalAdministration }) {
  const data = entity.titles
    .filter((title) => title.commitmentsCents > 0)
    .map((title) => {
      const copy = siopeTitleCopy(title.code, "regione");
      return {
        name: title.code,
        shortLabel: copy.name,
        explanation: copy.explanation,
        commitmentsCents: title.commitmentsCents,
        share: title.commitmentsCents / entity.commitmentsCents,
      };
    });

  return (
    <figure className={styles.figure}>
      <div
        className={styles.chart}
        role="img"
        aria-label={`Come si spezzano i soldi impegnati nel 2024 da ${entity.label}`}
        aria-describedby="regioni-treemap-caption"
      >
        <ResponsiveContainer width="100%" height="100%">
          <Treemap
            data={data}
            dataKey="commitmentsCents"
            nameKey="shortLabel"
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
                    <span>{point.shortLabel}</span>
                    <small className={styles.tooltipExplain}>{point.explanation}</small>
                    <strong>{exactEuro.format((point.commitmentsCents ?? 0) / 100)}</strong>
                    <small>{percentage.format(point.share ?? 0)} del totale impegnato</small>
                  </div>
                );
              }}
            />
          </Treemap>
        </ResponsiveContainer>
      </div>
      <figcaption id="regioni-treemap-caption">
        Quote sugli impegni 2024 di {entity.label}. Le voci a zero restano in tabella.
      </figcaption>
    </figure>
  );
}
