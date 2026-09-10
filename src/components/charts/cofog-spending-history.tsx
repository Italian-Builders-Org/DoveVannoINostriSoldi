import { compactEuro } from "@/lib/format";
import type { EurostatCofogObservation } from "@/lib/data/eurostat-cofog-contract";
import styles from "./cofog-spending-history.module.css";

export function CofogSpendingHistory({ history, flags, id, title, listLabel, functionCode }: {
  history: readonly EurostatCofogObservation[];
  flags: Readonly<Record<string, string>>;
  id: string;
  title: string;
  listLabel: string;
  functionCode: "GF02" | "GF07";
}) {
  const maxCents = Math.max(...history.map((point) => point.amountCents), 1);
  const x = (index: number) => 80 + index / Math.max(history.length - 1, 1) * 520;
  const y = (cents: number) => 170 - cents / maxCents * 140;
  return (
    <figure className={styles.chart}>
      <svg viewBox="0 0 640 205" role="img" aria-labelledby={`${id}-title ${id}-desc`}>
        <title id={`${id}-title`}>{title}</title>
        <desc id={`${id}-desc`}>Importi in euro correnti. Asse verticale da zero a {compactEuro(maxCents / 100)}. Tutti i valori sono nella tabella seguente.</desc>
        {[0, maxCents / 2, maxCents].map((amount) => <g key={amount}>
          <line x1="80" x2="600" y1={y(amount)} y2={y(amount)} className={styles.gridLine} />
          <text x="72" y={y(amount) + 4} textAnchor="end">{compactEuro(amount / 100)}</text>
        </g>)}
        {history.map((point, index) => <g key={point.year}>
          {index > 0 && point.flag !== "b" ? <line x1={x(index - 1)} y1={y(history[index - 1].amountCents)} x2={x(index)} y2={y(point.amountCents)} className={styles.seriesLine} /> : null}
          <circle cx={x(index)} cy={y(point.amountCents)} r="3" className={styles.point} />
          {index === 0 || index === history.length - 1 || index === Math.floor(history.length / 2)
            ? <text x={x(index)} y="195" textAnchor="middle">{point.year}</text> : null}
        </g>)}
      </svg>
      <ol className={styles.mobileHistory} aria-label={listLabel}>
        {history.map((point) => <li key={point.year}>
          <span>{point.year}</span><strong>{compactEuro(point.amountCents / 100)}</strong>
          <i aria-hidden="true"><b style={{ width: `${point.amountCents / maxCents * 100}%` }} /></i>
          {point.flag ? <small>{flags[point.flag]}</small> : null}
        </li>)}
      </ol>
      <figcaption>Solo COFOG {functionCode} · Eurostat. Prezzi correnti, senza correzione per l’inflazione.
        Un’interruzione segnalata dalla fonte interrompe anche la linea.</figcaption>
    </figure>
  );
}
