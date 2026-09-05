import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { compactEuro, longDate } from "@/lib/format";
import { istatEpeaData, istatEpeaMetadata } from "@/lib/istat-epea-snapshot";
import { buildEpeaView, EPEA_SECTORS, EPEA_YEARS, parseEpeaSelection } from "@/lib/istat-epea-view";
import styles from "./ambiente.module.css";

export const metadata: Metadata = {
  title: "Spesa per la protezione dell’ambiente",
  description: "Conti ISTAT EPEA 2016-2022: spesa nazionale per settore e classe ambientale, edizione 2025M2, con serie storica e fonti.",
  alternates: { canonical: "/spese/ambiente" },
};

const millions = new Intl.NumberFormat("it-IT", { minimumFractionDigits: 1, maximumFractionDigits: 1, useGrouping: "always" });
function amount(cents: number | null) {
  return cents === null ? "Dato non disponibile" : `${millions.format(cents / 100_000_000)} mln €`;
}

export default async function EnvironmentPage({ searchParams }: PageProps<"/spese/ambiente">) {
  const selection = parseEpeaSelection(await searchParams);
  if (!selection) notFound();
  const view = buildEpeaView(istatEpeaData.rows, selection.year, selection.sector);
  const sectorLabel = EPEA_SECTORS.find((item) => item.code === view.sector)!.label;
  const maxClass = Math.max(0, ...view.classes.map((item) => item.amountCents ?? 0));
  const source = istatEpeaMetadata.source;
  const api = `/api/spese/istat-epea?anno=${view.year}&settore=${view.sector}`;

  return (
    <main className="shell page">
      <header className="page-intro">
        <p className={styles.eyebrow}>ISTAT · Conti ambientali · Italia</p>
        <h1>Quanto spendiamo per proteggere l’ambiente</h1>
        <p>La spesa per prevenire e ridurre l’inquinamento e il degrado ambientale. Conti nazionali EPEA, anni 2016-2022, edizione 2025M2.</p>
      </header>

      <form action="/spese/ambiente" className={styles.filters} aria-label="Filtri della spesa ambientale">
        <label htmlFor="epea-sector">Settore istituzionale
          <select id="epea-sector" name="settore" defaultValue={view.sector}>
            {EPEA_SECTORS.map((item) => <option key={item.code} value={item.code}>{item.label}</option>)}
          </select>
        </label>
        <label htmlFor="epea-year">Anno
          <select id="epea-year" name="anno" defaultValue={view.year}>
            {[...EPEA_YEARS].reverse().map((year) => <option key={year} value={year}>{year}</option>)}
          </select>
        </label>
        <button type="submit" className="btn btn-primary">Mostra dati</button>
      </form>

      <section className={`panel ${styles.summary}`} aria-labelledby="selected-title">
        <h2 id="selected-title">{sectorLabel} · {view.year}</h2>
        <p className={styles.total} data-testid="epea-total">
          {view.totalCents === null ? "Dato non disponibile" : compactEuro(view.totalCents / 100)}
        </p>
        <p>{amount(view.totalCents)} · totale nazionale pubblicato da ISTAT, prezzi correnti.</p>
        <p>Il settore delle amministrazioni pubbliche comprende anche le istituzioni sociali private senza scopo di lucro al servizio delle famiglie (S13_15). Il totale dell’economia (S1) include inoltre famiglie e società: non rappresenta la sola spesa pubblica.</p>
      </section>

      <div className="notice">
        <strong>Conti di competenza, non pagamenti di cassa</strong>
        <p>Questi importi non si sommano ai pagamenti SIOPE, agli stanziamenti RGS, al PNRR o ai sussidi SAD/SAF. Non misurano da soli efficacia delle politiche climatiche, spreco o qualità ambientale. La fonte qui esposta è nazionale: non attribuiamo quote a Comuni o regioni.</p>
      </div>

      <div className={styles.columns}>
        <section className="panel" aria-labelledby="classes-title">
          <h2 id="classes-title" className="panel-title">Per attività ambientale · {view.year}</h2>
          <p>{sectorLabel}. Milioni di euro correnti.</p>
          <table className={styles.table} data-testid="epea-classes">
            <caption>Spesa per classe CEPA · {view.year}</caption>
            <thead><tr><th scope="col">Attività</th><th scope="col">Spesa</th></tr></thead>
            <tbody>{view.classes.map((item) => (
              <tr key={item.code}>
                <th scope="row">{item.label}<span className={styles.code}>{item.code}</span>
                  <span className={styles.bar} aria-hidden="true"><i style={{ width: `${maxClass > 0 ? (item.amountCents ?? 0) / maxClass * 100 : 0}%` }} /></span>
                </th>
                <td>{amount(item.amountCents)}</td>
              </tr>
            ))}</tbody>
          </table>
          <p className={styles.note}>Il totale è quello pubblicato dalla fonte, non la somma delle righe arrotondate. Le barre confrontano gli importi tra attività dello stesso settore e anno.</p>
        </section>

        <section className="panel" aria-labelledby="history-title">
          <h2 id="history-title" className="panel-title">Come cambia nel tempo</h2>
          <p>{sectorLabel}. Stessa edizione 2025M2 per tutti gli anni.</p>
          <table className={styles.table} data-testid="epea-history">
            <caption>Totale per anno · milioni di euro correnti</caption>
            <thead><tr><th scope="col">Anno</th><th scope="col">Spesa</th></tr></thead>
            <tbody>{view.history.map((item) => <tr key={item.year}><th scope="row">{item.year}</th><td>{amount(item.amountCents)}</td></tr>)}</tbody>
          </table>
          <p className={styles.note}>Prezzi correnti: le differenze comprendono anche l’effetto dei prezzi. Un dato assente resta “Dato non disponibile”; uno zero pubblicato resta zero.</p>
        </section>
      </div>

      <section className="panel" aria-labelledby="source-title">
        <h2 id="source-title" className="panel-title">Fonte, periodo e limiti</h2>
        <p>ISTAT · Spese per la protezione dell’ambiente (EPEA). Periodo 2016-2022; edizione dichiarata 2025M2. Snapshot acquisito il {longDate(source.acquiredAt)}: la data di acquisizione non è l’anno della spesa.</p>
        <p>Questa pagina seleziona la spesa nazionale per la protezione dell’ambiente (EPS_NEXP), a prezzi correnti (V), per l’Italia (IT). I dati originari sono in milioni di euro; le tabelle mantengono un decimale. I diversi aggregati disponibili nell’API restano separati e non vanno sommati.</p>
        <p><a href={source.url}>Dati ufficiali ISTAT (SDMX)</a> · <a href="https://www.istat.it/wp-content/uploads/2025/02/REPORTECONOMIAAMBIENTE_20250221.pdf">Rapporto ISTAT, febbraio 2025</a> · <a href={api}>API della selezione</a> · <Link href="/mcp">Dataset MCP: istat_epea</Link></p>
        <details className={styles.provenance}>
          <summary>Dettagli dello snapshot e limiti di riuso</summary>
          <p>Dataflow {source.dataflowId}. SHA-256 dei byte della fonte: <code>{source.sha256}</code>.</p>
          <p>Licenza non dichiarata dalla risposta SDMX acquisita; non viene inferita. La pagina utilizza lo snapshot già versionato del progetto.</p>
        </details>
      </section>
    </main>
  );
}
