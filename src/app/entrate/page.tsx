import type { Metadata } from "next";
import Link from "next/link";
import { compactEuro, exactEuro, integer } from "@/lib/format";
import { availableSiopeReceiptsYears, querySiopeMunicipalReceipts } from "@/lib/siope-receipts";
import { ReceiptsSources } from "./receipts-sources";
import { receiptsPageFilters, receiptsPageHref, receiptsPeriodLabel } from "./receipts-view";
import styles from "./entrate.module.css";

export const metadata: Metadata = {
  title: "Incassi comunali",
  description: "Incassi di cassa SIOPE dei Comuni nel 2024, 2025 e 2026: totali nazionali e regionali, ricerca comunale, periodi e fonti verificabili. Il periodo più recente può essere parziale.",
  alternates: { canonical: "/entrate" },
};

export default async function ReceiptsPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  let result: ReturnType<typeof querySiopeMunicipalReceipts>;
  try {
    result = querySiopeMunicipalReceipts(receiptsPageFilters(params));
  } catch (error) {
    return (
      <main className="shell page">
        <div className="page-intro"><h1>Quanto incassano i Comuni</h1></div>
        <section className="notice" role="alert" aria-labelledby="receipts-error-title">
          <h2 id="receipts-error-title">Impossibile mostrare questa selezione</h2>
          <p>{error instanceof Error ? error.message : "Controlla anno, Regione e nome del Comune."}</p>
          <p><Link href="/entrate">Torna ai filtri degli incassi comunali</Link></p>
        </section>
      </main>
    );
  }
  const { national: data, period, filters, selection, pagination } = result;
  const regions = [...data.regions].sort((left, right) => left.region.localeCompare(right.region, "it-IT"));
  const currentPage = pagination.offset / pagination.limit + 1;
  const totalPages = Math.max(1, Math.ceil(pagination.total / pagination.limit));
  const pageHref = (page: number) => receiptsPageHref({ year: data.year, ...filters, page });

  return (
    <main className="shell page">
      <div className="page-intro">
        <h1>Quanto incassano i Comuni</h1>
        <p>Le entrate di cassa registrate da SIOPE: da dove arrivano i soldi incassati dai Comuni italiani.</p>
      </div>

      <section className="panel" aria-labelledby="receipts-filters-title">
        <div className={styles.heading}>
          <h2 className="panel-title" id="receipts-filters-title">Scegli anno e Comuni</h2>
          <span className={period.completeness === "partial" ? styles.partial : styles.complete}>
            {receiptsPeriodLabel(period)}
          </span>
        </div>
        <form action="/entrate" method="get" className={styles.filters}>
          <label htmlFor="receipts-year">Anno
            <select id="receipts-year" name="anno" defaultValue={data.year}>
              {availableSiopeReceiptsYears.map((year) => <option key={year} value={year}>{year}</option>)}
            </select>
          </label>
          <label htmlFor="receipts-region">Regione
            <select id="receipts-region" name="regione" defaultValue={filters.region ?? ""}>
              <option value="">Tutte le Regioni</option>
              {regions.map((row) => <option key={row.region} value={row.region}>{row.region}</option>)}
            </select>
          </label>
          <label htmlFor="receipts-name">Nome del Comune
            <input id="receipts-name" name="q" type="search" maxLength={120} defaultValue={filters.query ?? ""} placeholder="Es. Bologna" />
          </label>
          {filters.code ? <input type="hidden" name="codice" value={filters.code} /> : null}
          <button className="btn btn-primary" type="submit">Mostra incassi</button>
        </form>
        <p className={styles.note}>
          Regione e nome filtrano solo il dettaglio comunale. Gli aggregati nazionali e regionali restano il contesto dell’anno scelto.{" "}
          <a href="#comuni-incassi">Vai ai Comuni selezionati</a>.{" "}
          {filters.region || filters.query || filters.code ? <Link href={receiptsPageHref({ year: data.year })}>Azzera i filtri</Link> : null}
        </p>
        {filters.code ? <p className={styles.note}>Codice selezionato: {filters.code}.</p> : null}
      </section>

      <section className="notice scope-notice" aria-labelledby="receipts-scope-title">
        <h2 id="receipts-scope-title">Incassi, non entrate di competenza</h2>
        <p>
          Qui vedi soldi entrati nei conti dei Comuni, non accertamenti né entrate di competenza.
          I totali includono trasferimenti fra enti, prestiti e partite di giro: non misurano la pressione fiscale né entrate consolidate della PA.
        </p>
        {period.completeness === "partial" ? <p><strong>{receiptsPeriodLabel(period)}.</strong> Il mese finale può essere ancora incompleto. Non confrontare questo importo con un intero anno e non ricavarne una crescita annuale.</p> : null}
        <p>I <Link href={`/spese?anno=${data.year}`}>pagamenti comunali</Link> restano un flusso distinto. Nessun saldo, residuo fiscale o classifica di efficienza o spreco.</p>
      </section>

      <section aria-labelledby="receipts-national-title">
        <h2 className="panel-title" id="receipts-national-title">Quadro nazionale · {data.year}</h2>
        <div className="stat-strip">
          <div><span className="stat-label">Totale incassato in Italia</span><span className="stat-value">{compactEuro(data.totalCollected)}</span><span className="stat-note">{exactEuro(data.totalCollected)} esatti</span></div>
          <div><span className="stat-label">Per abitante coperto</span><span className="stat-value">{data.nationalPerCapita === null ? "Non disponibile" : exactEuro(data.nationalPerCapita)}</span><span className="stat-note">Popolazione SIOPE, riferimento temporale non dichiarato</span></div>
          <div><span className="stat-label">Comuni con movimenti</span><span className="stat-value">{integer(data.coverage.withMovements)}</span><span className="stat-note">su {integer(data.coverage.activeSiopeMunicipalities)} Comuni nell’anagrafica</span></div>
          <div><span className="stat-label">Periodo osservato</span><span className="stat-value">Gennaio-{data.latestMonthLabel.toLocaleLowerCase("it-IT")}</span><span className="stat-note">{period.completeness === "partial" ? "Dati parziali" : "Anno completo"} · {data.year}</span></div>
        </div>
        <p className={styles.note}>
          Contesto nazionale, anche con filtri attivi. Il valore per abitante usa {exactEuro(data.receiptsWithPopulation)} di incassi
          su {integer(data.populationCovered)} abitanti, nei {integer(data.coverage.withPopulation)} Comuni con popolazione disponibile.
          Assenza di movimenti non significa zero incassi.
        </p>
      </section>

      <div className={styles.split}>
        <section className="panel" aria-labelledby="receipts-titles-title">
          <h2 className="panel-title" id="receipts-titles-title">Da dove arrivano gli incassi</h2>
          <div className={`table-scroll ${styles.tableRegion}`} role="region" aria-label="Incassi nazionali per titolo" tabIndex={0}>
            <table className="table">
              <caption>Totali nazionali per titolo SIOPE · {receiptsPeriodLabel(period)}</caption>
              <thead><tr><th scope="col">Titolo di entrata</th><th scope="col" className="num">Incassato</th></tr></thead>
              <tbody>{data.titles.map((title) => <tr key={title.code}><th scope="row">{title.code} · {title.label}</th><td className="num">{exactEuro(title.value)}</td></tr>)}</tbody>
            </table>
          </div>
          <details className={styles.breakdown}>
            <summary>Incassi mese per mese</summary>
            <div className={`table-scroll ${styles.tableRegion}`} role="region" aria-label="Incassi nazionali mensili" tabIndex={0}>
              <table className="table">
                <thead><tr><th scope="col">Mese {data.year}</th><th scope="col" className="num">Incassi del mese</th><th scope="col" className="num">Da gennaio</th></tr></thead>
                <tbody>{data.monthly.map((month) => <tr key={month.month}><th scope="row">{month.label}{period.completeness === "partial" && month.month === period.endMonth ? " · parziale" : ""}</th><td className="num">{exactEuro(month.flow)}</td><td className="num">{exactEuro(month.cumulative)}</td></tr>)}</tbody>
              </table>
            </div>
          </details>
        </section>

        <section className="panel" aria-labelledby="receipts-regions-title">
          <h2 className="panel-title" id="receipts-regions-title">Incassi dei Comuni per Regione</h2>
          <p className={styles.note}>Aggregati per sede IPA del Comune, non per luogo di riscossione. Ordine alfabetico; seleziona una Regione per vederne i Comuni.</p>
          <div className={`table-scroll ${styles.tableRegion}`} role="region" aria-label="Incassi comunali aggregati per Regione" tabIndex={0}>
            <table className="table">
              <caption>{receiptsPeriodLabel(period)} · valori in euro</caption>
              <thead><tr><th scope="col">Regione</th><th scope="col" className="num">Incassato</th><th scope="col" className="num">Per abitante</th></tr></thead>
              <tbody>{regions.map((row) => <tr key={row.region}>
                <th scope="row"><Link href={`${receiptsPageHref({ year: data.year, region: row.region })}#comuni-incassi`}>{row.region}</Link></th>
                <td className="num">{exactEuro(row.value)}</td><td className="num">{row.perCapita === null ? "Non disponibile" : exactEuro(row.perCapita)}</td>
              </tr>)}</tbody>
            </table>
          </div>
          <p className={styles.note}>Senza Regione: {integer(data.coverage.withoutRegion)} Comuni con movimenti, {exactEuro(data.coverage.receiptsWithoutRegion)} di incassi inclusi solo nel totale nazionale. I valori per abitante escludono i Comuni senza popolazione SIOPE disponibile.</p>
        </section>
      </div>

      <section className={`panel ${styles.anchorTarget}`} aria-labelledby="receipts-municipalities-title" id="comuni-incassi">
        <h2 className="panel-title" id="receipts-municipalities-title">Dettaglio comunale · {data.year}</h2>
        <p className={styles.note}>
          {filters.region ?? "Tutte le Regioni"}{filters.query ? ` · nome contenente “${filters.query}”` : ""}.
          {" "}{integer(selection.municipalities)} Comuni selezionati, {integer(selection.withMovements)} con movimenti.
          {" "}Incassi dell’intera selezione: <strong>{selection.totalCents === null ? "Nessun movimento osservato" : exactEuro(selection.totalCents / 100)}</strong>, non solo della pagina.
        </p>
        {result.municipalities.length ? (
          <div className={`table-scroll ${styles.tableRegion}`} role="region" aria-label="Dettaglio degli incassi comunali" tabIndex={0}>
            <table className="table">
              <caption>{receiptsPeriodLabel(period)} · nessun movimento osservato non equivale a zero</caption>
              <thead><tr><th scope="col">Comune</th><th scope="col">Regione</th><th scope="col" className="num">Incassato</th><th scope="col" className="num">Per abitante</th><th scope="col" className="num">Per km²</th></tr></thead>
              <tbody>{result.municipalities.map((row) => <tr key={row.taxCode}>
                <th scope="row">{row.codiceIpa ? <Link href={`/enti/${encodeURIComponent(row.codiceIpa)}#dati-incassi`}>{row.name}</Link> : row.name}{" "}({row.province})</th>
                <td>{row.region ?? "Non disponibile"}</td>
                <td className="num">{row.totalCents === null ? "Nessun movimento osservato" : exactEuro(row.totalCents / 100)}</td>
                <td className="num">{row.perCapitaCents === null ? "Non disponibile" : exactEuro(row.perCapitaCents / 100)}</td>
                <td className="num">{row.perSquareKmCents === null ? "Non disponibile" : exactEuro(row.perSquareKmCents / 100)}</td>
              </tr>)}</tbody>
            </table>
          </div>
        ) : <p>{pagination.total === 0 ? "Nessun Comune corrisponde ai filtri scelti." : "Questa pagina non contiene Comuni."} <Link href={pageHref(1)}>Torna alla prima pagina della selezione</Link> oppure <Link href={receiptsPageHref({ year: data.year })}>azzera i filtri</Link>.</p>}
        <nav className={styles.pagination} aria-label="Pagine degli incassi comunali">
          {/* Native navigation reapplies the anchor when only query parameters change. */}
          {currentPage > 1 ? <a href={`${pageHref(currentPage - 1)}#comuni-incassi`} rel="prev">← Pagina precedente</a> : <span />}
          <span>Pagina {integer(currentPage)} di {integer(totalPages)} · {integer(pagination.returned)} Comuni mostrati</span>
          {pagination.offset + pagination.returned < pagination.total ? <a href={`${pageHref(currentPage + 1)}#comuni-incassi`} rel="next">Pagina successiva →</a> : <span />}
        </nav>
        <p className={styles.note}>Per abitante: popolazione dell’anagrafica SIOPE, senza anno di riferimento dichiarato. Per km²: superficie ISTAT abbinata al Comune. La scheda è collegata solo quando è disponibile un identificativo IPA.</p>
      </section>

      <section className="panel" aria-labelledby="receipts-sources-title">
        <h2 className="panel-title" id="receipts-sources-title">Fonti e metodo</h2>
        <ReceiptsSources data={data} />
      </section>
    </main>
  );
}
