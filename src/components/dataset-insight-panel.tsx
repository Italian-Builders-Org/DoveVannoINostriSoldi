import { SpendingBarChart } from "@/components/charts/spending-bar-chart";
import { exactEuro, integer } from "@/lib/format";
import { hasNamedInsightRecipient, type DatasetInsights } from "@/lib/integrated-dataset-insight-core";
import styles from "./dataset-insight-panel.module.css";

export function DatasetInsightPanel({
  insights,
  title = "Principali destinatari per importo",
}: {
  insights: DatasetInsights;
  title?: string;
}) {
  if (!insights.capable || insights.topRecipients.length === 0) return null;

  const namedRecipients = insights.topRecipients.filter((entry) => hasNamedInsightRecipient(entry.name));
  const recurringRecipients = insights.multiService.filter((entry) => hasNamedInsightRecipient(entry.name));
  const lead = namedRecipients[0];

  return (
    <section className={styles.panel} aria-labelledby="dataset-insight-title">
      <div className={styles.intro}>
        <h2 id="dataset-insight-title">{title}</h2>
        {lead ? <p className={styles.headline}>{lead.name}: {exactEuro(lead.totalEuro)}</p> : null}
        <p className={styles.note}>{insights.coverageNote} Lettura di screening, non un giudizio automatico.</p>
        {insights.topRecipients.some((entry) => !hasNamedInsightRecipient(entry.name)) ? (
          <p className={styles.note}>“Destinatario non disponibile” raggruppa le righe senza nominativo; non rappresenta un unico soggetto.</p>
        ) : null}
      </div>

      <div className={styles.chartBlock}>
        <SpendingBarChart
          data={insights.chartPoints.map((point) => ({ ...point, label: hasNamedInsightRecipient(point.label) ? point.label : "Destinatario non disponibile" }))}
          ariaLabel={`Importi per destinatario in ${insights.datasetId}`}
          maxItems={8}
          color="var(--chart-data-primary)"
          height={Math.min(420, 64 + insights.chartPoints.length * 42)}
        />
      </div>

      {recurringRecipients.length > 0 ? (
        <div className={styles.recurrence}>
          <h3>Denominazioni presenti su più servizi</h3>
          <p className={styles.note}>Raggruppamento per nome pubblicato: non verifica l’identità del soggetto né risolve eventuali omonimie.</p>
          <ul>
            {recurringRecipients.map((entry) => (
              <li key={entry.name}>
                <strong>{entry.name}</strong>
                <span>
                  {exactEuro(entry.totalEuro)} · {integer(entry.services.length)} servizi ·{" "}
                  {integer(entry.awards)} atti
                </span>
                <details>
                  <summary>Servizi ({integer(entry.services.length)})</summary>
                  <ul>{entry.services.map((service) => <li key={service}>{service}</li>)}</ul>
                </details>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
