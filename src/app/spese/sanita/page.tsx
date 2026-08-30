import type { Metadata } from "next";
import Link from "next/link";
import { compactEuro, integer, longDate, percent } from "@/lib/format";
import { ssnCceSnapshot as data } from "@/lib/ssn-cce-snapshot";
import type { SsnCceMetricId } from "@/lib/data/ssn-cce-contract";
import { SsnAccountingComparison } from "./ssn-accounting-comparison";
import styles from "./sanita.module.css";

export const metadata: Metadata = {
  title: "Conto Economico della sanità",
  description:
    "Conto Economico consuntivo 2024 degli enti del Servizio Sanitario Nazionale: costi del personale, servizi e prestazioni di lavoro secondo OpenBDAP.",
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
  personnelCost: "Totale Costo del personale",
  healthcareWorkServices: "Prestazioni di lavoro sanitarie e sociosanitarie",
  nonHealthcareWorkServices: "Prestazioni di lavoro non sanitarie",
  purchasedServices: "Acquisti di servizi",
};

function euro(cents: number): number {
  return cents / 100;
}

function share(value: number, denominator: number): string {
  return percent(denominator === 0 ? 0 : (value / denominator) * 100, 1);
}

function sourceMetric(metric: SsnCceMetricId) {
  const definition = data.metrics.find((item) => item.id === metric);
  if (!definition) {
    throw new Error("Definizione metrica SSN mancante: " + metric);
  }
  return definition;
}

export default function HealthSpendingPage() {
  const national = data.national.values;
  const production = national.productionCosts;
  const personnelShare = share(national.personnelCost, production);
  const healthcareWorkShare = share(national.healthcareWorkServices, production);
  const comparisonData = metricOrder.map((metric) => {
    const definition = sourceMetric(metric);
    return {
      id: metric,
      label: metricTitle[metric],
      sourceLabel: definition.label,
      code: definition.code,
      valueCents: national[metric],
      detailPresent: data.detailCoverage.present[metric],
      detailMissing: data.detailCoverage.missing[metric],
    };
  });

  return (
    <main className="shell page">
      <header className="page-intro">
        <h1>Sanità: personale e servizi nel Conto Economico</h1>
        <p>
          Un confronto tra voci contabili del consuntivo 2024 degli enti del Servizio Sanitario
          Nazionale. Il dataset misura costi di competenza economica.
        </p>
      </header>

      <div className={`stat-strip ${styles.stats}`}>
        <div>
          <span className="stat-label">Totale Costo del personale · 2024</span>
          <span className="stat-value">{compactEuro(euro(national.personnelCost))}</span>
          <span className="stat-note">{personnelShare} dei costi della produzione</span>
        </div>
        <div>
          <span className="stat-label">Prestazioni di lavoro sanitarie</span>
          <span className="stat-value">{compactEuro(euro(national.healthcareWorkServices))}</span>
          <span className="stat-note">voce BA1350 · {healthcareWorkShare} dei costi della produzione</span>
        </div>
        <div>
          <span className="stat-label">Enti di dettaglio esposti</span>
          <span className="stat-value">{integer(data.detailCoverage.entityCount)}</span>
          <span className="stat-note">21 righe aggregate restano separate</span>
        </div>
      </div>

      <div className="notice">
        <strong>Le etichette sono quelle di OpenBDAP</strong>
        <p>
          La fonte non pubblica una voce chiamata “gettonisti” o “cooperative”. BA2080 è il
          <em> Totale Costo del personale</em>; BA1350 è “Consulenze, Collaborazioni, Interinale e
          altre prestazioni di lavoro sanitarie e sociosanitarie”. Non trasformiamo una voce
          aggregata in un tipo di contratto e non deduciamo qualità o frodi.
        </p>
      </div>

      <section className="panel" aria-labelledby="categories-title">
        <div className={styles.sectionHead}>
          <div>
            <h2 className="panel-title" id="categories-title">
              Le voci contabili a confronto
            </h2>
            <p>
              Aggregato nazionale ufficiale del dataset SSN_CCE_NAZ_VOCCN_001. Il grafico confronta
              gli importi; codici e copertura del dettaglio restano disponibili nella tabella.
            </p>
          </div>
          <span className="tag tag-neutral">2024 · consuntivo</span>
        </div>
        <SsnAccountingComparison data={comparisonData} />
        <p className={styles.note}>
          “Acquisti di servizi” comprende più servizi sanitari e non sanitari, oltre alle sole
          prestazioni di lavoro. Gli importi nella tabella sono arrotondati solo nella
          visualizzazione; l&apos;artefatto conserva centesimi interi.
        </p>
      </section>

      <section className="panel" aria-labelledby="regions-title">
        <div className={styles.sectionHead}>
          <div>
            <h2 className="panel-title" id="regions-title">
              Dove sono registrati i costi
            </h2>
            <p>
              La Regione e le Province autonome sono quelle dichiarate da OpenBDAP. Questi sono gli
              aggregati ufficiali del dataset SSN_CCE_REG_VOCCN_001; i codici 041 (P. A. Bolzano) e
              042 (P. A. Trento) restano separati come nella fonte.
            </p>
          </div>
          <span className="tag tag-neutral">{integer(data.coverage.regions)} codici geografici</span>
        </div>
        <div className="table-scroll" role="region" aria-label="Aggregati regionali del Conto Economico SSN" tabIndex={0}>
          <table className="table">
            <caption className={styles.visuallyHidden}>Aggregati per codice geografico OpenBDAP</caption>
            <thead>
              <tr>
                <th scope="col">Territorio</th>
                <th scope="col" className="num">Personale</th>
                <th scope="col" className="num">Prestazioni di lavoro sanitarie</th>
                <th scope="col" className="num">Enti di dettaglio</th>
              </tr>
            </thead>
            <tbody>
              {data.regions.map((region) => (
                <tr key={region.code}>
                  <th scope="row">
                    {region.name}
                    <small>codice {region.code}</small>
                  </th>
                  <td className="num">{compactEuro(euro(region.values.personnelCost))}</td>
                  <td className="num">{compactEuro(euro(region.values.healthcareWorkServices))}</td>
                  <td className="num">{integer(region.detailEntityCount)}</td>
                </tr>
              ))}
              <tr className={styles.totalRow}>
                <th scope="row">Totale nazionale ufficiale</th>
                <td className="num">{compactEuro(euro(national.personnelCost))}</td>
                <td className="num">{compactEuro(euro(national.healthcareWorkServices))}</td>
                <td
                  className="num"
                  aria-label="Non applicabile: il totale nazionale è un aggregato, senza conteggio enti"
                >
                  <span aria-hidden="true">n.a.</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel" aria-labelledby="entities-title">
        <div className={styles.sectionHead}>
          <div>
            <h2 className="panel-title" id="entities-title">
              Dettaglio per ente
            </h2>
            <p>
              Elenco completo server-side dei {integer(data.detailCoverage.entityCount)} enti di
              dettaglio, alfabetico per codice geografico e Codice Ente SSN.
            </p>
          </div>
        </div>
        <div className="table-scroll" role="region" aria-label="Dettaglio per ente del Conto Economico SSN" tabIndex={0}>
          <table className="table" id="enti-dettaglio">
            <caption className={styles.visuallyHidden}>Tutti gli enti e le articolazioni contabili presenti nel dataset</caption>
            <thead>
              <tr>
                <th scope="col">Ente</th>
                <th scope="col">Territorio</th>
                <th scope="col" className="num">Personale</th>
                <th scope="col" className="num">Prestazioni di lavoro sanitarie</th>
                <th scope="col">Codici</th>
              </tr>
            </thead>
            <tbody>
              {data.entities.map((entity) => (
                <tr key={entity.id}>
                  <th scope="row">
                    {entity.name}
                    <small>{entity.region}</small>
                  </th>
                  <td>{entity.region}</td>
                  <td className="num">{entity.missing.personnelCost ? "n.d." : compactEuro(euro(entity.values.personnelCost))}</td>
                  <td className="num">{entity.missing.healthcareWorkServices ? "n.d." : compactEuro(euro(entity.values.healthcareWorkServices))}</td>
                  <td>
                    <code>{entity.codeSsn}</code>
                    <small>BDAP {entity.codeBdap}</small>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className={styles.columns}>
        <section className="panel" aria-labelledby="limits-title">
          <h2 className="panel-title" id="limits-title">Come leggere il confronto</h2>
          <p className={styles.bodyCopy}>{data.methodology.comparability}</p>
          <p className={styles.bodyCopy}>{data.methodology.interpretation}</p>
        </section>
        <section className="panel" aria-labelledby="source-title">
          <h2 className="panel-title" id="source-title">Fonte e riproducibilità</h2>
          <p className={styles.bodyCopy}>
            {data.source.title} · osservazione {longDate(data.source.dataObservedAt)} · pubblicazione
            {" "}{longDate(data.observation.publishedAt)}.
          </p>
          <p className={styles.bodyCopy}><a href={data.source.datasets.entities.landingUrl} target="_blank" rel="noreferrer">Apri la scheda OpenBDAP enti ↗</a><br /><a href={data.source.datasets.national.landingUrl} target="_blank" rel="noreferrer">Scheda aggregato nazionale ↗</a><br /><a href={data.source.datasets.regional.landingUrl} target="_blank" rel="noreferrer">Scheda aggregato regionale ↗</a></p>
          <code className={styles.hash}>enti sha256:{data.source.datasets.entities.sourceSha256}<br />nazionale sha256:{data.source.datasets.national.sourceSha256}<br />regionale sha256:{data.source.datasets.regional.sourceSha256}</code>
        </section>
      </div>

      <div className="notice">
        <strong>Non è un conto di pagamenti</strong>
        <p>
          Questo conto economico non sostituisce una contabilità dei pagamenti.
          Per i pagamenti dei Comuni vai a <Link href="/spese">Soldi</Link>; per l’invalidità civile
          ai dati <Link href="/spese/invalidita">INPS</Link>. Fonti e ambiti diversi.
        </p>
      </div>

      <div className="notice">
        <strong>Serie storica nazionale, dal 2012</strong>
        <p>
          Questa pagina mostra solo il 2024. Il totale nazionale delle stesse voci contabili è
          disponibile dal 2012 al 2024.{" "}
          <Link href="/spese/sanita/storico">Apri la serie storica →</Link>
        </p>
      </div>
    </main>
  );
}
