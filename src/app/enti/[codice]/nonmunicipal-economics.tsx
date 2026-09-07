import Link from "next/link";
import { compactEuroFromCents } from "@/lib/format";
import { getSiopeNonMunicipalPeriodStatus, getSiopeNonMunicipalTypeLabel, selectSiopeNonMunicipalYear, type SiopeNonMunicipalEntity } from "@/lib/siope-nonmunicipal";
import styles from "./scheda.module.css";

function monthLabel(months: readonly number[]): string {
  if (months.length === 0) return "Nessun mese osservato";
  const names = new Intl.DateTimeFormat("it-IT", { month: "long", timeZone: "UTC" });
  return months.map((month) => names.format(new Date(Date.UTC(2024, month - 1, 1)))).join(", ");
}

function acquisitionLabel(value: string): string {
  return new Intl.DateTimeFormat("it-IT", { dateStyle: "long", timeZone: "UTC" }).format(new Date(value));
}

export function NonMunicipalEconomics({ entity, year }: { entity: SiopeNonMunicipalEntity; year: string | string[] | undefined }) {
  const { selected, invalidYear } = selectSiopeNonMunicipalYear(entity, year);
  const label = getSiopeNonMunicipalTypeLabel(entity);
  const period = getSiopeNonMunicipalPeriodStatus(selected);
  const isAsl = entity.entityType === "ASL";
  const categoryTable = <div className="table-scroll" role="region" aria-label={isAsl ? "Voci dei pagamenti SIOPE SAN" : "Categorie dei pagamenti SIOPE"} tabIndex={0}><table className="table"><thead><tr><th scope="col">{isAsl ? "Voce SIOPE SAN" : "Categoria"}</th><th scope="col" className="num">Importo</th></tr></thead><tbody>{selected.titles.map((item) => <tr key={item.code}><th scope="row">{isAsl ? `${item.code} · ` : ""}{item.label}</th><td className="num">{compactEuroFromCents(item.amountCents)}</td></tr>)}</tbody></table></div>;
  return <section className={`panel ${styles.economicSection}`} aria-labelledby="siope-nonmunicipal-title" id="pagamenti-siope">
    <div className={styles.sectionHeading}><div><span className={styles.sectionKicker}>SIOPE · pagamenti di cassa</span><h2 className={styles.sectionTitle} id="siope-nonmunicipal-title">Pagamenti {isAsl ? "dell’" : "della "}{label.toLocaleLowerCase("it-IT")}</h2></div></div>
    <p className={styles.readingGuide}>Pagamenti di cassa dell&apos;amministrazione, non spesa consolidata nel territorio. La sede legale non indica il destinatario del pagamento.</p>
    {isAsl ? <p className={styles.readingGuide}>Sono pagamenti dell’azienda sanitaria locale, distinti dai costi del <Link href="/spese/sanita">Conto Economico SSN</Link>. Le due misure non si sommano. Il dettaglio segue i codici del comparto sanitario SAN.</p> : null}
    <form action="" method="get" className={styles.yearPicker}>
      <label htmlFor="siope-anno">Anno</label><select id="siope-anno" name="siopeAnno" defaultValue={String(selected.year)}>{entity.years.map((item) => <option key={item.year} value={item.year}>{item.year}</option>)}</select><button className="btn" type="submit">Aggiorna</button>
    </form>
    {invalidYear ? <p className="notice">Anno SIOPE non disponibile per questa scheda; mostriamo {selected.year}.</p> : null}
    {selected.status === "available" ? <div className={styles.periodMeta}>
      <span className={period.status === "partial-revisionable" ? styles.partialStatus : styles.completeStatus}>
        {period.status === "partial-revisionable" ? "Periodo parziale e revisionabile" : "Annualità completa e revisionabile"}
      </span>
      {period.latestObservedMonthMayBeIncomplete ? <p>Il mese più recente osservato può essere ancora incompleto.</p> : <p>I dati pubblicati possono essere rettificati dalla fonte.</p>}
    </div> : null}
    {selected.status === "outside_period" ? <p className="notice">Fuori dal periodo di validità dell&apos;ente.</p> : selected.status === "no_movements" ? <p className="notice">Nessun movimento osservato nel periodo; totale n.d., non 0.</p> : <>
      <dl className={`${styles.paymentSummary} ${styles.singlePaymentSummary}`}><div className={styles.paymentTotal}><dt>Totale pagato nel periodo</dt><dd>{compactEuroFromCents(selected.amountCents ?? 0)}</dd><small>Mesi osservati: {monthLabel(selected.monthsObserved)}</small></div></dl>
      <div className={styles.monthlySection}>
        <h3>Importi mensili osservati</h3>
        <div className="table-scroll" role="region" aria-label={`Importi mensili dei pagamenti SIOPE ${selected.year}`} tabIndex={0}><table className="table"><caption>Solo mesi presenti nella fonte; un mese assente non è uno zero.</caption><thead><tr><th scope="col">Mese</th><th scope="col" className="num">Importo</th></tr></thead><tbody>{selected.monthly.map((point) => <tr key={point.month}><th scope="row">{monthLabel([point.month])}</th><td className="num">{compactEuroFromCents(point.amountCents)}</td></tr>)}</tbody></table></div>
      </div>
      {isAsl ? <details className="chart-data"><summary>Consulta tutte le {selected.titles.length} voci SIOPE SAN</summary>{categoryTable}</details> : categoryTable}
    </>}
    <p className={styles.sourceLine}>Fonte: <a href={selected.provenance.siopeMovementsUrl} target="_blank" rel="noreferrer">SIOPE {selected.year} ↗</a>. Acquisizione: <time dateTime={selected.provenance.acquisitionDate}>{acquisitionLabel(selected.provenance.acquisitionDate)}</time>. Codici SIOPE inclusi: {entity.includedCodes.join(", ")}.</p>
  </section>;
}
