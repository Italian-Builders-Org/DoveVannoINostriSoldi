import type { Metadata } from "next";
import Link from "next/link";
import { RegionCrest, RegionCrestAttribution } from "@/components/region-crest";
import { compactEuro, integer, longDate, percent } from "@/lib/format";
import { inpsCivilInvaliditySnapshot as data } from "@/lib/inps-invalidity-snapshot";
import { istatCodeOfRegion } from "@/lib/italy-regions";
import styles from "./invalidita.module.css";

export const metadata: Metadata = {
  title: "Invalidità civile INPS",
  description:
    "Spesa nazionale, prestazioni vigenti e nuove pensioni di invalidità civile per regione, con fonti e limiti INPS.",
};

function euroFromCents(value: number): number {
  return value / 100;
}

function regionalValue(region: (typeof data.regionalNewPensions.regions)[number], year: number) {
  const index = data.regionalNewPensions.years.indexOf(year);
  return index === -1 ? null : region.values[index];
}

export default function CivilInvalidityPage() {
  const latest = data.spending.series.at(-1)!;
  const previous = data.spending.series.at(-2)!;
  const detailTotal =
    data.managementDetail2024.civilInvalidityPensions +
    data.managementDetail2024.attendanceAllowances;
  const attendanceShare =
    (data.managementDetail2024.attendanceAllowances / detailTotal) * 100;

  return (
    <main className="shell page">
      <header className="page-intro">
        <h1>Invalidità civile: quanto spende l’INPS</h1>
        <p>
          Spesa nazionale, prestazioni vigenti e nuove pensioni per regione. Le misure restano
          separate perché non descrivono la stessa cosa.
        </p>
      </header>

      <div className={`stat-strip ${styles.stats}`}>
        <div>
          <span className="stat-label">Prestazioni di invalidità civile · {latest.year}</span>
          <span className="stat-value">{compactEuro(euroFromCents(latest.amountCents))}</span>
          <span className="stat-note">voce complessiva INPS, importo arrotondato</span>
        </div>
        <div>
          <span className="stat-label">Anno precedente · {previous.year}</span>
          <span className="stat-value">{compactEuro(euroFromCents(previous.amountCents))}</span>
          <span className="stat-note">
            +{compactEuro(euroFromCents(data.spending.latestChangeCents))} · +
            {percent(data.spending.latestChangePercent)}
          </span>
        </div>
        <div>
          <span className="stat-label">Prestazioni vigenti al 31 dicembre 2024</span>
          <span className="stat-value">{integer(data.benefitsStock.totalBenefits)}</span>
          <span className="stat-note">conteggio di prestazioni vigenti</span>
        </div>
      </div>

      <div className="notice">
        <strong>La voce comprende tutte le prestazioni di invalidità civile</strong>
        <p>
          Nel dettaglio 2024 della Gestione n. 25 l’accompagnamento è la voce più grande. Quel
          dettaglio ha un ambito più stretto: non si somma né si sottrae al totale sopra.
        </p>
      </div>

      <div className={styles.columns}>
        <section className="panel" aria-labelledby="detail-title">
          <h2 className="panel-title" id="detail-title">
            Dettaglio 2024 · invalidi civili nella Gestione n. 25
          </h2>
          <dl className={styles.breakdown}>
            <div>
              <dt>Indennità di accompagnamento agli invalidi civili</dt>
              <dd>{integer(data.managementDetail2024.attendanceAllowances)} mln €</dd>
              <span aria-hidden="true">
                <i style={{ width: `${attendanceShare}%` }} />
              </span>
            </div>
            <div>
              <dt>Rate di pensione agli invalidi civili</dt>
              <dd>{integer(data.managementDetail2024.civilInvalidityPensions)} mln €</dd>
              <span aria-hidden="true">
                <i
                  style={{
                    width: `${100 - attendanceShare}%`,
                    background: "var(--color-neutral-700)",
                  }}
                />
              </span>
            </div>
          </dl>
          <p className={styles.note}>{data.managementDetail2024.warning}</p>
          <p className={styles.note}>
            Il pannello non include le componenti della Gestione n. 25 destinate a ciechi civili e
            persone sorde.
          </p>
        </section>

        <section className="panel" aria-labelledby="stock-title">
          <h2 className="panel-title" id="stock-title">
            Prestazioni vigenti al 31 dicembre 2024
          </h2>
          <dl className={styles.stockList}>
            <div>
              <dt>Indennità di accompagnamento</dt>
              <dd>{integer(data.benefitsStock.attendanceAllowances)}</dd>
            </div>
            <div>
              <dt>Pensioni di invalidità civile</dt>
              <dd>{integer(data.benefitsStock.civilInvalidityPensions)}</dd>
            </div>
          </dl>
          <p className={styles.note}>
            Lo stock misura prestazioni vigenti accumulate nel tempo. Non misura nuove concessioni,
            spesa annua o frodi accertate.
          </p>
        </section>
      </div>

      <section className="panel" aria-labelledby="series-title">
        <h2 className="panel-title" id="series-title">
          Serie nazionale della spesa
        </h2>
        <div
          className="table-scroll"
          role="region"
          aria-label="Spesa nazionale INPS per prestazioni di invalidità civile; scorri orizzontalmente per vedere tutte le colonne"
          tabIndex={0}
        >
          <table className="table">
            <caption className={styles.visuallyHidden}>
              Spesa nazionale INPS per prestazioni di invalidità civile dal 2021 al 2025.
            </caption>
            <thead>
              <tr>
                <th scope="col">Anno</th>
                <th scope="col" className="num">Spesa</th>
                <th scope="col">Misura</th>
              </tr>
            </thead>
            <tbody>
              {[...data.spending.series].reverse().map((point) => (
                <tr key={point.year}>
                  <th scope="row">{point.year}</th>
                  <td className="num">{compactEuro(euroFromCents(point.amountCents))}</td>
                  <td>Prestazioni di invalidità civile · inclusione sociale INPS</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel" aria-labelledby="regions-title">
        <div className={styles.sectionHead}>
          <div>
            <h2 className="panel-title" id="regions-title">
              Nuove pensioni di invalidità civile per regione
            </h2>
            <p>Tabella alfabetica. Il 2024 è ancora parziale; il 2023 è l’ultimo anno completo.</p>
          </div>
          <span className="tag tag-neutral">18 regioni coperte</span>
        </div>
        <div
          className="table-scroll"
          role="region"
          aria-label="Nuove pensioni di invalidità civile per regione; scorri orizzontalmente per vedere tutte le colonne"
          tabIndex={0}
        >
          <table className="table">
            <caption className={styles.visuallyHidden}>
              Nuove pensioni di invalidità civile per regione nel 2023 completo e nel 2024 parziale.
            </caption>
            <thead>
              <tr>
                <th scope="col">Regione</th>
                <th scope="col" className="num">2023 · completo</th>
                <th scope="col" className="num">2024 · parziale</th>
              </tr>
            </thead>
            <tbody>
              {data.regionalNewPensions.regions.map((region) => {
                const regionCode = istatCodeOfRegion(region.region);
                return (
                  <tr key={region.region}>
                    <th scope="row">
                      {regionCode ? (
                        <RegionCrest regionCode={regionCode} regionName={region.region} decorative />
                      ) : null}{" "}
                      {region.region}
                    </th>
                    <td className="num">{integer(regionalValue(region, 2023) ?? 0)}</td>
                    <td className="num">{integer(regionalValue(region, 2024) ?? 0)}</td>
                  </tr>
                );
              })}
              <tr>
                <th scope="row">Totale della copertura</th>
                <td className="num">
                  {integer(
                    data.regionalNewPensions.nationalTotals[
                      data.regionalNewPensions.years.indexOf(2023)
                    ],
                  )}
                </td>
                <td className="num">
                  {integer(
                    data.regionalNewPensions.nationalTotals[
                      data.regionalNewPensions.years.indexOf(2024)
                    ],
                  )}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className={styles.note}>
          Non incluse: {data.regionalNewPensions.excludedRegions.join(" e ")}. La fonte spiega che
          le prestazioni sono erogate localmente dalle autonomie competenti. Non pubblichiamo una
          graduatoria pro capite grezza: prima servono popolazione coerente per anno e
          standardizzazione almeno per età.
        </p>
      </section>

      <RegionCrestAttribution />

      <div className={styles.columns}>
        <section className="panel">
          <h2 className="panel-title">Quanto dettaglio territoriale è disponibile</h2>
          <dl className={styles.coverageList}>
            <div><dt>Regione</dt><dd>Serie strutturata verificata</dd></div>
            <div>
              <dt>Provincia</dt>
              <dd>
                <a href="https://www.inps.it/it/it/dati-e-bilanci/rendiconti-sociali/rendiconti-sociali-2017-2024/rendiconti-sociali-2024/rendiconti-provinciali-2024.html" target="_blank" rel="noreferrer" aria-label="Rendiconti sociali provinciali INPS, si apre in una nuova scheda">
                  Rendiconti PDF ↗
                </a>, non ancora normalizzati
              </dd>
            </div>
            <div>
              <dt>Comune</dt>
              <dd>
                <a href="https://www.inps.it/it/it/dati-e-bilanci/welfare-as-a-service/welfare-analytics-gate.html" target="_blank" rel="noreferrer" aria-label="Welfare Analytics Gate INPS, si apre in una nuova scheda">
                  Welfare Analytics Gate ↗
                </a>, accesso autorizzato e non open data anonimo
              </dd>
            </div>
            <div><dt>Medici e persone</dt><dd>Non pubblicati né inferibili</dd></div>
          </dl>
        </section>
        <section className="panel">
          <h2 className="panel-title">Come leggere questi aggregati</h2>
          <p className={styles.bodyCopy}>{data.methodology.interpretation}</p>
          <p className={styles.bodyCopy}>
            I dati sanitari individuali richiedono una base giuridica e tutele specifiche. Per
            accertare responsabilità servono verifiche amministrative o giudiziarie sui singoli
            casi.
          </p>
        </section>
      </div>

      <section className="panel" aria-labelledby="sources-title">
        <h2 className="panel-title" id="sources-title">Documenti ufficiali usati</h2>
        <ul className={styles.sourceList}>
          {data.sources.map((source) => (
            <li key={source.id}>
              <a
                href={source.url}
                target="_blank"
                rel="noreferrer"
                aria-label={`${source.title}, si apre in una nuova scheda`}
              >
                {source.title} ↗
              </a>
              <span>
                {source.owner} · documento {longDate(source.documentDate)} · controllato il{" "}
                {longDate(source.observedAt)} · {source.locator}
              </span>
              <code>sha256:{source.sha256}</code>
            </li>
          ))}
        </ul>
        <p className={styles.note}>
          Lo stesso snapshot è disponibile tramite l’API <code>/api/spese/invalidita</code> e il
          dataset MCP <code>inps_invalidita_civile</code>. <Link href="/mcp">Apri la pagina MCP →</Link>
        </p>
      </section>
    </main>
  );
}
