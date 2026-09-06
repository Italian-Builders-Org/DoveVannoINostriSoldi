import Link from "next/link";
import { compactEuro, exactEuro, integer, longDate } from "@/lib/format";
import {
  availableSiopeReceiptsYears,
  getSiopeMunicipalityCashComparison,
  getSiopeMunicipalReceiptsSnapshot,
} from "@/lib/siope-receipts";
import { ReceiptsSources } from "@/app/entrate/receipts-sources";
import { receiptsPageHref, receiptsPeriodLabel } from "@/app/entrate/receipts-view";
import receiptsStyles from "@/app/entrate/entrate.module.css";
import styles from "./scheda.module.css";

export function MunicipalityReceipts({ taxCode }: { taxCode: string }) {
  const years = availableSiopeReceiptsYears.map((year) => ({
    ...getSiopeMunicipalityCashComparison(taxCode, year),
    snapshot: getSiopeMunicipalReceiptsSnapshot(year),
  }));
  const latest = years[0];
  const receipts = latest.receipts;

  return (
    <section className={`panel ${styles.economicSection} ${receiptsStyles.anchorTarget}`} id="dati-incassi" aria-labelledby="municipality-receipts-title">
      <div className={styles.sectionHeading}>
        <div>
          <span className={styles.sectionKicker}>SIOPE · incassi di cassa</span>
          <h2 className={styles.sectionTitle} id="municipality-receipts-title">Quanto ha incassato il Comune</h2>
        </div>
        <Link href={receiptsPageHref({ year: latest.period.year, code: taxCode })}>Esplora gli incassi comunali</Link>
      </div>
      <p className={styles.readingGuide}>
        Soldi entrati nei conti del Comune, non accertamenti né entrate di competenza.
        Trasferimenti, prestiti e partite di giro sono inclusi: il totale non misura le imposte pagate dai residenti.
      </p>
      <p className={latest.period.completeness === "partial" ? styles.partialStatus : styles.completeStatus}>
        {receiptsPeriodLabel(latest.period)}
      </p>
      <div className="stat-strip" aria-label={`Sintesi degli incassi ${latest.period.year}`}>
        <div><span className="stat-label">Totale incassato nel periodo</span><span className="stat-value">{receipts?.totalCents == null ? "Nessun movimento osservato" : compactEuro(receipts.totalCents / 100)}</span><span className="stat-note">{receipts?.totalCents == null ? "L’assenza non è uno zero" : `${exactEuro(receipts.totalCents / 100)} esatti`}</span></div>
        <div><span className="stat-label">Per abitante</span><span className="stat-value">{receipts?.perCapitaCents == null ? "Non disponibile" : exactEuro(receipts.perCapitaCents / 100)}</span><span className="stat-note">Popolazione SIOPE, data non dichiarata</span></div>
        <div><span className="stat-label">Popolazione usata</span><span className="stat-value">{receipts?.population == null ? "Non disponibile" : integer(receipts.population)}</span><span className="stat-note">Anagrafica SIOPE, non la popolazione ISTAT dei pagamenti</span></div>
        <div><span className="stat-label">Per km²</span><span className="stat-value">{receipts?.perSquareKmCents == null ? "Non disponibile" : exactEuro(receipts.perSquareKmCents / 100)}</span><span className="stat-note">Superficie comunale ISTAT verificata</span></div>
      </div>

      <h3>Incassi per anno e pagamenti confrontabili</h3>
      <p className={styles.note}>
        Incassi e pagamenti sono flussi distinti. I pagamenti sono affiancati solo con periodi allineati;
        per periodi parziali devono coincidere anche rilascio e anagrafiche.
        Non calcoliamo un saldo, un residuo fiscale o classifiche di efficienza o spreco.
      </p>
      <div className={`table-scroll ${receiptsStyles.tableRegion}`} role="region" aria-label="Incassi e pagamenti comunali per periodi allineati" tabIndex={0}>
        <table className="table">
          <thead><tr><th scope="col">Periodo degli incassi</th><th scope="col" className="num">Incassato</th><th scope="col" className="num">Pagato, se confrontabile</th><th scope="col">Fonte incassi</th></tr></thead>
          <tbody>{years.map((row) => <tr key={row.period.year}>
            <th scope="row">{receiptsPeriodLabel(row.period)}</th>
            <td className="num">{row.receipts?.totalCents == null ? "Nessun movimento osservato" : exactEuro(row.receipts.totalCents / 100)}</td>
            <td className="num">{row.comparable && row.paymentsCents !== null ? exactEuro(row.paymentsCents / 100) : <>Non confrontabile<small>{row.reason ?? "Copertura omogenea non verificata."}</small></>}</td>
            <td><a href={row.snapshot.source.siopeMovementsUrl} target="_blank" rel="noreferrer">SIOPE {row.period.year} ↗</a><small>Aggiornamento HTTP (Last-Modified): {longDate(row.snapshot.source.siopeMovementsLastModified)}</small></td>
          </tr>)}</tbody>
        </table>
      </div>
      <p className={styles.note}>
        {latest.period.completeness === "partial" ? "Il periodo più recente è una rilevazione parziale, non un anno completo. " : ""}
        Nessuna crescita annuale viene calcolata. I valori per abitante degli incassi usano un denominatore diverso da quello dei pagamenti nella scheda.
      </p>

      <details className={receiptsStyles.breakdown}>
        <summary>Da dove arrivano gli incassi · {latest.period.year}</summary>
        {receipts && receipts.totalCents !== null ? (
          <div className={`table-scroll ${receiptsStyles.tableRegion}`} role="region" aria-label="Titoli degli incassi del Comune" tabIndex={0}>
            <table className="table">
              <caption>{receiptsPeriodLabel(latest.period)}</caption>
              <thead><tr><th scope="col">Titolo di entrata</th><th scope="col" className="num">Incassato</th></tr></thead>
              <tbody>{receipts.titles.map((title) => <tr key={title.code}><th scope="row">{title.code} · {title.label}</th><td className="num">{exactEuro(title.amountCents / 100)}</td></tr>)}</tbody>
            </table>
          </div>
        ) : <p>Nessun movimento osservato per questo Comune nel periodo: il dettaglio per titolo non è disponibile.</p>}
      </details>
      <ReceiptsSources data={latest.snapshot} />
    </section>
  );
}
