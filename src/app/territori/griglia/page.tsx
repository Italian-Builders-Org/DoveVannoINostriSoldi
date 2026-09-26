import type { Metadata } from "next";
import Link from "next/link";
import { integer, longDate } from "@/lib/format";
import {
  istatPopulationGrid2021Data,
  istatPopulationGrid2021Metadata,
} from "@/lib/istat-population-grid-2021-snapshot";
import styles from "./griglia.module.css";

export const metadata: Metadata = {
  title: "Griglia territoriale ISTAT 1 km²",
  description:
    "Popolazione legale del Censimento 2021 sulla griglia regolare Eurostat 1 km²: celle, fasce demografiche e appoggio ai dati comunali. Numeri statici ufficiali, senza richiami API a runtime.",
  alternates: { canonical: "/territori/griglia" },
};

export default function TerritorialGridPage() {
  const data = istatPopulationGrid2021Data;
  const source = istatPopulationGrid2021Metadata.source;
  const totals = data.totals;

  return (
    <main className={`shell page ${styles.page}`}>
      <header className="page-intro">
        <p className="eyebrow">Base territoriale · ISTAT</p>
        <h1>Griglia 1 km² del Censimento 2021</h1>
        <p>
          Prima fetta della base territoriale richiesta in{" "}
          <a href="https://github.com/Italian-Builders-Org/DoveVannoINostriSoldi/issues/664">
            #664
          </a>
          : aggregati statici ufficiali della popolazione legale sulle celle
          Eurostat da 1 km². Nessun bot di refresh e nessun richiamo API a
          runtime.
        </p>
        <p className={styles.links}>
          <Link href="/territori">Territori (comuni) →</Link>
          <Link href="/dati/istat-misura-comune-vecchiaia">A misura di Comune →</Link>
          <a href={source.landingUrl} target="_blank" rel="noreferrer">
            Fonte ISTAT ↗
          </a>
        </p>
      </header>

      <section className={`panel ${styles.hero}`} aria-labelledby="griglia-totale">
        <div>
          <h2 id="griglia-totale" className="panel-title">
            Italia · censimento {data.reference.censusYear}
          </h2>
          <strong className={styles.heroRate} data-testid="grid-population">
            {integer(totals.residentPopulation)}
          </strong>
          <p className={styles.heroLabel}>persone sulla griglia ufficiale 1 km²</p>
        </div>
        <dl className={styles.heroMetrics}>
          <div>
            <dt>Celle pubblicate</dt>
            <dd data-testid="grid-cells">{integer(totals.cells)}</dd>
            <small>di cui {integer(totals.cellsWithPopulation)} con popolazione &gt; 0</small>
          </div>
          <div>
            <dt>Occupati</dt>
            <dd>{integer(totals.employed)}</dd>
            <small>variabile censuaria sulla griglia</small>
          </div>
          <div>
            <dt>Nato in Italia</dt>
            <dd>{integer(totals.bornInItaly)}</dd>
            <small>sul totale residente in griglia</small>
          </div>
        </dl>
      </section>

      <div className="notice">
        <strong>Cosa aggreghiamo, e dove</strong>
        <p>
          Qui pubblichiamo solo totali nazionali e fasce di densità cella→persone
          derivati dal CSV ufficiale. L’appoggio economico resta sui{" "}
          <strong>codici ISTAT comunali</strong> (A misura di Comune e
          panoramica Territori/SIOPE): la griglia non sostituisce i confini
          comunali e non viene usata per simulazioni di policy.
        </p>
      </div>

      <section className="panel" aria-labelledby="struttura-title">
        <h2 id="struttura-title" className="panel-title">
          Struttura della popolazione in griglia
        </h2>
        <dl className={styles.stats}>
          <div>
            <dt>Maschi</dt>
            <dd>{integer(totals.malePopulation)}</dd>
          </div>
          <div>
            <dt>Femmine</dt>
            <dd>{integer(totals.femalePopulation)}</dd>
          </div>
          <div>
            <dt>Campo Pop_0_15</dt>
            <dd>{integer(totals.populationFieldPop0_15)}</dd>
          </div>
          <div>
            <dt>15-64 anni</dt>
            <dd>{integer(totals.populationAge15to64)}</dd>
          </div>
          <div>
            <dt>65 anni e oltre</dt>
            <dd>{integer(totals.populationAge65plus)}</dd>
          </div>
          <div>
            <dt>Celle a popolazione 0</dt>
            <dd>{integer(totals.cellsWithZeroPopulation)}</dd>
          </div>
        </dl>
      </section>

      <section className="panel" aria-labelledby="bande-title">
        <h2 id="bande-title" className="panel-title">
          Celle per fascia di popolazione
        </h2>
        <div className={`table-scroll ${styles.tableWrap}`} role="region" aria-label="Fasce di popolazione delle celle" tabIndex={0}>
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Fascia</th>
                <th scope="col">Celle</th>
              </tr>
            </thead>
            <tbody>
              {data.populationBands.map((band) => (
                <tr key={band.id}>
                  <th scope="row">{band.label}</th>
                  <td>{integer(band.cells)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel" aria-labelledby="join-title">
        <h2 id="join-title" className="panel-title">
          Appoggio ai dati economici già pubblicati
        </h2>
        <ul className={styles.joinList}>
          {data.economicJoins.map((join) => (
            <li key={join.id}>
              <Link href={join.href}>{join.label}</Link>
              <small>
                Chiave: {join.joinKey}. {join.note}
              </small>
            </li>
          ))}
        </ul>
      </section>

      <details className="data-details">
        <summary>Fonti, limiti e metodo</summary>
        <section className="panel" aria-labelledby="fonti-title">
          <h2 id="fonti-title" className="panel-title">
            Provenienza
          </h2>
          <ul className={styles.sourceList}>
            <li>
              Acquisizione: {longDate(source.acquiredAt)} · asset{" "}
              <code>{source.asset.sha256.slice(0, 12)}…</code>
            </li>
            <li>
              <a href={source.landingUrl} target="_blank" rel="noreferrer">
                Landing ufficiale ↗
              </a>
            </li>
            <li>
              <a href={source.assetUrl} target="_blank" rel="noreferrer">
                CSV zip ufficiale ↗
              </a>
            </li>
            <li>
              <a href={source.methodologyUrl} target="_blank" rel="noreferrer">
                Nota metodologica ↗
              </a>
            </li>
            <li>Licenza sul payload: non dichiarata (note legali ISTAT).</li>
            <li>Refresh automatico: assente. Runtime network: assente.</li>
          </ul>
          <ul className={styles.caveatList}>
            {data.caveats.map((caveat) => (
              <li key={caveat}>{caveat}</li>
            ))}
          </ul>
        </section>
      </details>
    </main>
  );
}
