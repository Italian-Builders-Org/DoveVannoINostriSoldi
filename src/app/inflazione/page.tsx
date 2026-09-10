import type { Metadata } from "next";
import Link from "next/link";
import { longDate } from "@/lib/format";
import { getInflationView, ISTAT_CONSUMER_PRICE_2026_URL } from "@/lib/inflation";
import { InflationTrendChart } from "./inflation-trend-chart";
import styles from "./inflazione.module.css";

export const metadata: Metadata = {
  title: "Inflazione IPCA in Italia: tassi, paniere e confronto UE",
  description:
    "Inflazione IPCA/HICP in Italia da Eurostat: variazione annua e mensile, indice 2025=100, 13 divisioni ECOICOP v2, pesi del paniere e confronto con UE27 e area euro.",
  alternates: { canonical: "/inflazione" },
};

const rate = new Intl.NumberFormat("it-IT", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
  signDisplay: "exceptZero",
});
const indexValue = new Intl.NumberFormat("it-IT", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const weight = new Intl.NumberFormat("it-IT", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 3,
});

function rateLabel(value: number): string {
  return `${rate.format(value)}%`;
}

export default function InflationPage() {
  const view = getInflationView();
  const maxDivisionRate = Math.max(...view.divisionsByRate.map((row) => Math.abs(row.annualRate)), 1);
  const italyComparison = view.comparison.find((row) => row.geo === "IT");
  if (!italyComparison) throw new Error("Confronto IPCA senza Italia");
  const assets = Object.entries(view.metadata.source.assets);

  return (
    <main className="shell page">
      <header className="page-intro">
        <p className="eyebrow">Prezzi · Eurostat HICP</p>
        <h1>Inflazione IPCA</h1>
        <p>
          Quanto cambiano i prezzi in Italia, quali gruppi del paniere si muovono di più e come si confronta
          lo stesso indicatore con Unione europea e area euro. Qui parliamo di prezzi al consumo, non di spesa pubblica.
        </p>
        <p className={styles.links}>
          <a href="#ipca-andamento">Andamento Italia ↓</a>
          <a href="#ipca-capitoli">Capitoli del paniere ↓</a>
          <a href="#ipca-confronto">Confronto europeo ↓</a>
          <a href="#ipca-fonti">Dati e fonti ↓</a>
        </p>
      </header>

      <section className={`panel ${styles.hero}`} aria-labelledby="ipca-ultimo-title">
        <div>
          <h2 id="ipca-ultimo-title" className="panel-title">Italia · {view.latest.periodLabel}</h2>
          <strong className={styles.heroRate} data-testid="hicp-annual-rate">{rateLabel(view.latest.annualRate)}</strong>
          <p className={styles.heroLabel}>variazione rispetto allo stesso mese dell’anno precedente</p>
          {view.latest.estimated ? <p className={styles.estimated}>Dato contrassegnato come stima da Eurostat.</p> : null}
        </div>
        <dl className={styles.heroMetrics}>
          <div>
            <dt>Rispetto al mese prima</dt>
            <dd>{rateLabel(view.latest.monthlyRate)}</dd>
            <small>variazione mensile</small>
          </div>
          <div>
            <dt>Livello dell’indice</dt>
            <dd>{indexValue.format(view.latest.index)}</dd>
            <small>base 2025=100</small>
          </div>
          <div>
            <dt>Serie pubblicata qui</dt>
            <dd>{view.trend.length} mesi</dd>
            <small>{view.data.period.total.from} / {view.data.period.total.to}</small>
          </div>
        </dl>
        <p className={styles.sourceLine}>
          Fonte: <a href={view.metadata.source.landingUrl}>Eurostat, prc_hicp_minr</a> · controllato il {longDate(view.metadata.source.acquisition.checkedAt)}.
        </p>
      </section>

      <section className="panel" id="ipca-andamento" aria-labelledby="ipca-andamento-title">
        <div className={styles.sectionHead}>
          <div>
            <h2 id="ipca-andamento-title" className="panel-title">Andamento in Italia</h2>
            <p>Due tassi con significati diversi, sulla stessa unità percentuale. Il valore esatto dell’indice resta nella tabella del grafico.</p>
          </div>
          <span className={styles.periodBadge}>{view.data.period.total.from} / {view.data.period.total.to}</span>
        </div>
        <InflationTrendChart data={view.trend} />
      </section>

      <section className="panel" id="ipca-capitoli" aria-labelledby="ipca-capitoli-title">
        <div className={styles.sectionHead}>
          <div>
            <h2 id="ipca-capitoli-title" className="panel-title">Dove cambiano i prezzi</h2>
            <p>
              Variazione annua per le 13 divisioni ECOICOP v2 in {view.comparison[0]?.periodLabel}.
              Accanto mostriamo il peso {view.currentWeightYear} nel paniere IPCA italiano.
            </p>
          </div>
          <span className={styles.periodBadge}>Prezzi {view.data.period.divisions} · pesi {view.currentWeightYear}</span>
        </div>
        <p className={`notice ${styles.methodNotice}`}>
          <strong>Non sono contributi additivi</strong>
          Il peso dice quanto conta una divisione nel paniere, il tasso dice quanto sono cambiati i suoi prezzi.
          Non moltiplichiamo i due numeri per inventare un contributo italiano che questa fonte non pubblica come serie additiva equivalente.
        </p>
        <ol className={styles.divisionBars} aria-label="Divisioni IPCA ordinate per variazione annua">
          {view.divisionsByRate.map((row) => (
            <li key={row.code}>
              <div className={styles.divisionHeading}>
                <span><code>{row.code}</code> {row.label}</span>
                <strong>{rateLabel(row.annualRate)}</strong>
              </div>
              <span className={styles.divisionTrack} aria-hidden="true">
                <span style={{ width: `${Math.max(1, Math.abs(row.annualRate) / maxDivisionRate * 100)}%` }} />
              </span>
              <small>Peso nel paniere {view.currentWeightYear}: {weight.format(row.weightPercent)}%</small>
            </li>
          ))}
        </ol>
        <div className="table-scroll" role="region" aria-label="Divisioni e pesi IPCA" tabIndex={0}>
          <table className="table">
            <caption>Eurostat HICP · Italia · ECOICOP v2</caption>
            <thead>
              <tr><th scope="col">Divisione</th><th scope="col" className="num">Variazione a/a</th><th scope="col" className="num">Peso {view.currentWeightYear}</th></tr>
            </thead>
            <tbody>
              {view.divisions.map((row) => (
                <tr key={row.code}>
                  <th scope="row"><code>{row.code}</code> {row.label}</th>
                  <td className="num">{rateLabel(row.annualRate)}</td>
                  <td className="num">{weight.format(row.weightPerThousand)}‰ · {weight.format(row.weightPercent)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel" id="ipca-confronto" aria-labelledby="ipca-confronto-title">
        <div className={styles.sectionHead}>
          <div>
            <h2 id="ipca-confronto-title" className="panel-title">Stesso indicatore, stesso mese</h2>
            <p>Confronto descrittivo del tasso IPCA annuo nello stesso dataset Eurostat e nello stesso periodo.</p>
          </div>
          <span className={styles.periodBadge}>{italyComparison.periodLabel}</span>
        </div>
        <dl className={styles.comparisonGrid}>
          {view.comparison.map((row) => {
            const delta = row.annualRate - italyComparison.annualRate;
            return (
              <div key={row.geo} data-italy={row.geo === "IT" ? "true" : undefined}>
                <dt>{row.label}</dt>
                <dd>{rateLabel(row.annualRate)}</dd>
                <small>{row.geo === "IT" ? "riferimento Italia" : `${rate.format(delta)} punti percentuali rispetto all’Italia`}</small>
              </div>
            );
          })}
        </dl>
        <p className={styles.note}>
          Gli aggregati UE27 e area euro contengono già gli Stati membri e non vanno sommati ai paesi.
          Una differenza di tasso non attribuisce cause o responsabilità a un governo.
        </p>
        <p><Link href="/governi">Vai alla pagella dei governi, dove l’IPCA è solo uno degli indicatori macro →</Link></p>
      </section>

      <section className="panel" aria-labelledby="ipca-glossario-title">
        <h2 id="ipca-glossario-title" className="panel-title">Indice, tasso, IPCA, NIC e FOI</h2>
        <dl className={styles.glossary}>
          <div>
            <dt>Indice</dt>
            <dd>È il livello della serie rispetto a una base convenzionale. Qui Eurostat usa 2025=100. Non è una percentuale di inflazione.</dd>
          </div>
          <div>
            <dt>Tasso annuo</dt>
            <dd>Confronta l’indice del mese con lo stesso mese dell’anno precedente. È il numero più spesso chiamato “inflazione”.</dd>
          </div>
          <div>
            <dt>Tasso mensile</dt>
            <dd>Confronta il mese con quello immediatamente precedente. Può muoversi molto anche quando il tasso annuo cambia poco.</dd>
          </div>
          <div>
            <dt>IPCA, NIC e FOI</dt>
            <dd>
              L’IPCA segue la metodologia armonizzata europea. NIC e FOI sono indici nazionali ISTAT con popolazioni, pesi e usi differenti:
              non sostituiamo uno con l’altro. <a href={ISTAT_CONSUMER_PRICE_2026_URL}>Vedi la nota ISTAT 2026 ↗</a>
            </dd>
          </div>
        </dl>
      </section>

      <details className="data-details" id="ipca-fonti">
        <summary>Fonti, metodo e limiti</summary>
        <section className={`panel ${styles.provenance}`} aria-labelledby="ipca-source-title">
          <h2 id="ipca-source-title" className="panel-title">Eurostat · HICP ECOICOP v2</h2>
          <p>
            Snapshot tipizzato e fail-closed di <code>prc_hicp_minr</code> e <code>prc_hicp_iw</code>.
            Le risposte ufficiali sono bloccate per URL, struttura SDMX, data di aggiornamento, byte e SHA-256.
          </p>
          <dl className={styles.metadata}>
            <div><dt>Periodo totale Italia</dt><dd>{view.data.period.total.from} / {view.data.period.total.to}</dd></div>
            <div><dt>Confronto e divisioni</dt><dd>{view.data.period.comparison}</dd></div>
            <div><dt>Pesi</dt><dd>{view.data.period.weightYears.join("-")}</dd></div>
            <div><dt>Controllato</dt><dd>{longDate(view.metadata.source.acquisition.checkedAt)}</dd></div>
            <div><dt>Licenza</dt><dd><a href={view.metadata.source.termsUrl}>{view.metadata.source.licenseId}</a></dd></div>
            <div><dt>Riconciliazione pesi</dt><dd>13 divisioni → 1000‰, solo tolleranza di arrotondamento</dd></div>
          </dl>
          <p>
            <a href={view.metadata.source.informationUrl}>Metodo HICP di Eurostat ↗</a> · {" "}
            <a href={view.metadata.source.weightsLandingUrl}>Pesi del paniere ↗</a>
          </p>
          <ul>{view.data.caveats.map((note) => <li key={note}>{note}</li>)}</ul>
          <details>
            <summary>Risposte acquisite e impronte SHA-256</summary>
            {assets.map(([name, asset]) => (
              <p key={name}>
                <a href={asset.url}>{name} · {asset.datasetCode}</a><br />
                SHA-256: <code>{asset.sha256}</code>
              </p>
            ))}
            <p>SHA-256 dello snapshot normalizzato: <code>{view.metadata.integrity.dataArtifact.sha256}</code>.</p>
          </details>
        </section>
      </details>
    </main>
  );
}
