import Link from "next/link";
import { compactEuro, exactEuro, longDate, percent } from "@/lib/format";
import { getHealthPublicSpendingView } from "@/lib/health-public-spending";
import { CofogSpendingHistory } from "@/components/charts/cofog-spending-history";
import styles from "./sanita.module.css";

export function HealthPublicOverview({ year }: { year: number }) {
  const { history, selected, flags, metadata } = getHealthPublicSpendingView(year);
  const provenance = metadata.semantics.provenance;
  return (
    <>
      <form action="/spese/sanita" className={styles.filters} aria-label="Anno della spesa PA per la sanità">
        <label htmlFor="health-year">Anno della spesa PA
          <select id="health-year" name="anno" defaultValue={year}>
            {history.toReversed().map((point) => <option key={point.year} value={point.year}>{point.year}</option>)}
          </select>
        </label>
        <button type="submit" className="btn btn-primary">Mostra dati</button>
      </form>

      <section className="panel" aria-labelledby="health-total-title">
        <h2 className="panel-title" id="health-total-title">Spesa PA per la sanità · {selected.year}</h2>
        <p className={styles.total} data-testid="health-total">{compactEuro(selected.amountCents / 100)}</p>
        <p>{exactEuro(selected.amountCents / 100)} esatti nel dato pubblicato · {percent(selected.shareOfGdpHundredths / 100, 2)} del PIL.</p>
        <p>Italia · tutte le amministrazioni pubbliche (S13) · competenza economica SEC 2010.
          {selected.flag ? ` ${flags[selected.flag]}` : ""}</p>
        <p className={styles.note}><a href={metadata.source.landingUrl}>Eurostat · {metadata.source.datasetCode}</a> · COFOG GF07.
          {" "}Ultimo anno nello snapshot: {metadata.period.to}. Pubblicazione: {longDate(provenance.publicationDate)};
          {" "}verifica dello snapshot: {longDate(provenance.checkedAt)}. Importi a prezzi correnti, pubblicati in milioni con un decimale.</p>
      </section>

      <section className="panel" aria-labelledby="health-history-title">
        <h2 className="panel-title" id="health-history-title">Spesa PA nel tempo · {metadata.period.from}-{metadata.period.to}</h2>
        <p>La stessa fonte e lo stesso criterio della pagina <Link href={`/spese/difesa?anno=${year}`}>Difesa · {year}</Link>:
          {" "}qui la funzione è Sanità (GF07). L’andamento è nominale e non misura da solo qualità o quantità dei servizi.</p>
        <CofogSpendingHistory history={history} flags={flags} id="health-chart"
          title="Spesa PA italiana per la sanità, Eurostat COFOG GF07"
          listLabel="Spesa PA per la sanità per anno" functionCode="GF07" />
        <details className="chart-data" data-testid="health-annual">
          <summary>Valori annuali della spesa PA per la sanità</summary>
          <div className="table-scroll" role="region" aria-label="Sanità: valori annuali Eurostat COFOG GF07" tabIndex={0}>
            <table className="table">
              <caption className="table-caption">Italia · COFOG GF07 · euro correnti, competenza economica SEC 2010</caption>
              <thead><tr><th scope="col">Anno</th><th scope="col" className="num">Spesa PA · GF07</th><th scope="col" className="num">Quota PIL</th><th scope="col">Flag Eurostat</th></tr></thead>
              <tbody>{history.map((point) => <tr key={point.year}>
                <th scope="row">{point.year}</th>
                <td className="num">{exactEuro(point.amountCents / 100)}</td>
                <td className="num">{percent(point.shareOfGdpHundredths / 100, 2)}</td>
                <td>{point.flag ? flags[point.flag] : "Nessuno"}</td>
              </tr>)}</tbody>
            </table>
          </div>
        </details>
        <details className="data-details" id="fonti-sanita-pa">
          <summary>Fonte e perimetro della serie PA</summary>
          <p>La funzione COFOG Sanità riguarda l’intera PA secondo Eurostat. Il Conto Economico degli enti SSN
            riportato sotto ha un perimetro diverso: i due importi non vanno sommati o trattati come la stessa serie.
            I pagamenti di cassa SIOPE sono una terza lettura distinta.</p>
          <p>{metadata.semantics.soldi.nature}. Serie {metadata.period.from}-{metadata.period.to}; nessuna correzione per l’inflazione.</p>
          <p>Fonte: {metadata.source.owner} · licenza {provenance.license} · acquisizione {longDate(provenance.acquisitionDate)}.</p>
          <p><a href={`/api/spese/cofog?paese=IT&funzione=GF07&anno=${year}`}>Dati JSON della sanità PA · {year}</a>
            {" · "}<a href="/api/spese/cofog?paese=IT&funzione=GF07">Serie completa COFOG GF07</a>
            {" · "}<a href={metadata.source.landingUrl}>Tabella ufficiale Eurostat</a></p>
          <code className={styles.hash}>SHA-256 snapshot: {metadata.integrity.dataArtifact.sha256}</code>
        </details>
      </section>
    </>
  );
}
