import type { Metadata } from "next";
import Link from "next/link";
import { longDate } from "@/lib/format";
import { getTaxWedgeView } from "@/lib/tax-wedge";
import styles from "./cuneo-fiscale.module.css";

export const metadata: Metadata = {
  title: "Cuneo fiscale sul lavoro: profilo tipo OECD",
  description:
    "Cuneo fiscale italiano OECD Taxing Wages: profilo single al 100% del salario medio, composizione IRPEF e contributi, confronto con Francia, Germania, Spagna e media OECD.",
  alternates: { canonical: "/cuneo-fiscale" },
};

const percent = new Intl.NumberFormat("it-IT", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 2,
});

function percentLabel(value: number): string {
  return `${percent.format(value)}%`;
}

export default function TaxWedgePage() {
  const view = getTaxWedgeView();
  const assets = Object.entries(view.metadata.source.assets);
  const maxHistory = Math.max(...view.history.map((row) => row.taxWedge), 1);

  return (
    <main className="shell page">
      <header className="page-intro">
        <p className="eyebrow">Lavoro · OECD Taxing Wages</p>
        <h1>Cuneo fiscale sul lavoro</h1>
        <p>
          Quanto pesano tasse e contributi su un lavoratore tipo, secondo la metodologia OECD.
          Non è la busta paga di una persona reale e non è l’IRPEF dichiarata nei territori.
        </p>
        <p className={styles.links}>
          <a href="#cuneo-composizione">Composizione ↓</a>
          <a href="#cuneo-andamento">Andamento Italia ↓</a>
          <a href="#cuneo-confronto">Confronto europeo ↓</a>
          <a href="#cuneo-fonti">Fonti e limiti ↓</a>
          <Link href="/economia">Economia →</Link>
          <Link href="/territori/irpef">IRPEF territoriale →</Link>
        </p>
      </header>

      <section className={`panel ${styles.hero}`} aria-labelledby="cuneo-ultimo-title">
        <div>
          <h2 id="cuneo-ultimo-title" className="panel-title">Italia · {view.latest.year}</h2>
          <strong className={styles.heroRate} data-testid="tax-wedge-rate">
            {percentLabel(view.latest.taxWedge)}
          </strong>
          <p className={styles.heroLabel}>
            cuneo medio sul costo del lavoro · {view.profile.household} · {view.profile.earnings}
          </p>
        </div>
        <dl className={styles.heroMetrics}>
          <div>
            <dt>Imposta sul reddito</dt>
            <dd>{percentLabel(view.latest.incomeTax)}</dd>
            <small>sul lordo · AV_ITR</small>
          </div>
          <div>
            <dt>Contributi lavoratore</dt>
            <dd>{percentLabel(view.latest.employeeSsc)}</dd>
            <small>sul lordo · AV_R_EMPEE_SSC</small>
          </div>
          <div>
            <dt>Contributi datore</dt>
            <dd>{percentLabel(view.latest.employerSsc)}</dd>
            <small>sul lordo · AV_R_EMPER_SSC</small>
          </div>
        </dl>
        <p className={styles.sourceLine}>
          Fonte: <a href={view.metadata.source.landingUrl}>{view.metadata.source.publication.title}</a>
          {" · "}
          <a href={view.metadata.source.publication.doi}>DOI</a>
          {" · controllato il "}
          {longDate(view.metadata.source.acquisition.checkedAt)}.
        </p>
      </section>

      <section className="panel" id="cuneo-composizione" aria-labelledby="cuneo-composizione-title">
        <div className={styles.sectionHead}>
          <div>
            <h2 id="cuneo-composizione-title" className="panel-title">Composizione sul lordo · {view.latest.year}</h2>
            <p>
              Le tre voci sotto sono percentuali del salario lordo. Il cuneo in alto è percentuale del
              costo del lavoro: stesso profilo, denominatori diversi.
            </p>
          </div>
          <span className={styles.periodBadge}>{view.profile.sourceEarnings}</span>
        </div>
        <ul className={styles.componentList} data-testid="tax-wedge-components">
          {view.components.map((row) => (
            <li key={row.key}>
              <div>
                <strong>{row.label}</strong>
                <div className={styles.componentMeta}>
                  <span>{row.sourceCode}</span>
                  <span>unità: % del lordo</span>
                </div>
              </div>
              <span className={styles.value}>{percentLabel(row.value)}</span>
              <div className={styles.barTrack} aria-hidden="true">
                <span className={styles.barFill} style={{ width: `${Math.max(row.barShare * 100, 1.5)}%` }} />
              </div>
            </li>
          ))}
        </ul>
        <p className={styles.note}>{view.reconciliationNote}</p>
      </section>

      <section className="panel" id="cuneo-andamento" aria-labelledby="cuneo-andamento-title">
        <div className={styles.sectionHead}>
          <div>
            <h2 id="cuneo-andamento-title" className="panel-title">Andamento in Italia</h2>
            <p>
              Serie annuale del cuneo medio sul costo del lavoro per lo stesso profilo tipo.
              I valori esatti restano nella tabella.
            </p>
          </div>
          <span className={styles.periodBadge}>
            {view.data.period.from}-{view.data.period.to}
          </span>
        </div>
        <ul className={styles.historyList} data-testid="tax-wedge-history" aria-label="Cuneo fiscale italiano per anno">
          {view.history.map((row) => (
            <li key={row.year}>
              <div>
                <strong>{row.year}</strong>
                <div className={styles.historyMeta}>
                  <span>profilo S_C0 AW100</span>
                </div>
              </div>
              <span className={styles.value}>{percentLabel(row.taxWedge)}</span>
              <div className={styles.barTrack} aria-hidden="true">
                <span
                  className={styles.barFill}
                  style={{ width: `${Math.max((row.taxWedge / maxHistory) * 100, 1.5)}%` }}
                />
              </div>
            </li>
          ))}
        </ul>
        <details className="chart-data">
          <summary>Valori annuali esatti</summary>
          <div className="table-scroll" role="region" aria-label="Cuneo fiscale italiano, valori annuali" tabIndex={0}>
            <table className="table">
              <caption className="table-caption">
                Italia · single senza figli · 100% salario medio · percentuali pubblicate da OECD
              </caption>
              <thead>
                <tr>
                  <th scope="col">Anno</th>
                  <th scope="col" className="num">Cuneo · % costo lavoro</th>
                  <th scope="col" className="num">IRPEF · % lordo</th>
                  <th scope="col" className="num">SSC lavoratore · % lordo</th>
                  <th scope="col" className="num">SSC datore · % lordo</th>
                </tr>
              </thead>
              <tbody>
                {view.history.toReversed().map((row) => (
                  <tr key={row.year}>
                    <th scope="row">{row.year}</th>
                    <td className="num">{percentLabel(row.taxWedge)}</td>
                    <td className="num">{percentLabel(row.incomeTax)}</td>
                    <td className="num">{percentLabel(row.employeeSsc)}</td>
                    <td className="num">{percentLabel(row.employerSsc)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      </section>

      <section className="panel" id="cuneo-confronto" aria-labelledby="cuneo-confronto-title">
        <div className={styles.sectionHead}>
          <div>
            <h2 id="cuneo-confronto-title" className="panel-title">Confronto europeo · {view.comparison[0]?.year}</h2>
            <p>
              Stesso profilo OECD per Italia, Francia, Germania, Spagna e media OECD.
              Un valore più alto non è da solo un giudizio di merito.
            </p>
          </div>
          <span className={styles.periodBadge}>AW100 · S_C0</span>
        </div>
        <ul className={styles.comparisonList} data-testid="tax-wedge-comparison">
          {view.comparison.map((row) => (
            <li key={row.geo}>
              <div>
                <strong>{row.label}</strong>
                <div className={styles.comparisonMeta}>
                  <span>{row.geo}</span>
                  <span>{row.kind === "aggregate" ? "aggregato" : "paese"}</span>
                </div>
              </div>
              <span className={styles.value}>{percentLabel(row.taxWedge)}</span>
              <div className={styles.barTrack} aria-hidden="true">
                <span
                  className={styles.barFill}
                  style={{ width: `${Math.max((row.taxWedge / view.maxComparison) * 100, 1.5)}%` }}
                />
              </div>
            </li>
          ))}
        </ul>
      </section>

      <details className="data-details" id="cuneo-fonti">
        <summary>Fonti, periodo e limiti</summary>
        <section className="panel" aria-labelledby="cuneo-limiti-title">
          <h2 id="cuneo-limiti-title" className="panel-title">Cosa misura e cosa no</h2>
          <ul className={styles.caveats}>
            {view.data.caveats.map((caveat) => (
              <li key={caveat}>{caveat}</li>
            ))}
          </ul>
          <p className={styles.note}>
            Distinto da <Link href="/territori/irpef">IRPEF MEF territoriale</Link> e dai pagamenti SIOPE.
            Low wage AW67 nello snapshot ({percentLabel(view.latest.lowWageTaxWedge)} nel {view.latest.year})
            serve solo al controllo con Eurostat, non è il numero in evidenza.
          </p>
        </section>
        <section className="panel" aria-labelledby="cuneo-provenienza-title">
          <h2 id="cuneo-provenienza-title" className="panel-title">Provenienza</h2>
          <p>
            Titolare: {view.metadata.source.owner}. Dataset: {view.metadata.source.dataflowId}{" "}
            v{view.metadata.source.dataflowVersion}. Licenza: {view.metadata.source.licenseId}.
          </p>
          <p>{view.metadata.source.publication.citation}</p>
          <p>
            Acquisito il {longDate(view.metadata.source.acquisition.acquiredAt)}; controllato il{" "}
            {longDate(view.metadata.source.acquisition.checkedAt)}. Periodo di riferimento:{" "}
            {view.metadata.referencePeriod}.
          </p>
          <div className="table-scroll" role="region" aria-label="Asset OECD acquisiti" tabIndex={0}>
            <table className="table">
              <caption className="table-caption">Asset SDMX-CSV fissati nello source lock</caption>
              <thead>
                <tr>
                  <th scope="col">Asset</th>
                  <th scope="col">Byte</th>
                  <th scope="col">SHA-256</th>
                </tr>
              </thead>
              <tbody>
                {assets.map(([name, asset]) => (
                  <tr key={name}>
                    <th scope="row">
                      <a href={asset.url}>{name}</a>
                    </th>
                    <td className="num">{asset.bytes}</td>
                    <td><code>{asset.sha256.slice(0, 12)}…</code></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </details>
    </main>
  );
}
