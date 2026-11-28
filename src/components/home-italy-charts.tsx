import Link from "next/link";
import { Icon } from "@/components/icons";
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
  return (
    <ol className={styles.bars} aria-label={ariaLabel}>
      {slices.map((slice) => {
        // A bar is the slice's share of the total, the same rule as the home
        // card: scaling to the largest slice would make 42% fill the track.
        const width = Number.isFinite(slice.sharePercent)
          ? Math.min(Math.max(slice.sharePercent, 0), 100)
          : 0;
        return (
          // A linked row is one target: the name's link covers the row (CSS),
          // the chevron says so. The "?" has its own fixed column on every row,
          // empty where the slice has no perimeter note, so bars and shares
          // start at the same x on every row.
          <li key={slice.id} data-linked={slice.href ? "true" : undefined}>
            <div className={styles.barCopy}>
              <span className={styles.barName}>
                {slice.href ? <Link prefetch={false} href={slice.href}>{slice.label}</Link> : slice.label}
              </span>
              <span className={styles.barAmount}>{billions(slice.amountEuro)} mld €</span>
            </div>
            <span className={styles.barInfo}>
              {slice.note ? (
                <InfoTooltip
                  id={`home-slice-${slice.id.replace(/[^a-zA-Z0-9_-]/g, "-")}`}
                  label={`Perimetro: ${slice.label}`}
                >
                  {slice.note}
                </InfoTooltip>
              ) : null}
            </span>
            <i aria-hidden="true">
              <b style={{ width: `${width}%` }} />
            </i>
            <strong>{percent(slice.sharePercent)}</strong>
            <span className={styles.barChevron} aria-hidden="true">
              {slice.href ? <Icon name="chevron-right" size={16} /> : null}
            </span>
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
  // The plot is drawn in a 0-100 coordinate space stretched to the box
  // (preserveAspectRatio="none", non-scaling strokes). Labels and points are
  // HTML so their CSS pixel size never shrinks with the viewBox on mobile.
  const values = points.map((point) => point.totalEuro / 1_000_000_000);
  const minObserved = values.length > 0 ? Math.min(...values) : 0;
  const maxObserved = values.length > 0 ? Math.max(...values) : 0;
  const minValue = Math.floor(minObserved / 10) * 10;
  const maxValue = Math.ceil(maxObserved / 10) * 10;
  const valueRange = Math.max(maxValue - minValue, 1);
  const lastIndex = points.length - 1;
  const xDenominator = Math.max(lastIndex, 1);
  const xFor = (index: number) => (index / xDenominator) * 100;
  const yFor = (value: number) => ((maxValue - value) / valueRange) * 100;
  const coordinates = points.map((point, index) => ({
    point,
    index,
    x: xFor(index),
    y: yFor(point.totalEuro / 1_000_000_000),
  }));
  const linePath = coordinates
    .map(({ x, y }, index) => `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`)
    .join(" ");
  const firstPoint = coordinates[0];
  const lastPoint = coordinates.at(-1);
  // An area encodes magnitude from its baseline: filled above a cut axis it
  // makes growth look larger than it is. With a non-zero baseline the series
  // is drawn as a line only and the caption says where the axis starts.
  const zeroBaseline = minValue <= 0;
  const areaPath = zeroBaseline && firstPoint && lastPoint
    ? `${linePath} L ${lastPoint.x.toFixed(2)} 100 L ${firstPoint.x.toFixed(2)} 100 Z`
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

      <div className={styles.trendPlot}>
        <div className={styles.trendTicks} aria-hidden="true">
          {ticks.map((tick) => (
            <span key={tick} className={styles.trendTick} style={{ top: `${yFor(tick)}%` }}>
              {tick.toLocaleString("it-IT", { maximumFractionDigits: 0 })}
            </span>
          ))}
        </div>
        <div className={styles.trendCanvas}>
          <svg
            className={styles.trendChart}
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            role="img"
            aria-labelledby={`${chartId}-title ${chartId}-description`}
          >
            <title id={`${chartId}-title`}>Spesa pubblica totale italiana anno per anno</title>
            <desc id={`${chartId}-description`}>
              Serie Eurostat COFOG dal {points[0]?.year} al {points.at(-1)?.year}. Il punto evidenziato è il {selected?.year}; la scala verticale è espressa in miliardi di euro{zeroBaseline ? "" : " e non parte da zero"}.
            </desc>
            {ticks.map((tick) => (
              <line key={tick} className={styles.trendGrid} x1={0} x2={100} y1={yFor(tick)} y2={yFor(tick)} />
            ))}
            {areaPath ? <path className={styles.trendArea} d={areaPath} aria-hidden="true" /> : null}
            <path className={styles.trendLine} d={linePath} aria-hidden="true" />
          </svg>
          {coordinates.map(({ point, x, y }) => (
            <span
              key={point.year}
              aria-hidden="true"
              className={point.year === selected?.year ? styles.trendPointSelected : styles.trendPoint}
              style={{ left: `${x}%`, top: `${y}%` }}
              title={`${point.year}: ${billions(point.totalEuro)} mld €${point.year === selected?.year ? " · anno selezionato" : ""}`}
            />
          ))}
        </div>
        <div className={styles.trendYears} aria-hidden="true">
          {coordinates.map(({ point, index, x }) => (
            <span
              key={point.year}
              className={styles.trendYear}
              // Narrow screens keep every other year, counted back from the latest.
              data-minor={(lastIndex - index) % 2 === 1 ? "true" : undefined}
              style={{ left: `${x}%` }}
            >
              {point.year}
            </span>
          ))}
        </div>
      </div>

      {/* The selected total is the card headline and the source closes the
          section: the caption only states the series span and the axis cut. */}
      <figcaption className={styles.trendCaption}>
        {points[0]?.year}-{points.at(-1)?.year}
        {zeroBaseline ? "" : ` · asse da ${minValue.toLocaleString("it-IT", { maximumFractionDigits: 0 })} mld €, non da zero`}
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
