import {
  formatStaffCount,
  type StaffYearPoint,
} from "@/lib/rgs-conto-annuale-occupazione";
import styles from "./conto-annuale.module.css";

export function StaffSeriesChart({
  points,
  id,
  label,
}: {
  points: readonly StaffYearPoint[];
  id: string;
  label: string;
}) {
  if (points.length === 0) return <p>Serie non disponibile.</p>;
  const firstYear = points[0]!.year;
  const lastYear = points[points.length - 1]!.year;
  const maxPermanent = Math.max(...points.map((point) => point.permanent));
  const maxFlexible = Math.max(...points.map((point) => point.flexible));
  const maximum = Math.max(1, maxPermanent, maxFlexible);
  const step = maximum > 100_000 ? 50_000 : maximum > 10_000 ? 5_000 : maximum > 1_000 ? 500 : 100;
  const ceiling = Math.ceil(maximum / step) * step;
  const x = (year: number) => 48 + ((year - firstYear) / Math.max(1, lastYear - firstYear)) * 472;
  const y = (value: number) => 170 - (value / ceiling) * 140;
  const permanentPath = points
    .map((point, index) => `${index === 0 ? "M" : "L"}${x(point.year)},${y(point.permanent)}`)
    .join(" ");
  const flexiblePath = points
    .map((point, index) => `${index === 0 ? "M" : "L"}${x(point.year)},${y(point.flexible)}`)
    .join(" ");

  return (
    <figure className={styles.chartFigure}>
      <svg viewBox="0 0 560 205" role="img" aria-labelledby={`${id}-title ${id}-desc`}>
        <title id={`${id}-title`}>{`${label}: personale e lavoro flessibile dal ${firstYear} al ${lastYear}`}</title>
        <desc id={`${id}-desc`}>
          Linea continua: personale al 31 dicembre in persone. Linea tratteggiata: lavoro flessibile in unità annue.
          I valori esatti sono nella tabella sottostante.
        </desc>
        {[0, ceiling / 2, ceiling].map((value) => (
          <g key={value}>
            <line x1="48" x2="520" y1={y(value)} y2={y(value)} className={styles.gridline} />
            <text x="40" y={y(value) + 4} textAnchor="end">{formatStaffCount(value)}</text>
          </g>
        ))}
        <path d={permanentPath} className={styles.seriesPermanent} />
        <path d={flexiblePath} className={styles.seriesFlexible} />
        {points.map((point) => (
          <g key={point.year}>
            <circle cx={x(point.year)} cy={y(point.permanent)} r="3.5" className={styles.dotPermanent} />
            <circle cx={x(point.year)} cy={y(point.flexible)} r="3" className={styles.dotFlexible} />
          </g>
        ))}
        <text x="48" y="198">{firstYear}</text>
        <text x="520" y="198" textAnchor="end">{lastYear}</text>
      </svg>
      <figcaption className={styles.legend}>
        <span>Personale al 31 dicembre (persone)</span>
        <span>Lavoro flessibile (unità annue, non sommabile al personale)</span>
      </figcaption>
    </figure>
  );
}
