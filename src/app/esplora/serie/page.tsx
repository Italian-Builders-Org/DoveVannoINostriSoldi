import type { Metadata } from "next";
import Link from "next/link";
import { decimal, longDate, percent } from "@/lib/format";
import {
  compareOfficialSeries, getOfficialSeriesCatalog, officialSeriesSegments,
  parseOfficialSeriesSelection, type OfficialSeries,
} from "@/lib/official-series";
import styles from "./serie.module.css";

export const metadata: Metadata = {
  title: "Confronta serie ufficiali",
  description: "Confronta da due a quattro serie Eurostat verificate: spesa PA COFOG o prezzi IPCA, con unità compatibili, tabella e fonti.",
};

function valueLabel(value: number, unit: OfficialSeries["unit"]) {
  // MIO_EUR is already the published unit; keep one decimal, including zero.
  return unit === "MIO_EUR" ? decimal(value) : percent(value, unit === "PC_GDP" ? 2 : 1);
}

export default async function OfficialSeriesPage({ searchParams }: {
  searchParams: Promise<{ serie?: string | string[] }>;
}) {
  const requested = parseOfficialSeriesSelection((await searchParams).serie);
  const catalog = getOfficialSeriesCatalog();
  const comparison = compareOfficialSeries(catalog, requested);
  const selected = comparison.selected;
  const families = [
    { id: "cofog-MIO_EUR", label: "Spesa PA · annuale · milioni di euro correnti" },
    { id: "cofog-PC_GDP", label: "Spesa PA · annuale · % del PIL" },
    { id: "hicp-total-annual-change", label: "Prezzi IPCA · mensile · variazione annua %" },
  ];
  const values = comparison.ok ? comparison.rows.flatMap((row) => row.points.flatMap((point) => point ? [point.value] : [])) : [];
  const min = Math.min(0, ...values);
  const max = Math.max(0, ...values);
  const range = max - min || 1;
  const y = (value: number) => 12 + (max - value) / range * 196;

  return <main className="shell page">
    <header className={styles.intro}>
      <p><Link href="/esplora">Esplora relazioni</Link> · <Link href="/dati">Catalogo dati</Link></p>
      <h1>Confronta serie ufficiali</h1>
      <p>Scegli da due a quattro serie e leggi come cambiano nel tempo. Il confronto usa i valori pubblicati da Eurostat, con la stessa unità, frequenza e definizione.</p>
    </header>

    <section className="panel" aria-labelledby="selection-title">
      <h2 className="panel-title" id="selection-title">Scegli le serie</h2>
      <p id="selection-help">Scegli all’interno della stessa famiglia. La spesa PA in euro, la sua quota di PIL e la variazione dei prezzi sono tre confronti distinti.</p>
      <form action="/esplora/serie" method="get" aria-describedby="selection-help">
        <div className={styles.selectors}>
          {[0, 1, 2, 3].map((index) => <label key={index} htmlFor={`serie-${index + 1}`}>
            Serie {index + 1}{index > 1 ? " (facoltativa)" : ""}
            <select id={`serie-${index + 1}`} name="serie" defaultValue={catalog.some((series) => series.id === requested[index]) ? requested[index] : ""}>
              <option value="">Seleziona una serie</option>
              {families.map((family) => <optgroup label={family.label} key={family.id}>
                {catalog.filter((series) => series.family === family.id).map((series) => <option key={series.id} value={series.id}>{series.label}</option>)}
              </optgroup>)}
            </select>
          </label>)}
        </div>
        <div className={styles.actions}><button className="btn" type="submit">Confronta serie</button><Link href="/esplora/serie">Ripristina esempio</Link></div>
      </form>
    </section>

    {!comparison.ok ? <section className="notice" role="alert" data-testid="series-warning">
      <h2>Controlla la selezione</h2><p>{comparison.message}</p>
      <p>Il grafico non viene calcolato. Correggi la selezione qui sopra.</p>
    </section> : <>
      <section className="panel" aria-labelledby="comparison-title" data-testid="series-comparison">
        <h2 className="panel-title" id="comparison-title">Andamento a confronto</h2>
        <p><strong>{selected[0].unitLabel}</strong> · Frequenza {selected[0].frequency === "annual" ? "annuale" : "mensile"} · {comparison.rows[0].period} al {comparison.rows.at(-1)!.period}</p>
        <p>{selected[0].scope}. Nessuna normalizzazione o somma delle serie.</p>
        <ol className={styles.legend}>
          {selected.map((series, index) => <li key={series.id}>
            <span className={`${styles.swatch} ${styles[`line${index}`]}`} aria-hidden="true" />
            <span>{index + 1}. {series.label} · <a href={`#fonte-${series.id}`}>Fonte e periodo</a></span>
          </li>)}
        </ol>
        <div className={styles.chart}>
          <span className={styles.tick}>{valueLabel(max, selected[0].unit)}</span>
          <svg viewBox="0 0 640 220" preserveAspectRatio="none" role="img" aria-labelledby="series-chart-title series-chart-desc" data-testid="series-chart">
            <title id="series-chart-title">{`Confronto di ${selected.length} serie ufficiali, ${comparison.rows[0].period} al ${comparison.rows.at(-1)!.period}`}</title>
            <desc id="series-chart-desc">Valori esatti e stato di ogni osservazione nella tabella seguente. Le linee si interrompono per valori mancanti o interruzioni dichiarate dalla fonte.</desc>
            {[0, 0.5, 1].map((fraction) => <line key={fraction} x1="8" x2="632" y1={12 + fraction * 196} y2={12 + fraction * 196} className={styles.grid} vectorEffect="non-scaling-stroke" />)}
            <line x1="8" x2="632" y1={y(0)} y2={y(0)} className={styles.zero} vectorEffect="non-scaling-stroke" />
            {selected.map((series, seriesIndex) => <g key={series.id} className={styles[`line${seriesIndex}`]}>
              {officialSeriesSegments(comparison.rows.map((row) => row.points[seriesIndex])).map((indices, segment) => <polyline key={segment} fill="none" strokeWidth="2.5" vectorEffect="non-scaling-stroke" points={indices.map((index) => `${8 + index / Math.max(1, comparison.rows.length - 1) * 624},${y(comparison.rows[index].points[seriesIndex]!.value)}`).join(" ")} />)}
              {comparison.rows.map((row, index) => row.points[seriesIndex] ? <circle key={row.period} cx={8 + index / Math.max(1, comparison.rows.length - 1) * 624} cy={y(row.points[seriesIndex]!.value)} r="2.2" strokeWidth="1" vectorEffect="non-scaling-stroke" /> : null)}
            </g>)}
          </svg>
          <span className={styles.tick}>{valueLabel(min, selected[0].unit)}</span>
          <div className={styles.periods}><span>{comparison.rows[0].period}</span><span>{comparison.rows[Math.floor((comparison.rows.length - 1) / 2)].period}</span><span>{comparison.rows.at(-1)!.period}</span></div>
        </div>
        <p className={styles.note}>Asse verticale comune, con zero visibile. I numeri e i tratti della legenda distinguono le serie anche senza colore. Le linee descrivono l’andamento tra osservazioni: non stimano i periodi mancanti. Stato e flag sono riportati nella tabella.</p>
      </section>

      <section className="panel" aria-labelledby="series-table-title">
        <h2 className="panel-title" id="series-table-title">Valori pubblicati e stato del dato</h2>
        <p>Unità di tutte le colonne: {selected[0].unitLabel}. “Non disponibile” è diverso da zero. Scorri la tabella per leggere tutte le serie.</p>
        <div className={`table-scroll ${styles.tableRegion}`} role="region" aria-label="Valori delle serie a confronto" tabIndex={0}>
          <table className="table" data-testid="series-table">
            <caption className="sr-only">Valori esatti delle serie selezionate, con periodo e stato della fonte</caption>
            <thead><tr><th scope="col">Periodo</th>{selected.map((series, index) => <th key={series.id} scope="col">{index + 1}. {series.label}</th>)}</tr></thead>
            <tbody>{comparison.rows.map((row) => <tr key={row.period}><th scope="row">{row.period}</th>{row.points.map((point, index) => <td key={selected[index].id} className="num">
              {point ? <><span data-value={point.value}>{valueLabel(point.value, selected[index].unit)}</span><small>{point.status}{point.breakBefore ? " · Interruzione di serie" : ""}</small></> : "Non disponibile"}
            </td>)}</tr>)}</tbody>
          </table>
        </div>
      </section>
    </>}

    {selected.length > 0 && <section className="panel" aria-labelledby="series-sources-title">
      <h2 className="panel-title" id="series-sources-title">Fonte e periodo di ogni serie</h2>
      <div className={styles.sources}>{selected.map((series, index) => <article id={`fonte-${series.id}`} key={`${series.id}-${index}`} data-testid="series-source">
        <h3>{index + 1}. {series.label}</h3>
        <p><strong>{series.source.owner}</strong> · <a href={series.source.url}>{series.source.dataset}</a></p>
        <p>{series.points[0].period} al {series.points.at(-1)!.period} · {series.frequency === "annual" ? "Annuale" : "Mensile"} · {series.unitLabel}</p>
        <p>{series.scope}</p>
        <p>Ultimo aggiornamento della fonte: {longDate(series.source.updatedAt)}. Acquisizione: {longDate(series.source.acquiredAt)}. Data distinta di controllo: {longDate(series.source.checkedAt)}.</p>
        <details className="data-details"><summary>Query, licenza e impronta del file</summary>
          <p><a href={series.source.queryUrl}>Query ufficiale Eurostat</a> · <a href={series.source.termsUrl}>Condizioni di riuso Eurostat</a></p>
          <p>SHA-256 della risposta sorgente: <code className={styles.hash}>{series.source.sha256}</code></p>
        </details>
      </article>)}</div>
    </section>}

    <section className="panel" aria-labelledby="series-method-title">
      <h2 className="panel-title" id="series-method-title">Come leggere il confronto</h2>
      <p>Questo primo catalogo include le undici funzioni COFOG italiane (totale compreso), in milioni di euro correnti o in percentuale del PIL, e l’IPCA totale di Italia, Francia, Germania e Spagna. Gli altri dataset restano nel <Link href="/dati">catalogo dati</Link>.</p>
      <p>Stessa unità non basta: il confronto richiede anche la stessa frequenza e definizione. L’IPCA è un tasso annuo osservato ogni mese, non una variazione mensile né un livello dell’indice. Non è spesa pubblica e non viene sovrapposto a COFOG, pagamenti SIOPE o stanziamenti di bilancio.</p>
      <p>I periodi mantengono il calendario originale. Non annualizziamo i mesi, non ribasiamo gli indici, non convertiamo le valute e non interpoliamo dati. Le lacune restano visibili; il flag di interruzione spezza la linea. Un valore stimato o provvisorio resta indicato come tale.</p>
      <p>Le funzioni COFOG usano lo stesso settore S13 e la stessa contabilità SEC 2010. Il totale include le divisioni: sovrapporre le linee non autorizza a sommarle. Gli importi correnti non sono corretti per l’inflazione; la quota di PIL ha un denominatore diverso da un tasso di crescita.</p>
      <p>Andamenti simili non dimostrano un rapporto di causa ed effetto, efficienza della spesa o responsabilità politica. Per il contesto: <Link href="/spese">spesa per funzione</Link> e <Link href="/governi">pagella dei governi</Link>.</p>
    </section>
  </main>;
}
