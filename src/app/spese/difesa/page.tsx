import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CofogDetailBreakdown } from "@/components/cofog-detail-breakdown";
import { CofogSpendingHistory } from "@/components/charts/cofog-spending-history";
import { compactEuro, exactEuro, longDate, percent } from "@/lib/format";
import { getDefencePublicSpendingView, parseDefenceYear } from "@/lib/defence-public-spending";
import styles from "./difesa.module.css";

export const metadata: Metadata = {
  title: "Spesa pubblica per la difesa",
  description: "Difesa in Italia: spesa PA Eurostat COFOG GF02 con sottofunzioni ufficiali e stanziamenti della missione di bilancio, con anni, fonti e perimetri distinti.",
  alternates: { canonical: "/spese/difesa" },
};

export default async function DefenceSpendingPage({ searchParams }: PageProps<"/spese/difesa">) {
  const year = parseDefenceYear((await searchParams).anno);
  if (year === null) notFound();
  const view = getDefencePublicSpendingView(year);
  const { selected, latestCofog, latestBudget, comparison } = view;
  const eurostatApi = `/api/spese/cofog?paese=IT&funzione=GF02&anno=${year}`;

  return (
    <main className={`shell page ${styles.page}`}>
      <header className="page-intro">
        <p className="eyebrow">Italia · Spesa pubblica</p>
        <h1>Quanto spendiamo per la difesa</h1>
        <p>La spesa delle amministrazioni pubbliche per la funzione Difesa (COFOG GF02),
          secondo i conti di competenza economica SEC 2010. Gli stanziamenti dello Stato
          sono una lettura distinta: autorizzano spesa e non sono pagamenti effettuati.</p>
        <p className={styles.links}>
          <Link href={`/?anno=${year}#pa-split-title`}>Quadro della spesa italiana →</Link>
          <Link href="/spese/legge-di-bilancio">Missioni di bilancio →</Link>
          <a href="#fonti-difesa">Fonti e perimetro ↓</a>
        </p>
      </header>

      <form action="/spese/difesa" className={styles.filters} aria-label="Anno della spesa per la difesa">
        <label htmlFor="defence-year">Anno
          <select id="defence-year" name="anno" defaultValue={year}>
            {view.history.toReversed().map((point) => <option key={point.year} value={point.year}>{point.year}</option>)}
          </select>
        </label>
        <button type="submit" className="btn btn-primary">Mostra dati</button>
      </form>

      <section className={`panel ${styles.summary}`} aria-labelledby="defence-total-title">
        <h2 className="panel-title" id="defence-total-title">Spesa PA per la difesa · {selected.year}</h2>
        <p className={styles.total} data-testid="defence-total">{compactEuro(selected.amountCents / 100)}</p>
        <p>{exactEuro(selected.amountCents / 100)} esatti nel dato pubblicato · {percent(selected.shareOfGdpHundredths / 100, 2)} del PIL.</p>
        <p>Italia · tutte le amministrazioni pubbliche (S13) · competenza economica SEC 2010.
          {selected.flag ? ` ${view.flags[selected.flag]}` : ""}</p>
        <p className={styles.note}><a href={view.cofog.source.landingUrl}>Eurostat · {view.cofog.source.datasetCode}</a>.
          {" "}Ultimo anno nello snapshot: {view.cofog.period.to}. Importi a prezzi correnti,
          pubblicati dalla fonte in milioni con un decimale. Questo non è il dato NATO.</p>
      </section>

      <CofogDetailBreakdown
        parentCode="GF02"
        year={year}
        rows={view.detail}
        flags={view.flags}
        reconciliationNote={view.detailReconciliation.note}
        testId="defence-detail"
        headingId="defence-detail-title"
        title={`Che cosa c’è dentro GF02 · ${year}`}
        intro="Eurostat pubblica cinque sottofunzioni per l’Italia. Le barre mostrano la quota sul totale GF02; i valori esatti restano nella tabella. Zero osservato e dato mancante restano distinti."
      />

      <section className="panel" aria-labelledby="defence-comparison-title">
        <h2 id="defence-comparison-title" className="panel-title">Due conti diversi · stesso anno {comparison.year}</h2>
        <p>La funzione COFOG riguarda l’intera PA; la missione «{view.missionLabel}» riguarda
          gli stanziamenti del bilancio dello Stato. Perimetro e natura contabile differiscono:
          non sommare gli importi e non leggere il rapporto come percentuale di spesa realizzata.</p>
        <dl className={`stat-strip ${styles.comparison}`} data-testid="defence-comparison">
          <div><dt>Spesa PA · COFOG GF02 · {comparison.year}</dt>
            <dd>{compactEuro(comparison.cofog.amountCents / 100)}</dd>
            <span className="stat-note">Eurostat · competenza economica SEC 2010</span></div>
          <div><dt>Stanziamento Stato · {comparison.year}</dt>
            <dd>{comparison.budget ? compactEuro(comparison.budget.amountEur) : "Non disponibile"}</dd>
            <span className="stat-note">{comparison.budget ? "RGS / OpenBDAP · missione Difesa · CP A1" : `Lo snapshot della missione parte dal ${view.budget.semantics.periodo.from}`}</span></div>
        </dl>
        <p className={styles.latestBudget} data-testid="defence-latest-budget">Ultima Legge di Bilancio disponibile:
          {" "}<strong>{latestBudget.year} · {compactEuro(latestBudget.amountEur)}</strong>
          {" "}({exactEuro(latestBudget.amountEur)}), per la stessa missione.
          {latestBudget.year > latestCofog.year ? ` Non è un aggiornamento del dato COFOG ${latestCofog.year}.` : ""}</p>
        <p className={styles.note}><a href={view.budget.dataset.apiUrl}>Fonte RGS / OpenBDAP</a> ·
          acquisita il {longDate(view.budget.semantics.provenance.acquisitionDate)}.</p>
      </section>

      <section className="panel" aria-labelledby="defence-history-title">
        <h2 id="defence-history-title" className="panel-title">Spesa PA nel tempo · {view.cofog.period.from}-{view.cofog.period.to}</h2>
        <CofogSpendingHistory history={view.history} flags={view.flags} id="defence-chart"
          title="Spesa PA italiana per la difesa, Eurostat COFOG GF02"
          listLabel="Spesa PA per la difesa per anno" functionCode="GF02" />

        <details className="chart-data" data-testid="defence-annual">
          <summary>Valori annuali e confronto con gli stanziamenti</summary>
          <p>Fonti: Eurostat e RGS / OpenBDAP. Ogni colonna mantiene la propria natura contabile.
            «Non disponibile» indica un anno fuori dallo snapshot di quella fonte.</p>
          <div className="table-scroll" role="region" aria-label="Difesa: valori annuali delle due fonti" tabIndex={0}>
            <table className="table">
              <caption className="table-caption">Difesa · importi in euro correnti, senza somma fra le fonti</caption>
              <thead><tr><th scope="col">Anno</th><th scope="col" className="num">Spesa PA · GF02</th><th scope="col" className="num">Quota PIL · GF02</th><th scope="col" className="num">Stanziamento Stato · CP A1</th><th scope="col">Flag Eurostat</th></tr></thead>
              <tbody>{view.annual.map((row) => <tr key={row.year}>
                <th scope="row">{row.year}</th>
                <td className="num">{row.cofog ? exactEuro(row.cofog.amountCents / 100) : "Non disponibile"}</td>
                <td className="num">{row.cofog ? percent(row.cofog.shareOfGdpHundredths / 100, 2) : "Non disponibile"}</td>
                <td className="num">{row.budget ? exactEuro(row.budget.amountEur) : "Non disponibile"}</td>
                <td>{row.cofog ? (row.cofog.flag ? view.flags[row.cofog.flag] : "Nessuno") : "Non disponibile"}</td>
              </tr>)}</tbody>
            </table>
          </div>
        </details>
      </section>

      <details className="data-details" id="fonti-difesa">
        <summary>Fonti, periodo e limiti della difesa</summary>
        <section className="panel" aria-labelledby="defence-scope-title">
          <h2 id="defence-scope-title" className="panel-title">COFOG, NATO e missioni estere</h2>
          <p>GF02 comprende difesa militare e civile, aiuti militari all’estero, ricerca e sviluppo
            per la difesa e altre spese della funzione. Le pensioni sono nella protezione sociale (GF10);
            ordine pubblico e sicurezza sono una funzione distinta (GF03).</p>
          <p>La misura NATO segue criteri propri: può includere alcune spese classificate altrove
            in COFOG e differire per pensioni, contributi e momento della registrazione.
            Il valore qui mostrato non verifica il raggiungimento degli obiettivi NATO.</p>
          <p><a href="https://ec.europa.eu/eurostat/statistics-explained/index.php?title=Government_expenditure_on_defence">Definizioni e confronto metodologico Eurostat</a>.</p>
          <p>Il dettaglio GF0201-GF0205 riconcilia con GF02 entro la sola tolleranza di arrotondamento.
            Non permette di isolare il costo delle singole missioni estere né di leggere obiettivi NATO.
            La missione di bilancio non equivale all’intero bilancio del Ministero della Difesa.
            Non ricostruiamo un totale aggiungendo stanziamenti, aiuti e pagamenti.</p>
        </section>

        <div className={styles.sources}>
          <section className="panel" aria-labelledby="defence-eurostat-title">
            <h2 id="defence-eurostat-title" className="panel-title">Eurostat · COFOG</h2>
            <p>{view.cofog.semantics.soldi.nature}.</p>
            <dl className={styles.provenance}>
              <div><dt>Periodo del dato</dt><dd>{view.cofog.semantics.periodo.referencePeriod}</dd></div>
              <div><dt>Pubblicazione della fonte</dt><dd>{longDate(view.cofog.semantics.provenance.publicationDate)}</dd></div>
              <div><dt>Acquisizione</dt><dd>{longDate(view.cofog.semantics.provenance.acquisitionDate)}</dd></div>
              <div><dt>Verifica dello snapshot</dt><dd>{longDate(view.cofog.semantics.provenance.checkedAt)}</dd></div>
              <div><dt>Licenza</dt><dd>{view.cofog.semantics.provenance.license}</dd></div>
              <div><dt>SHA-256 snapshot</dt><dd><code>{view.cofog.integrity.dataArtifact.sha256}</code></dd></div>
            </dl>
            <p><a href={view.cofog.source.landingUrl}>Tabella ufficiale Eurostat</a> · <a href={eurostatApi}>API COFOG GF02</a></p>
          </section>
          <section className="panel" aria-labelledby="defence-rgs-title">
            <h2 id="defence-rgs-title" className="panel-title">RGS · Legge di Bilancio</h2>
            <p>{view.budget.semantics.soldi.nature}, missione «{view.missionLabel}».
              Somma delle voci della stessa missione fra amministrazioni, programmi e macroaggregati.</p>
            <dl className={styles.provenance}>
              <div><dt>Periodo del dato</dt><dd>{view.budget.semantics.periodo.from}-{view.budget.semantics.periodo.to}</dd></div>
              <div><dt>Pubblicazione della fonte</dt><dd>Non dichiarata nello snapshot</dd></div>
              <div><dt>Metadati del catalogo aggiornati</dt><dd>{longDate(view.budget.semantics.provenance.metadataModified)}</dd></div>
              <div><dt>Acquisizione</dt><dd>{longDate(view.budget.semantics.provenance.acquisitionDate)}</dd></div>
              <div><dt>Data di verifica distinta</dt><dd>Non dichiarata nello snapshot</dd></div>
              <div><dt>Licenza</dt><dd>{view.budget.semantics.provenance.license}</dd></div>
              <div><dt>SHA-256 CSV</dt><dd><code>{view.budget.semantics.provenance.sha256}</code></dd></div>
            </dl>
            <p><a href={view.budget.dataset.apiUrl}>Catalogo ufficiale RGS</a> · <a href={view.budget.dataset.csvUrl}>CSV della fonte</a></p>
          </section>
        </div>
      </details>
    </main>
  );
}
