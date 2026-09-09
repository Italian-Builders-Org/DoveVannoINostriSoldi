import Link from "next/link";
import { InfoTooltip } from "@/components/info-tooltip";
import { billions, percent } from "@/lib/format";
import type { HomeFunnelSlice } from "@/lib/home-italy-funnel";
import styles from "./home-italy-charts.module.css";

export function HomeItalyCompositionChart({
  slices,
  ariaLabel,
}: {
  slices: readonly HomeFunnelSlice[];
  ariaLabel: string;
}) {
  const maxShare = Math.max(...slices.map((slice) => slice.sharePercent), 0);

  return (
    <ol className={styles.bars} aria-label={ariaLabel}>
      {slices.map((slice) => {
        const width = maxShare > 0 ? (slice.sharePercent / maxShare) * 100 : 0;
        const label = (
          <span className={styles.barName}>
            {slice.href ? <Link href={slice.href}>{slice.label}</Link> : slice.label}
            {slice.note ? (
              <InfoTooltip
                id={`home-slice-${slice.id.replace(/[^a-zA-Z0-9_-]/g, "-")}`}
                label={`Perimetro: ${slice.label}`}
              >
                {slice.note}
              </InfoTooltip>
            ) : null}
          </span>
        );

        return (
          <li key={slice.id}>
            <div className={styles.barCopy}>
              {label}
              <span className={styles.barAmount}>{billions(slice.amountEuro)} mld €</span>
            </div>
            <i aria-hidden="true">
              <b style={{ width: `${width}%` }} />
            </i>
            <strong>{percent(slice.sharePercent)}</strong>
          </li>
        );
      })}
    </ol>
  );
}
