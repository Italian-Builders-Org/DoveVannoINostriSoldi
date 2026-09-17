import { exactEuro, percent } from "@/lib/format";
import styles from "./cofog-detail-breakdown.module.css";

export type CofogDetailBreakdownRow = Readonly<{
  function: string;
  label: string;
  amountCents: number;
  shareOfParentBasisPoints: number;
  shareOfGdpHundredths: number;
  flag?: "p" | "b";
}>;

type Props = Readonly<{
  parentCode: string;
  year: number;
  rows: readonly CofogDetailBreakdownRow[];
  flags: Readonly<Record<string, string>>;
  reconciliationNote: string;
  testId?: string;
  headingId: string;
  title: string;
  intro: string;
}>;

const euro = (cents: number) => cents / 100;
const basisPoints = (value: number) => percent(value / 100, 2);

export function CofogDetailBreakdown({
  parentCode,
  year,
  rows,
  flags,
  reconciliationNote,
  testId = "cofog-detail",
  headingId,
  title,
  intro,
}: Props) {
  return (
    <section className={`panel ${styles.section}`} aria-labelledby={headingId} data-testid={testId}>
      <h2 id={headingId} className="panel-title">{title}</h2>
      <p>{intro}</p>
      <ul className={styles.breakdown} aria-label={`Composizione di ${parentCode} nel ${year}`}>
        {rows.map((row) => (
          <li key={row.function}>
            <div className={styles.breakdownHeading}>
              <span><code>{row.function}</code> {row.label}</span>
              <strong>{basisPoints(row.shareOfParentBasisPoints)}</strong>
            </div>
            <span className={styles.bar} aria-hidden="true">
              <span style={{ width: `${row.shareOfParentBasisPoints / 100}%` }} />
            </span>
            <span className={styles.breakdownValue}>
              {exactEuro(euro(row.amountCents))}
              {row.flag ? ` · ${flags[row.flag]}` : ""}
            </span>
          </li>
        ))}
      </ul>
      <div className="table-scroll" role="region" aria-label={`Dettaglio COFOG ${parentCode} ${year}`} tabIndex={0}>
        <table className="table" data-testid={`${testId}-table`}>
          <thead>
            <tr>
              <th scope="col">Codice e funzione</th>
              <th scope="col" className="num">Spesa</th>
              <th scope="col" className="num">Quota {parentCode}</th>
              <th scope="col" className="num">% PIL</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.function}>
                <th scope="row"><code>{row.function}</code> {row.label}</th>
                <td className="num">{exactEuro(euro(row.amountCents))}</td>
                <td className="num">{basisPoints(row.shareOfParentBasisPoints)}</td>
                <td className="num">{percent(row.shareOfGdpHundredths / 100)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className={styles.note}>{reconciliationNote}</p>
    </section>
  );
}
