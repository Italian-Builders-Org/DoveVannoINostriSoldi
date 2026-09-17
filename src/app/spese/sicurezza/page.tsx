import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChartDataTable } from "@/components/charts/chart-data-table";
import { CofogDetailBreakdown } from "@/components/cofog-detail-breakdown";
import { compactEuro, exactEuro, longDate, percent } from "@/lib/format";
import { getPublicOrderSpendingView, parsePublicOrderYear } from "@/lib/public-order-spending";
import styles from "./sicurezza.module.css";

export const metadata: Metadata = {
  title: "Ordine pubblico e sicurezza: spesa pubblica",
  description: "Spesa pubblica italiana per ordine pubblico e sicurezza, COFOG GF03 con sottofunzioni ufficiali: serie Eurostat 2014-2024, quote di PIL e spesa PA, fonti e limiti.",
  alternates: { canonical: "/spese/sicurezza" },
};

export default async function PublicOrderPage({ searchParams }: PageProps<"/spese/sicurezza">) {
  const year = parsePublicOrderYear((await searchParams).anno);
  if (year === null) notFound();
  const view = getPublicOrderSpendingView(year);
  const point = view.selected;
  const provenance = view.semantics.provenance;
  const scale = Math.max(10_000_000_000, Math.ceil(Math.max(...view.history.map((row) => row.amountEuro)) / 10_000_000_000) * 10_000_000_000);
  const coordinates = view.history.map((row, index) => ({
    ...row,
    x: `${14 + index / (view.history.length - 1) * 80}%`,
    y: 200 - row.amountEuro / scale * 168,
  }));
  const api = `/api/spese/cofog?paese=IT&funzione=GF03&anno=${year}`;

  return (
    <main className="shell page">
      <header className="page-intro">
        <p className="eyebrow">Italia · Eurostat COFOG GF03</p>
        <h1>Ordine pubblico e sicurezza</h1>
        <p>Quanto spendono le amministrazioni pubbliche per questa funzione? La serie Eurostat copre gli anni {view.period.from}-{view.period.to}.</p>
        <p className={styles.links}>
          <Link href={`/?anno=${year}#pa-split-title`}>Composizione della spesa italiana →</Link>
          <a href="#sicurezza-fonti">Dati e fonti ↓</a>
        </p>
      </header>

      <form action="/spese/sicurezza" className={styles.filters} aria-label="Anno della spesa per la sicurezza">
        <label htmlFor="sicurezza-year">Anno
          <select id="sicurezza-year" name="anno" defaultValue={year}>
            {view.history.toReversed().map((row) => <option key={row.year} value={row.year}>{row.year}</option>)}
          </select>
        </label>
        <button type="submit" className="btn btn-primary">Mostra dati</button>
      </form>

      <section className={`panel ${styles.summary}`} aria-labelledby="sicurezza-total-title">
        <h2 id="sicurezza-total-title" className="panel-title">Spesa pubblica per ordine pubblico e sicurezza · {year}</h2>
        <strong className={styles.total} data-testid="sicurezza-total">{compactEuro(point.amountEuro)}</strong>
        <p className={styles.exact}>{exactEuro(point.amountEuro)} esatti · euro correnti</p>
        <dl className={styles.comparisons}>
          <div><dt>Quota del PIL</dt><dd>{percent(point.gdpSharePercent)} · pubblicata da Eurostat</dd></div>
          <div><dt>Quota della spesa PA</dt><dd>{percent(point.publicSpendingSharePercent)} · calcolata sul totale Eurostat {year}</dd></div>
        </dl>
        <p>Spesa delle amministrazioni pubbliche (S13) in competenza economica SEC 2010. Non sono pagamenti di cassa né stanziamenti; il perimetro non coincide con il solo bilancio dello Stato.</p>
        {(point.flag || point.denominatorFlag) && <p className="notice">{point.flag ? `Spesa GF03: ${view.flags[point.flag]}. ` : ""}{point.denominatorFlag ? `Totale PA usato per la quota: ${view.flags[point.denominatorFlag]}.` : ""}</p>}
        <p className={styles.note}>Fonte: <a href={view.source.landingUrl}>Eurostat, {view.source.datasetCode}</a> · dato {year} · controllo del {longDate(provenance.checkedAt)}.</p>
      </section>

      <section className="panel" aria-labelledby="sicurezza-history-title">
        <h2 id="sicurezza-history-title" className="panel-title">Come cambia nel tempo</h2>
        <p>Stessa funzione GF03 e stesso perimetro nazionale. Euro correnti: la serie non è corretta per l’inflazione.</p>
        <figure className={styles.chart}>
          <svg height="244" role="img" aria-labelledby="sicurezza-chart-title sicurezza-chart-description">
            <title id="sicurezza-chart-title">{`Spesa italiana per ordine pubblico e sicurezza, ${view.period.from}-${view.period.to}`}</title>
            <desc id="sicurezza-chart-description">Serie annuale in miliardi di euro correnti. Da {compactEuro(view.history[0].amountEuro)} nel {view.period.from} a {compactEuro(view.history.at(-1)!.amountEuro)} nel {view.period.to}. Tutti i valori sono disponibili nella tabella seguente.</desc>
            {[0, scale / 2, scale].map((value) => {
              const y = 200 - value / scale * 168;
              return <g key={value}><line x1="14%" x2="94%" y1={y} y2={y} className={styles.gridLine} /><text x="12%" y={y + 4} textAnchor="end" className={styles.axisLabel}>{value / 1_000_000_000}</text></g>;
            })}
            <text x="14%" y="18" className={styles.axisLabel}>mld €</text>
            {coordinates.slice(1).map((row, index) => row.flag !== "b" && <line key={row.year} x1={coordinates[index].x} y1={coordinates[index].y} x2={row.x} y2={row.y} className={styles.seriesLine} />)}
            {coordinates.map((row, index) => <g key={row.year}><circle cx={row.x} cy={row.y} r="3" className={styles.seriesPoint} />{index % 2 === 0 && <text x={row.x} y="232" textAnchor="middle" className={styles.axisLabel}>{row.year}</text>}</g>)}
          </svg>
          <figcaption>Importi pubblicati da Eurostat; asse verticale da zero. Eventuali interruzioni della serie interrompono anche la linea.</figcaption>
        </figure>
        <ChartDataTable
          label="Spesa annuale per ordine pubblico e sicurezza in Italia"
          columns={["Spesa in euro correnti", "Quota del PIL", "Quota della spesa PA", "Note della fonte"]}
          rows={view.history.map((row) => ({
            label: String(row.year),
            values: [exactEuro(row.amountEuro), percent(row.gdpSharePercent), percent(row.publicSpendingSharePercent), [row.flag ? `GF03: ${view.flags[row.flag]}` : "", row.denominatorFlag ? `Totale PA: ${view.flags[row.denominatorFlag]}` : ""].filter(Boolean).join("; ") || "Nessun flag"],
          }))}
        />
      </section>

      <CofogDetailBreakdown
        parentCode="GF03"
        year={year}
        rows={view.detail}
        flags={view.flags}
        reconciliationNote={view.detailReconciliation.note}
        testId="sicurezza-detail"
        headingId="sicurezza-detail-title"
        title={`Polizia, vigili del fuoco, giustizia e altre voci · ${year}`}
        intro="Eurostat pubblica sei sottofunzioni per l’Italia, incluse polizia, antincendio, tribunali e carceri. Le quote usano GF03 come denominatore; non stimiamo qualità dei servizi, criminalità o efficienza dalla sola spesa."
      />

      <details className="data-details" id="sicurezza-fonti">
        <summary>Fonti, metodo e limiti</summary>
        <section className={`panel ${styles.provenance}`} aria-labelledby="sicurezza-source-title">
          <h2 id="sicurezza-source-title" className="panel-title">Fonte del numero</h2>
          <p>{view.source.owner} · <a href={view.source.landingUrl}>{view.source.datasetLabel}</a> · {view.source.datasetCode}.</p>
          <dl className={styles.metadata}>
            <div><dt>Periodo di riferimento</dt><dd>{view.semantics.periodo.referencePeriod}</dd></div>
            <div><dt>Pubblicato dalla fonte</dt><dd>{longDate(provenance.publicationDate)}</dd></div>
            <div><dt>Acquisito da noi</dt><dd>{longDate(provenance.acquisitionDate)}</dd></div>
            <div><dt>Controllato da noi</dt><dd>{longDate(provenance.checkedAt)}</dd></div>
            <div><dt>Licenza dichiarata</dt><dd><a href={view.source.termsUrl}>{provenance.license}</a></dd></div>
          </dl>
          <p>Selezione: Italia (IT), amministrazioni pubbliche (S13), spesa totale (TE), funzione GF03. Il dettaglio usa GF0301-GF0306 dello stesso dataset. La fonte pubblica milioni di euro con un decimale: gli importi esatti riportano la conversione di queste celle, non una precisione aggiuntiva.</p>
          <p>La quota della spesa PA divide GF03 per il totale ufficiale TOTAL dello stesso anno, senza ricostruirlo sommando divisioni arrotondate. La quota del PIL è quella pubblicata da Eurostat. Il nome di una missione RGS non prova l’equivalenza con una sottofunzione COFOG.</p>
          <p><a href={api}>API della selezione</a> · <Link href="/mcp">Interroga il dataset COFOG via MCP</Link></p>
          <details>
            <summary>URL dei file e impronte SHA-256</summary>
            {Object.values(view.source.assets).map((asset) => <p key={asset.unit}><a href={asset.url}>Risposta ufficiale Eurostat ({asset.unit})</a><br />SHA-256: <code>{asset.sha256}</code></p>)}
            <p>SHA-256 dello snapshot pubblicato: <code>{view.integrity.dataArtifact.sha256}</code>.</p>
          </details>
        </section>
        <section className="notice" aria-labelledby="sicurezza-budget-title">
          <h2 id="sicurezza-budget-title" className="panel-title">Un’altra lettura: il bilancio dello Stato</h2>
          <p>La missione «Ordine pubblico e sicurezza» si può consultare nella <Link href="/spese/legge-di-bilancio">Legge di Bilancio</Link>. Gli stanziamenti di competenza CP A1 autorizzano spesa statale: non sono il consuntivo SEC 2010 della funzione GF03 e non si sommano a questa serie. La somiglianza del nome non dimostra che i perimetri coincidano.</p>
        </section>
      </details>
    </main>
  );
}
