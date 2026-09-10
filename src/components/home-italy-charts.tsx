import Link from "next/link";
import { InfoTooltip } from "@/components/info-tooltip";
import { billions, percent } from "@/lib/format";
import type { HomeFunnelSlice, HomeItalyTrendPoint } from "@/lib/home-italy-funnel";
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
        return (
          <li key={slice.id}>
            <div className={styles.barCopy}>
              <div className={styles.barText}>
                <span className={styles.barName}>
                  {slice.href ? <Link href={slice.href}>{slice.label}</Link> : slice.label}
                </span>
                <span className={styles.barAmount}>{billions(slice.amountEuro)} mld €</span>
              </div>
              {slice.note ? (
                <InfoTooltip
                  id={`home-slice-${slice.id.replace(/[^a-zA-Z0-9_-]/g, "-")}`}
                  label={`Perimetro: ${slice.label}`}
                >
                  {slice.note}
                </InfoTooltip>
              ) : null}
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

export function HomeItalyTrendChart({
  points,
  selectedYear,
}: {
  points: readonly HomeItalyTrendPoint[];
  selectedYear: number;
}) {
  const width = 720;
  const height = 198;
  const plotLeft = 48;
  const plotRight = 14;
  const plotTop = 16;
  const plotBottom = 34;
  const plotWidth = width - plotLeft - plotRight;
  const plotHeight = height - plotTop - plotBottom;
  const values = points.map((point) => point.totalEuro / 1_000_000_000);
  const minObserved = values.length > 0 ? Math.min(...values) : 0;
  const maxObserved = values.length > 0 ? Math.max(...values) : 0;
  const minValue = Math.floor(minObserved / 10) * 10;
  const maxValue = Math.ceil(maxObserved / 10) * 10;
  const valueRange = Math.max(maxValue - minValue, 1);
  const xDenominator = Math.max(points.length - 1, 1);
  const xFor = (index: number) => plotLeft + (index / xDenominator) * plotWidth;
  const yFor = (value: number) => plotTop + ((maxValue - value) / valueRange) * plotHeight;
  const coordinates = points.map((point, index) => ({
    point,
    x: xFor(index),
    y: yFor(point.totalEuro / 1_000_000_000),
  }));
  const linePath = coordinates
    .map(({ x, y }, index) => `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`)
    .join(" ");
  const firstPoint = coordinates[0];
  const lastPoint = coordinates.at(-1);
  const areaPath = firstPoint && lastPoint
    ? `${linePath} L ${lastPoint.x.toFixed(2)} ${(plotTop + plotHeight).toFixed(2)} L ${firstPoint.x.toFixed(2)} ${(plotTop + plotHeight).toFixed(2)} Z`
    : "";
  const ticks = [minValue, minValue + valueRange / 2, maxValue];
  const selected = points.find((point) => point.year === selectedYear) ?? lastPoint?.point ?? null;
  const chartId = "pa-annual-trend";

  return (
    <figure className={styles.trendFigure} aria-labelledby={`${chartId}-heading`}>
      <div className={styles.trendHeader}>
        <div>
          <span className={styles.trendKicker}>Andamento annuale</span>
          <strong id={`${chartId}-heading`}>Spesa pubblica totale</strong>
        </div>
        <span className={styles.trendUnit}>mld €</span>
      </div>

      <svg
        className={styles.trendChart}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-labelledby={`${chartId}-title ${chartId}-description`}
      >
        <title id={`${chartId}-title`}>Spesa pubblica totale italiana anno per anno</title>
        <desc id={`${chartId}-description`}>
          Serie Eurostat COFOG dal {points[0]?.year} al {points.at(-1)?.year}. Il punto evidenziato è il {selected?.year}; la scala verticale è espressa in miliardi di euro e non parte da zero.
        </desc>
        {ticks.map((tick) => {
          const y = yFor(tick);
          return (
            <g key={tick}>
              <line className={styles.trendGrid} x1={plotLeft} x2={width - plotRight} y1={y} y2={y} />
              <text className={styles.trendTick} x={plotLeft - 9} y={y + 4} textAnchor="end">
                {tick.toLocaleString("it-IT", { maximumFractionDigits: 0 })}
              </text>
            </g>
          );
        })}
        <path className={styles.trendArea} d={areaPath} aria-hidden="true" />
        <path className={styles.trendLine} d={linePath} aria-hidden="true" />
        {coordinates.map(({ point, x, y }) => (
          <g key={point.year}>
            <title>{`${point.year}: ${billions(point.totalEuro)} mld €${point.year === selected?.year ? " · anno selezionato" : ""}`}</title>
            <circle
              className={point.year === selected?.year ? styles.trendPointSelected : styles.trendPoint}
              cx={x}
              cy={y}
              r={point.year === selected?.year ? 5 : 3.5}
            />
            <text className={styles.trendYear} x={x} y={height - 12} textAnchor="middle">
              {point.year}
            </text>
          </g>
        ))}
      </svg>

      <figcaption className={styles.trendCaption}>
        <span>Eurostat COFOG · {points[0]?.year}-{points.at(-1)?.year}</span>
        <strong>{selected ? `${selected.year}: ${billions(selected.totalEuro)} mld €` : "Dato non disponibile"}</strong>
      </figcaption>

      <div className={styles.srOnly}>
        <table>
          <caption>Serie annuale della spesa pubblica totale italiana</caption>
          <thead><tr><th scope="col">Anno</th><th scope="col">Totale</th><th scope="col">Quota del PIL</th></tr></thead>
          <tbody>
            {points.map((point) => (
              <tr key={point.year}>
                <th scope="row">{point.year}</th>
                <td>{billions(point.totalEuro)} mld €</td>
                <td>{percent(point.gdpSharePercent)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </figure>
  );
}
