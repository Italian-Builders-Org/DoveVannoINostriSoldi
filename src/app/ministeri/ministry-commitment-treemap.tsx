"use client";

import { ResponsiveContainer, Tooltip, Treemap } from "recharts";
import type { TreemapNode } from "recharts";
import type { RgsMinistry } from "@/lib/data/rgs-ministries-contract";
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
  const showLabel = node.width >= 145 && node.height >= 62;
  const showShare = node.width >= 155 && node.height >= 88;

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
          {showShare ? (
            <text x={node.x + 12} y={node.y + 47} className={styles.tileShare}>
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
        aria-label="Composizione del Totale CP 2025 tra i 15 Ministeri"
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
                    <small>{percentage.format(point.share ?? 0)} del Totale CP dei 15 Ministeri</small>
                  </div>
                );
              }}
            />
          </Treemap>
        </ResponsiveContainer>
      </div>
      <figcaption id="ministeri-totale-cp-caption">
        Ogni area rappresenta la quota di un Ministero sul Totale CP 2025. Totale CP è la
        somma di Pagato CP e Rimasto CP: descrive la composizione degli impegni di competenza,
        non un pagamento aggiuntivo.
      </figcaption>
    </figure>
  );
}
