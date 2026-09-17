import type { IncomePoint } from "@/lib/inequality-page";
import styles from "./disuguaglianza.module.css";

export function IncomeSeriesChart({
  points,
  label,
  id,
}: {
  points: readonly IncomePoint[];
  label: string;
  id: string;
}) {
  const observed = points.filter((point) => point.value !== null);
  if (!observed.length) return <p>Serie non disponibile.</p>;
  const firstYear = points[0].incomeYear;
  const lastYear = points[points.length - 1].incomeYear;
  const maximum = Math.max(1, ...observed.map((point) => point.value!));
  const step = maximum > 10 ? 10 : 2;
  const ceiling = Math.ceil(maximum / step) * step;
  const x = (year: number) => 40 + ((year - firstYear) / Math.max(1, lastYear - firstYear)) * 480;
  const y = (value: number) => 160 - (value / ceiling) * 140;
  const path = points.map((point, index) => {
    if (point.value === null) return "";
    const previous = points[index - 1];
    const connected = previous?.value != null && point.incomeYear === previous.incomeYear + 1 && !point.status?.includes("b");
    return `${connected ? "L" : "M"}${x(point.incomeYear)},${y(point.value)}`;
  }).join(" ");

  return (
    <figure className={styles.figure}>
      <svg viewBox="0 0 540 195" role="img" aria-labelledby={`${id}-chart-title ${id}-chart-description`}>
        <title id={`${id}-chart-title`}>{`${label}, redditi dal ${firstYear} al ${lastYear}`}</title>
        <desc id={`${id}-chart-description`}>Serie annuale italiana. Valori esatti nella tabella. Le interruzioni di serie e i dati mancanti interrompono la linea.</desc>
        {[0, ceiling / 2, ceiling].map((value) => (
          <g key={value}>
            <line x1="40" x2="520" y1={y(value)} y2={y(value)} className={styles.gridline} />
            <text x="30" y={y(value) + 5} textAnchor="end">{value.toLocaleString("it-IT")}</text>
          </g>
        ))}
        <path d={path} className={styles.series} />
        {observed.map((point) => (
          <circle key={point.incomeYear} cx={x(point.incomeYear)} cy={y(point.value!)} r="3" className={styles.dot} />
        ))}
        <text x="40" y="188">{firstYear}</text>
        <text x="520" y="188" textAnchor="end">{lastYear}</text>
      </svg>
      <figcaption>Anni di reddito · scala da zero</figcaption>
    </figure>
  );
}
