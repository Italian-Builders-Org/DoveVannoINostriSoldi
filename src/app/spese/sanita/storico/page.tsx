import type { Metadata } from "next";
import Link from "next/link";
import { compactEuro, longDate, percent } from "@/lib/format";
import {
  type SsnNationalHistory,
} from "@/lib/ssn-national-history";
import { getCachedSsnNationalHistory } from "@/lib/data/cached-live-views";
import type { SsnCceMetricId } from "@/lib/data/ssn-cce-contract";
import { HealthSpendingHistoryChart } from "@/components/charts/health-spending-history-chart";
import styles from "./storico.module.css";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export const metadata: Metadata = {
  title: "Serie storica della spesa sanitaria",
  description:
    "Conto Economico nazionale del Servizio Sanitario Nazionale dal 2012 al 2024, per costi del personale, servizi e prestazioni di lavoro.",
};

const metricOrder: SsnCceMetricId[] = [
  "productionCosts",
  "personnelCost",
  "healthcareWorkServices",
  "nonHealthcareWorkServices",
  "purchasedServices",
];

const metricTitle: Record<SsnCceMetricId, string> = {
  productionCosts: "Totale costi della produzione",
  personnelCost: "Costo del personale",
  healthcareWorkServices: "Prestazioni di lavoro sanitarie",
  nonHealthcareWorkServices: "Prestazioni di lavoro non sanitarie",
  purchasedServices: "Acquisti di servizi",
};

function euro(cents: number): number {
  return cents / 100;
}

function HistoryTable({ history }: { history: SsnNationalHistory }) {
  const first = history.years[0];
  const last = history.years.at(-1)!;

  return (
    <>
      <div className="table-scroll" role="region" aria-label="Conto Economico SSN nazionale, serie storica" tabIndex={0}>
        <table className="table">
          <caption>Conto Economico consuntivo nazionale degli enti del SSN, OpenBDAP RGS</caption>
          <thead>
            <tr>
              <th scope="col">Anno</th>
              {metricOrder.map((metric) => (
                <th scope="col" className="num" key={metric}>{metricTitle[metric]}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {history.years.map((entry) => (
              <tr key={entry.year}>
                <th scope="row">{entry.year}</th>
                {metricOrder.map((metric) => (
                  <td className="num" key={metric}>{compactEuro(euro(entry.values[metric]))}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className={styles.summary}>
        Dal {first.year} al {last.year}, il totale dei costi della produzione (voce{" "}
        <code>BZ9999</code>) è passato da {compactEuro(euro(first.values.productionCosts))} a{" "}
        {compactEuro(euro(last.values.productionCosts))} ({percent(
          ((last.values.productionCosts - first.values.productionCosts) / first.values.productionCosts) * 100,
        )}). È una variazione osservata su {history.years.length} anni, non un giudizio su efficienza,
        qualità o organico: comprende inflazione, nuove missioni di spesa ed eventi straordinari che
        questa serie non isola.
      </p>
    </>
  );
}

function ProvenanceList({ history }: { history: SsnNationalHistory }) {
  return (
    <section className={`panel ${styles.provenance}`}>
      <h2 className="panel-title">Fonti verificate per annualità</h2>
      <p className={styles.provenanceIntro}>
        Ogni riga usa il package CKAN e il CSV ufficiale dell’anno indicato. Il controllo del
        portale è osservato in <time dateTime={history.source.observedAt}>{history.source.observedAt}</time>;
        la licenza dichiarata dalla fonte è {history.source.license}.
      </p>
      <ul className={styles.provenanceList}>
        {history.years.map((entry) => (
          <li className={styles.provenanceRow} key={entry.year}>
            <strong>{entry.year}</strong>
            <span>
              Package: <a href={entry.provenance.packageUrl} target="_blank" rel="noreferrer">{entry.provenance.packageId}</a>
            </span>
            <span>
              CSV: <a href={entry.provenance.csvUrl} target="_blank" rel="noreferrer">download ufficiale</a>
            </span>
            <span>
              Aggiornamento fonte: <time dateTime={entry.provenance.dataUpdatedAt}>{longDate(entry.provenance.dataUpdatedAt)}</time>
              {" · "}catalogo: <time dateTime={entry.provenance.metadataModified}>{longDate(entry.provenance.metadataModified)}</time>
            </span>
            <span>
              <a href={entry.provenance.licenseUrl} target="_blank" rel="noreferrer">{entry.provenance.license}</a>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default async function HealthSpendingHistoryPage() {
  let history: SsnNationalHistory | null = null;
  let errorMessage: string | null = null;

  try {
    history = await getCachedSsnNationalHistory();
  } catch (error) {
    errorMessage = error instanceof Error ? error.message : "Errore sconosciuto";
  }

  return (
    <main className="shell page">
      <nav className={styles.breadcrumb} aria-label="Percorso">
        <Link href="/">Home</Link>
        <span>→</span>
        <Link href="/spese/sanita">Conto Economico della sanità</Link>
        <span>→</span>
        <span>Serie storica</span>
      </nav>

      <header className="page-intro">
        <h1>Serie storica della spesa sanitaria</h1>
        <p>
          Conto Economico nazionale degli enti del SSN, dal 2012 al 2024. Solo livello nazionale:
          il dettaglio per Regione e per singolo ente resta disponibile soltanto per il 2024 nella{" "}
          <Link href="/spese/sanita">pagina principale</Link>.
        </p>
      </header>

      {errorMessage ? (
        <p className={styles.note} role="alert">
          Dati OpenBDAP non raggiungibili in questo momento: {errorMessage}
        </p>
      ) : (
        <>
          {history!.dataMode === "snapshot" ? (
            <p className={styles.note} role="status">
              OpenBDAP non sta restituendo i CSV annuali in questo momento: mostriamo lo snapshot
              nazionale verificato (il 2024 coincide con lo snapshot hash-locked della pagina
              principale). Quando la fonte torna disponibile, la lettura live riprende in automatico.
            </p>
          ) : null}
          <section className="panel">
            <h2 className="panel-title">2012-2024, valori di competenza economica</h2>
            <HealthSpendingHistoryChart data={history!.years} />
            <HistoryTable history={history!} />
          </section>
          <ProvenanceList history={history!} />
        </>
      )}

      <div className="notice">
        <strong>Cosa questa serie non dimostra</strong>
        <p>
          Sono voci di competenza economica del Conto Economico, non pagamenti di cassa: non
          identificano gettonisti, cooperative o organico, e non misurano qualità o efficienza
          sanitaria. Un aumento non è di per sé uno spreco né un miglioramento; una diminuzione non
          è di per sé un taglio di servizi. Confronti tra anni o tra Regioni richiedono lo stesso
          perimetro contabile e denominatori compatibili, che questa pagina non fornisce.
        </p>
        <p>
          Fonte: <a href={history?.source.landingUrl ?? "https://bdap-opendata.rgs.mef.gov.it"} target="_blank" rel="noreferrer">{history?.source.platform ?? "OpenBDAP RGS"}</a>,
          Modello di rilevazione del Conto Economico degli enti del SSN a livello nazionale. Licenza: {history?.source.license ?? "Creative Commons Attribution"}.
        </p>
      </div>
    </main>
  );
}
