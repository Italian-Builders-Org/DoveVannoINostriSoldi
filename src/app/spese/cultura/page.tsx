import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CofogDetailBreakdown } from "@/components/cofog-detail-breakdown";
import { compactEuro, exactEuro, longDate, percent } from "@/lib/format";
import { buildCulturePublicSpendingView, parseCultureYear } from "@/lib/culture-public-spending";
import styles from "./cultura.module.css";

export const metadata: Metadata = {
  title: "Cultura e tempo libero: la spesa pubblica",
  description: "Spesa pubblica italiana per cultura, attività ricreative e culto: Eurostat COFOG GF08 con sottofunzioni ufficiali, serie 2014-2024. Stanziamenti statali e sport in perimetri distinti.",
  alternates: { canonical: "/spese/cultura" },
};

export default async function CultureSpendingPage({ searchParams }: PageProps<"/spese/cultura">) {
  const year = parseCultureYear((await searchParams).anno);
  if (year === null) notFound();
  const view = buildCulturePublicSpendingView(year);
  const { selected, history, budget, metadata: sourceMetadata } = view;
  const source = sourceMetadata.source;
  const maxAmount = Math.max(...history.map((row) => row.amountCents));
  const api = `/api/spese/cofog?paese=IT&anno=${year}&funzione=GF08`;

  return (
    <main className={`shell page ${styles.page}`}>
      <header className="page-intro">
        <p className={styles.note}>Italia · Eurostat · COFOG GF08</p>
        <h1>Cultura e tempo libero</h1>
        <p>Quanto spende la pubblica amministrazione per attività ricreative, cultura e culto.
          Il totale comprende anche lo sport: non è la sola spesa del Ministero della Cultura.</p>
      </header>

      <form action="/spese/cultura" className={styles.filters} aria-label="Anno della spesa per cultura e tempo libero">
        <label htmlFor="culture-year">Anno dei dati
          <select id="culture-year" name="anno" defaultValue={year}>
            {[...view.years].reverse().map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
        </label>
        <button type="submit" className="btn btn-primary">Mostra dati</button>
      </form>

      <section className={`panel ${styles.summary}`} aria-labelledby="culture-selected-title">
        <h2 id="culture-selected-title" className="panel-title">Spesa pubblica GF08 · {year}</h2>
        <p className={styles.total} data-testid="culture-total">{compactEuro(selected.amountCents / 100)}</p>
        <p data-testid="culture-exact">{exactEuro(selected.amountCents / 100)} esatti, nella precisione pubblicata dalla fonte.</p>
        <p><strong>{percent(selected.shareOfGdpHundredths / 100)} del PIL</strong>
          {view.shareOfPublicSpendingPercent === null ? null : <> · {percent(view.shareOfPublicSpendingPercent)} della spesa pubblica totale dello stesso anno</>}.</p>
        {selected.flag ? <p className={styles.note}>{view.flags[selected.flag]}</p> : null}
        <p>Amministrazioni pubbliche (S13), competenza economica SEC 2010, prezzi correnti.
          Non sono pagamenti di cassa né stanziamenti del bilancio dello Stato.</p>
        <p className={styles.note}>Fonte: <a href={source.landingUrl}>Eurostat, {source.datasetCode}</a> · dati {year}
          {" "}· controllati il {longDate(sourceMetadata.semantics.provenance.checkedAt)}.</p>
      </section>

      <CofogDetailBreakdown
        parentCode="GF08"
        year={year}
        rows={view.detail}
        flags={view.flags}
        reconciliationNote={view.detailReconciliation.note}
        testId="culture-detail"
        headingId="culture-detail-title"
        title={`Attività ricreative, cultura e culto · ${year}`}
        intro="Eurostat pubblica sei sottofunzioni per l’Italia. Sport e spettacolo restano dentro le voci ufficiali GF0801–GF0806: non inventiamo una categoria «spettacolo» se la fonte non la separa."
      />

      <div className={styles.columns}>
        <section className="panel" aria-labelledby="culture-history-title">
          <h2 id="culture-history-title" className="panel-title">Come cambia nel tempo</h2>
          <p>Stesso perimetro GF08, Italia. Le barre confrontano gli importi nominali; le differenze comprendono anche l&apos;effetto dei prezzi.</p>
          <div className="table-scroll" role="region" aria-label="Serie storica della spesa GF08" tabIndex={0}>
            <table className={`table ${styles.history}`} data-testid="culture-history">
              <caption>Eurostat · {view.years[0]}-{view.years.at(-1)} · euro correnti</caption>
              <thead><tr><th scope="col">Anno</th><th scope="col" className="num">Spesa</th><th scope="col" className="num">% PIL</th></tr></thead>
              <tbody>{history.map((row) => (
                <tr key={row.year} data-selected={row.year === year ? "true" : undefined}>
                  <th scope="row">{row.year}
                    {row.flag ? <small>{view.flags[row.flag]}</small> : null}
                  </th>
                  <td className="num">{exactEuro(row.amountCents / 100)}
                    <span className={styles.bar} aria-hidden="true"><i style={{ width: `${maxAmount > 0 ? row.amountCents / maxAmount * 100 : 0}%` }} /></span>
                  </td>
                  <td className="num">{percent(row.shareOfGdpHundredths / 100)}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
          <p className={styles.note}>Eventuali dati provvisori e interruzioni di serie sono indicati accanto all&apos;anno.
            I valori a cavallo di un&apos;interruzione non sono confrontabili.</p>
        </section>

        <div className={styles.context}>
          <section className="panel" aria-labelledby="culture-scope-title">
            <h2 id="culture-scope-title" className="panel-title">Che cosa comprende</h2>
            <p>GF08 è la divisione «Recreation, culture and religion»: attività ricreative, cultura e culto.
              Il nome breve in homepage, «Cultura e tempo libero», indica questo intero perimetro.</p>
            <p>Il dettaglio ufficiale distingue servizi ricreativi e sportivi, culturali, radiodiffusione ed editoria,
              servizi religiosi e comunità, R&amp;S e residuo. Non ricaviamo beneficiari, pubblico o qualità culturale dagli importi.</p>
            <p><Link href="/spese/sport">Approfondisci fondi per lo sport e grandi eventi →</Link></p>
            <p className={styles.note}>La pagina Sport raccoglie missioni, trasferimenti, rendiconti e affidamenti con perimetri propri.
              Quegli importi non sono una scomposizione contabile di GF08 e non si aggiungono a questo totale.</p>
          </section>

          <section className="panel" aria-labelledby="culture-budget-title">
            <h2 id="culture-budget-title" className="panel-title">Bilancio dello Stato · {year}</h2>
            <p>Un&apos;altra misura: stanziamenti iniziali di competenza della Legge di Bilancio (CP A1),
              missione <strong>{budget.missions[0]}</strong>.</p>
            <p className={styles.budgetAmount} data-testid="culture-budget-selected">
              {budget.selected === null ? "Non disponibile" : exactEuro(budget.selected.amountEur)}
            </p>
            {budget.selected === null ? <p className={styles.note}>La serie di questa missione copre {budget.years[0]}-{budget.years.at(-1)}:
              il {year} non è disponibile e non viene sostituito con un altro anno.</p> : null}
            <p>Questa missione non coincide con la divisione GF08: riguarda stanziamenti dello Stato,
              non la spesa di tutte le amministrazioni pubbliche. Le due misure non si sommano.</p>
            <p className={styles.note}>Fonte: <a href={budget.dataset.csvUrl}>MEF-RGS, OpenBDAP</a> · acquisita il {longDate(budget.observedAt)}.</p>
            <details className={styles.budgetDetails}>
              <summary>Stanziamenti della missione, tutti gli anni</summary>
              <div className="table-scroll" role="region" aria-label="Stanziamenti statali della missione cultura" tabIndex={0}>
                <table className="table" data-testid="culture-budget-history">
                  <caption>Legge di Bilancio · stanziamenti CP A1 · euro</caption>
                  <thead><tr><th scope="col">Anno</th><th scope="col" className="num">Stanziamento</th></tr></thead>
                  <tbody>{budget.allocations.map((row) => <tr key={row.year}><th scope="row">{row.year}</th><td className="num">{exactEuro(row.amountEur)}</td></tr>)}</tbody>
                </table>
              </div>
              <p><Link href="/spese/legge-di-bilancio">Esplora la Legge di Bilancio →</Link></p>
            </details>
          </section>
        </div>
      </div>

      <details className="data-details" data-testid="culture-sources">
        <summary>Fonti, metodo e limiti</summary>
        <section className={`panel ${styles.sources}`} aria-labelledby="culture-source-title">
          <h2 id="culture-source-title" className="panel-title">Eurostat COFOG</h2>
          <p>{sourceMetadata.semantics.soldi.nature}. Serie {sourceMetadata.semantics.periodo.referencePeriod},
            fonte originaria in milioni di euro con un decimale, convertita in centesimi senza stime.</p>
          <p>Pubblicazione: {longDate(sourceMetadata.semantics.provenance.publicationDate)}.
            Acquisizione: {longDate(sourceMetadata.semantics.provenance.acquisitionDate)}.
            Controllo: {longDate(sourceMetadata.semantics.provenance.checkedAt)}. Licenza {source.licenseId}.</p>
          <p>La quota di spesa pubblica usa il totale S13 pubblicato per l&apos;Italia nello stesso anno:
            {" "}{exactEuro(view.totalPublicSpendingCents / 100)}. Non usa gli stanziamenti dello Stato come denominatore.</p>
          <ul>{view.caveats.map((note) => <li key={note}>{note}</li>)}</ul>
          <p><a href={source.landingUrl}>Tabella ufficiale Eurostat</a> · <a href={api}>Dati della selezione in JSON</a></p>
          <p className={styles.note}>SHA-256 dello snapshot: <code>{sourceMetadata.integrity.dataArtifact.sha256}</code>.</p>
          <h3 className="panel-title">Stanziamenti italiani</h3>
          <p>{budget.dataset.title}. Misura CP A1, somma delle amministrazioni e dei macroaggregati della sola missione selezionata.
            Non è un rendiconto di pagamenti né il finanziamento complessivo dello spettacolo.
            Licenza: <a href={budget.dataset.licenseUrl}>{budget.dataset.license}</a>.</p>
        </section>
      </details>
    </main>
  );
}
