import type { IncomeIndicatorView } from "@/lib/inequality-page";
import { longDate } from "@/lib/format";
import { IncomeSeriesChart } from "./series-chart";
import styles from "./disuguaglianza.module.css";

const number = new Intl.NumberFormat("it-IT", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 2,
});

function valueLabel(value: number | null): string {
  return value === null ? "Non disponibile" : number.format(value);
}

export function IncomeIndicatorSection({ indicator }: { indicator: IncomeIndicatorView }) {
  const latest = indicator.points.at(-1);
  return (
    <section className={styles.indicator} aria-labelledby={`${indicator.key}-title`}>
      <h2 id={`${indicator.key}-title`}>{indicator.title}</h2>
      <p className={styles.definition}>{indicator.definition}</p>
      {latest && (
        <>
          <dl className={styles.latest}>
            <dt>Italia · redditi {latest.incomeYear}</dt>
            <dd data-testid={`${indicator.key}-latest`}>
              {valueLabel(latest.value)}{latest.value === null ? "" : indicator.valueSuffix}
            </dd>
          </dl>
          <p className={styles.period}>
            {indicator.scaleLabel} · rilevazione {latest.surveyYear}
            {latest.note ? ` · ${latest.note}` : ""}
          </p>
        </>
      )}
      <IncomeSeriesChart id={indicator.key} label={indicator.title} points={indicator.points} />
      <details data-testid={`${indicator.key}-data`}>
        <summary>Valori per anno</summary>
        <div className="table-scroll" role="region" aria-label={`Serie ${indicator.title}`} tabIndex={0}>
          <table className="table">
            <caption>{indicator.title} · Italia · {indicator.scaleLabel}</caption>
            <thead>
              <tr>
                <th scope="col">Redditi</th>
                <th scope="col">Rilevazione</th>
                <th scope="col" className="num">Valore</th>
                <th scope="col">Note</th>
              </tr>
            </thead>
            <tbody>
              {indicator.points.map((point) => (
                <tr key={point.surveyYear}>
                  <th scope="row">{point.incomeYear}</th>
                  <td>{point.surveyYear}</td>
                  <td className="num">{valueLabel(point.value)}</td>
                  <td>{point.note ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
      <p className={styles.source}>
        <a href={indicator.sourceUrl}>Fonte: Eurostat · EU-SILC</a>
        {" · "}verificata il {longDate(indicator.checkedAt)}
      </p>
    </section>
  );
}
