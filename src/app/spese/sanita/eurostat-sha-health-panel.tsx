import { compactEuro, exactEuro } from "@/lib/format";
import { getEurostatShaHealthPanel } from "@/lib/eurostat-sha-health-snapshot";
import styles from "./sanita.module.css";

function euros(cents: number): number {
  return cents / 100;
}

export function EurostatShaHealthPanel({ year }: { year: number }) {
  const panel = getEurostatShaHealthPanel(year);
  const total = panel.rows.find((row) => row.scheme === "TOT_HF");
  if (!total) {
    throw new Error("Totale SHA mancante");
  }

  return (
    <section className="panel" aria-labelledby="sha-health-title" data-testid="sha-health-panel">
      <div className={styles.sectionHead}>
        <div>
          <h2 className="panel-title" id="sha-health-title">
            Chi paga la spesa sanitaria · Eurostat SHA · {panel.year}
          </h2>
          <p>
            Ripartizione ufficiale per schema di finanziamento (SHA). È un quadro distinto dal
            Conto Economico SSN e dalla funzione COFOG: i numeri non si sommano.
          </p>
        </div>
        <span className={`tag ${panel.provisional ? "tag-accent" : "tag-neutral"}`}>
          {panel.provisional ? "2025 · provvisorio" : `${panel.year} · SHA`}
        </span>
      </div>

      <div className={`stat-strip ${styles.stats}`}>
        {panel.rows.map((row) => (
          <div key={row.scheme}>
            <span className="stat-label">{row.schemeLabelIt}</span>
            <span className="stat-value" data-testid={`sha-${row.scheme}`}>
              {compactEuro(euros(row.amountCents))}
            </span>
            <span className="stat-note">
              {exactEuro(euros(row.amountCents))}
              {row.flag === "p" ? " · stima provvisoria" : ""}
            </span>
          </div>
        ))}
      </div>

      <p className={styles.note}>
        Totale SHA {exactEuro(euros(total.amountCents))}. Fonte {panel.source.owner}, dataset{" "}
        <code>{panel.source.datasetCode}</code>.{" "}
        <a href={panel.apiPath}>API JSON</a>
        {" · "}
        <a href={panel.source.landingUrl} rel="noopener noreferrer" target="_blank">
          Data Browser Eurostat
        </a>
        .
      </p>
      <ul className={styles.note}>
        {panel.caveats.slice(0, 3).map((caveat) => (
          <li key={caveat}>{caveat}</li>
        ))}
      </ul>
    </section>
  );
}
