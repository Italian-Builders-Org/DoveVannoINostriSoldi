import type { Metadata } from "next";
import Link from "next/link";
import { FuelCostEstimator } from "./fuel-cost-estimator";
import styles from "./mobilita.module.css";

export const metadata: Metadata = {
  title: "Mobilità, auto e costi",
  description:
    "Auto registrate, offerta di trasporto pubblico e costo del carburante: fonti, periodi e limiti a confronto.",
};

const EUROSTAT_CARS_URL =
  "https://ec.europa.eu/eurostat/statistics-explained/SEPDF/cache/25886.pdf?v=9212007050038232";
const ISTAT_VEHICLES_URL =
  "https://www.istat.it/comunicato-stampa/ambiente-urbano-anno-2024/";
const ISTAT_HOUSEHOLD_SPENDING_URL =
  "https://www.istat.it/wp-content/uploads/2025/10/Report_spese-per-consumi_2024.pdf";
const MIMIT_PRICES_URL = "https://www.mimit.gov.it/it/prezzi-carburanti-media-nazionale";

const TPL_SUPPLY = [
  { label: "Nord", value: 5_979 },
  { label: "Centro", value: 5_263 },
  { label: "Mezzogiorno", value: 2_240 },
] as const;

const HOUSEHOLD_SIGNALS = [
  {
    value: "25,9%",
    title: "ha ridotto la spesa per carburanti",
    note: "Tra le famiglie che già acquistavano carburanti per mezzi privati · 2024",
  },
  {
    value: "10,8%",
    title: "della spesa familiare va ai trasporti",
    note: "Categoria complessiva Trasporti: include più del solo carburante · 2024",
  },
] as const;

export default function MobilitaPage() {
  return (
    <main className={`shell ${styles.page}`}>
      <header className={styles.hero}>
        <div className={styles.heroCopy}>
          <span className={styles.kicker}>Mobilità · Italia</span>
          <h1>Quante auto ci sono. Quanto costa muoversi.</h1>
          <p>
            Mettiamo in relazione auto registrate, alternative disponibili e spesa quotidiana.
            Ogni indicatore mantiene il proprio periodo e il proprio perimetro.
          </p>
        </div>

        <section className={`panel ${styles.carPanel}`} aria-labelledby="car-rate-title">
          <div className={styles.panelHead}>
            <h2 id="car-rate-title" className="panel-title">Tasso di motorizzazione</h2>
            <span className="status status-attiva">2025</span>
          </div>

          <div className={styles.heroFigure}>
            <strong>709</strong>
            <span>autovetture registrate<br />ogni 1.000 abitanti</span>
          </div>

          <div className={styles.rateRows} aria-label="Confronto con la media europea">
            <div className={styles.rateRow}>
              <div><span>Italia</span><strong>709</strong></div>
              <span className={styles.rateTrack} aria-hidden="true"><i style={{ width: "100%" }} /></span>
            </div>
            <div className={styles.rateRow}>
              <div><span>Media UE</span><strong>584</strong></div>
              <span className={styles.rateTrack} aria-hidden="true"><i style={{ width: "82.4%" }} /></span>
            </div>
          </div>

          <p className={styles.sourceNote}>
            L’indicatore conta le auto registrate rispetto alla popolazione: non dice quante
            persone ne possiedono una. Include veicoli di famiglie, imprese e amministrazioni.
          </p>
          <a className={styles.sourceLink} href={EUROSTAT_CARS_URL} target="_blank" rel="noreferrer">
            Fonte: Eurostat, dati 2025 ↗
          </a>
        </section>
      </header>

      <nav className={styles.readingPath} aria-label="Temi della pagina">
        <a href="#alternative">Alternative disponibili</a>
        <a href="#spesa-famiglie">Carburante e bilancio</a>
        <a href="#calcolo">Stima personale</a>
        <a href="#spesa-pubblica">Spesa pubblica</a>
      </nav>

      <section className={styles.insightGrid} aria-label="Contesto della mobilità">
        <section className={`panel ${styles.panel}`} id="alternative" aria-labelledby="tpl-title">
          <div className={styles.panelHead}>
            <h2 id="tpl-title" className="panel-title">Il trasporto pubblico non offre le stesse alternative ovunque</h2>
            <span className={styles.period}>2024 · posti-km per abitante</span>
          </div>
          <p className={styles.sectionIntro}>
            Nei Comuni capoluogo l’offerta media è stata di 4.699 posti-km per abitante. La media
            nazionale nasconde differenze territoriali marcate.
          </p>
          <div className={styles.supplyRows}>
            {TPL_SUPPLY.map((item) => (
              <div className={styles.supplyRow} key={item.label}>
                <div className={styles.supplyLabel}>
                  <span>{item.label}</span>
                  <strong>{item.value.toLocaleString("it-IT")}</strong>
                </div>
                <span className={styles.supplyTrack} aria-hidden="true">
                  <i style={{ width: `${(item.value / TPL_SUPPLY[0].value) * 100}%` }} />
                </span>
              </div>
            ))}
          </div>
          <p className={styles.sourceNote}>
            La domanda media è stata di 176,4 passeggeri per abitante, ancora inferiore dell’8,2%
            al 2019. Posti-km e passeggeri descrivono offerta e uso: da soli non misurano la
            qualità del servizio né provano che una causi l’altra.
          </p>
          <a className={styles.sourceLink} href={ISTAT_VEHICLES_URL} target="_blank" rel="noreferrer">
            Fonte: Istat, Ambiente urbano 2024 ↗
          </a>
        </section>

        <section className={`panel ${styles.panel}`} id="spesa-famiglie" aria-labelledby="household-title">
          <div className={styles.panelHead}>
            <h2 id="household-title" className="panel-title">Il costo arriva anche a fine mese</h2>
            <span className={styles.period}>Famiglie · 2024</span>
          </div>
          <div className={styles.householdSignals}>
            {HOUSEHOLD_SIGNALS.map((signal) => (
              <div className={styles.householdSignal} key={signal.value}>
                <strong>{signal.value}</strong>
                <span>{signal.title}</span>
                <small>{signal.note}</small>
              </div>
            ))}
          </div>
          <p className={styles.sourceNote}>
            Il 10,8% riguarda tutti i trasporti. Il 25,9% descrive famiglie che hanno dichiarato
            di aver ridotto la spesa: non è una misura dell’importo medio in euro.
          </p>
          <a className={styles.sourceLink} href={ISTAT_HOUSEHOLD_SPENDING_URL} target="_blank" rel="noreferrer">
            Fonte: Istat, spese per consumi 2024 ↗
          </a>
        </section>
      </section>

      <section className={`panel ${styles.calculatorPanel}`} id="calcolo" aria-labelledby="calculator-title">
        <div className={styles.calculatorIntro}>
          <div>
            <span className={styles.kicker}>Una stima modificabile</span>
            <h2 id="calculator-title">Quanto ti costa il carburante in un anno?</h2>
            <p>
              La spesa dipende da prezzo, chilometri e consumi. Inserisci i tuoi valori per vedere
              una stima, senza inviare dati personali.
            </p>
          </div>
          <div className={styles.priceReference}>
            <span>Prezzi medi nazionali · rete stradale · self</span>
            <strong>Benzina €2,152/L</strong>
            <strong>Gasolio €2,369/L</strong>
            <small>Dato di riferimento: 28 settembre 2026</small>
            <a href={MIMIT_PRICES_URL} target="_blank" rel="noreferrer">Fonte: MIMIT ↗</a>
          </div>
        </div>

        <FuelCostEstimator
          prices={[
            { label: "Benzina", price: 2.152 },
            { label: "Gasolio", price: 2.369 },
          ]}
        />

        <p className={styles.calculatorCaveat}>
          Scenario a prezzo costante: la stima applica il prezzo di riferimento a tutti i
          chilometri dell’anno. Non include acquisto, assicurazione, manutenzione, parcheggi o
          pedaggi e non rappresenta la spesa media delle famiglie.
        </p>
      </section>

      <section className={`notice ${styles.publicSpend}`} id="spesa-pubblica" aria-labelledby="public-spend-title">
        <div>
          <strong>Il conto pubblico · prossima integrazione</strong>
          <h2 id="public-spend-title">Pagamenti per strade e trasporto pubblico</h2>
          <p>
            La pagina dovrebbe affiancare la spesa degli enti all’offerta e all’uso dei servizi.
            Qui non mostriamo ancora un totale: prima vanno verificati perimetri e voci contabili,
            così manutenzione stradale e trasporto pubblico restano distinguibili.
          </p>
        </div>
        <Link className="btn" href="/spese">Vai ai pagamenti comunali</Link>
      </section>

      <footer className={styles.methodNote}>
        <span>Come leggere questa pagina</span>
        <p>
          Auto registrate, posti-km offerti, risposte delle famiglie, prezzi alla pompa e pagamenti
          pubblici sono misure diverse. Periodo, unità e fonte restano accanto a ogni dato; una
          relazione tra indicatori non prova da sola una causa.
        </p>
        <Link href="/metodologia">Metodo e limiti dei dati →</Link>
      </footer>
    </main>
  );
}
