import type { Metadata } from "next";
import Link from "next/link";
import IntegratedSectionPreview from "@/components/integrated-section-preview";
import { anacCigSnapshot } from "@/lib/anac-cig-snapshot";
import { exactEuro, integer, longDate, percent } from "@/lib/format";
import styles from "./appalti.module.css";
import { ScrollRegion } from "./scroll-region";

export const metadata: Metadata = {
  title: "Appalti pubblici",
  description:
    "CIG 2025, procedure e segnali sulle soglie degli appalti pubblici ANAC, spiegati con perimetro e limiti chiari.",
};

const data = anacCigSnapshot;
const totalCigs = data.population.records;
const procedureEntries = Object.entries(data.procedureChoice.allLabels)
  .map(([label, records]) => ({ label, records }))
  .sort((left, right) => right.records - left.records);
const featuredProcedureEntries = procedureEntries.slice(0, 6);
const otherProcedureEntries = procedureEntries.slice(6);
const otherProcedureCount = otherProcedureEntries.reduce((sum, row) => sum + row.records, 0);
const procedureRows = [
  ...featuredProcedureEntries,
  { label: `Altre ${otherProcedureEntries.length} etichette`, records: otherProcedureCount },
];

const directAward = data.procedureChoice.directAward;
const directAwardFamily = data.procedureChoice.directAwardFamily;
const servicesAndSupplies = data.population.servicesAndSupplies;
const below140000 = data.servicesAndSuppliesBelow140000;
const thresholdBand = data.thresholdBand135000To140000;

function share(records: number, denominator: number): string {
  return percent((records / denominator) * 100);
}

const exactAmountRows = Object.entries(data.exactContractAmounts)
  .map(([amount, records]) => ({ amount: Number(amount), records }))
  .sort((left, right) => right.records - left.records);

export default function AppaltiPage() {
  return (
    <main className={`shell page ${styles.page}`}>
      <div className={styles.intro}>
        <div className="page-intro">
          <h1>Appalti pubblici: che cosa mostrano i CIG 2025</h1>
          <p>
            Una lettura dei codici di gara pubblicati da ANAC per capire quali procedure ricorrono
            di più e quali numeri meritano un controllo più vicino.
          </p>
        </div>
        <p className={styles.scopeLine}>
          <strong>Periodo: 2025</strong>
          <span>·</span>
          <span>{integer(totalCigs)} CIG unici</span>
          <span>·</span>
          <span>valori in euro dichiarati per il lotto</span>
        </p>
      </div>

      <section className="stat-strip" aria-label="Numeri principali del perimetro ANAC">
        <div>
          <span className="stat-label">CIG unici</span>
          <span className="stat-value">{integer(totalCigs)}</span>
          <span className="stat-note">dopo i controlli di unicità sul 2025</span>
        </div>
        <div>
          <span className="stat-label">Affidamento diretto · CIG osservati</span>
          <span className="stat-value">{share(directAward.records, totalCigs)}</span>
          <span className="stat-note">{integer(directAward.records)} su {integer(totalCigs)} CIG · quota sul numero di CIG</span>
        </div>
        <div>
          <span className="stat-label">Servizi e forniture</span>
          <span className="stat-value">{integer(servicesAndSupplies)}</span>
          <span className="stat-note">{share(servicesAndSupplies, totalCigs)} del totale CIG</span>
        </div>
        <div>
          <span className="stat-label">Copertura</span>
          <span className="stat-value">12/12</span>
          <span className="stat-note">file mensili presenti nello snapshot</span>
        </div>
      </section>

      <section className={`notice scope-notice ${styles.readingNotice}`} aria-labelledby="appalti-reading-title">
        <h2 id="appalti-reading-title">Come leggere questi numeri</h2>
        <p>
          Contano come sono etichettati i CIG pubblicati. Il campo <strong>importo_lotto</strong> è
          il valore dichiarato del lotto nella banca dati.
        </p>
      </section>

      <section className={`panel ${styles.leadPanel}`} aria-labelledby="procedure-title">
        <div className={styles.leadCopy}>
          <h2 id="procedure-title" className="panel-title">Le procedure che ricorrono di più</h2>
          <p>
            La voce <strong>AFFIDAMENTO DIRETTO</strong> è l&apos;etichetta più frequente: rappresenta
            {" "}{share(directAward.records, totalCigs)} dei {integer(totalCigs)} CIG unici osservati.
            La famiglia più ampia delle etichette che iniziano con “AFFIDAMENTO DIRETTO” arriva a
            {" "}{share(directAwardFamily.records, totalCigs)} e raccoglie etichette diverse.
          </p>
        </div>
        <div className={styles.leadMeasure}>
          <span>Etichetta più frequente</span>
          <strong>{share(directAward.records, totalCigs)}</strong>
          <small>del totale CIG · denominatore: {integer(totalCigs)}</small>
        </div>
      </section>

      <section className={`panel ${styles.procedurePanel}`} aria-labelledby="procedure-breakdown-title">
        <div className={styles.sectionHeading}>
          <div>
            <h2 id="procedure-breakdown-title" className="panel-title">Distribuzione delle etichette</h2>
            <p>
              Le prime sei voci coprono {share(
                featuredProcedureEntries.reduce((sum, row) => sum + row.records, 0),
                totalCigs,
              )} dei CIG. Le altre sono accorpate solo nel grafico e nella tabella equivalente qui
              sotto; il dettaglio delle 32 etichette resta apribile più avanti.
            </p>
          </div>
          <span className="tag tag-neutral">Denominatore: tutti i CIG unici 2025</span>
        </div>

        <ol className={styles.barList} aria-label="Le sei etichette di procedura più frequenti e le altre etichette">
          {procedureRows.map((row, index) => (
            <li key={row.label}>
              <div className={styles.barMeta}>
                <span>{row.label}</span>
                <strong>
                  {integer(row.records)} <small>· {share(row.records, totalCigs)}</small>
                </strong>
              </div>
              <div className={styles.barTrack} aria-hidden="true">
                <i style={{ width: `${(row.records / totalCigs) * 100}%` }} />
              </div>
              <span className={styles.barRank}>#{index + 1}</span>
            </li>
          ))}
        </ol>

        <ScrollRegion className="table-scroll" role="region" aria-label="Tabella esatta della distribuzione delle procedure" tabIndex={0}>
          <table className="table">
            <caption>Le stesse categorie rappresentate nel grafico, con conteggio e quota sul totale dei CIG unici 2025</caption>
            <thead>
              <tr>
                <th scope="col">Etichetta</th>
                <th scope="col" className="num">CIG</th>
                <th scope="col" className="num">Quota</th>
              </tr>
            </thead>
            <tbody>
              {procedureRows.map((row) => (
                <tr key={row.label}>
                  <th scope="row">{row.label}</th>
                  <td className="num">{integer(row.records)}</td>
                  <td className="num">{share(row.records, totalCigs)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollRegion>

        <details className={styles.detailTable}>
          <summary>Apri tutte le 32 etichette originali</summary>
          <ScrollRegion className="table-scroll" role="region" aria-label="Tutte le etichette originali delle procedure ANAC" tabIndex={0}>
            <p className={styles.tableHint}>Scorri la tabella verso destra →</p>
            <table className="table">
              <caption>Tutte le etichette presenti nel campo procedura del perimetro ANAC CIG 2025</caption>
              <thead>
                <tr>
                  <th scope="col">Etichetta originale</th>
                  <th scope="col" className="num">CIG</th>
                  <th scope="col" className="num">Quota</th>
                </tr>
              </thead>
              <tbody>
                {procedureEntries.map((row) => (
                  <tr key={row.label}>
                    <th scope="row">{row.label}</th>
                    <td className="num">{integer(row.records)}</td>
                    <td className="num">{share(row.records, totalCigs)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollRegion>
        </details>
      </section>

      <section className={`panel ${styles.subsetPanel}`} aria-labelledby="subset-title">
        <div className={styles.sectionHeading}>
          <div>
            <h2 id="subset-title" className="panel-title">Che cosa significa “sotto 140.000 €”</h2>
            <p>
              È un sottoinsieme di CIG per <strong>servizi e forniture</strong> con importo del lotto
              sotto 140.000 €. Il suo denominatore non coincide con tutti gli appalti del Paese.
            </p>
          </div>
          <span className="tag tag-neutral">{integer(below140000.records)} CIG nel sottoinsieme</span>
        </div>

        <div className={`stat-strip ${styles.threeStats}`}>
          <div>
            <span className="stat-label">Affidamento diretto</span>
            <span className="stat-value">{share(below140000.directAwardRecords, below140000.records)}</span>
            <span className="stat-note">{integer(below140000.directAwardRecords)} su {integer(below140000.records)} CIG</span>
          </div>
          <div>
            <span className="stat-label">Famiglia affidamento diretto</span>
            <span className="stat-value">{share(below140000.directAwardFamilyRecords, below140000.records)}</span>
            <span className="stat-note">{integer(below140000.directAwardFamilyRecords)} su {integer(below140000.records)} CIG</span>
          </div>
          <div>
            <span className="stat-label">Servizi e forniture nel 2025</span>
            <span className="stat-value">{share(below140000.records, servicesAndSupplies)}</span>
            <span className="stat-note">{integer(below140000.records)} su {integer(servicesAndSupplies)} CIG</span>
          </div>
        </div>

        <p className={styles.note}>
          La famiglia include etichette diverse: “AFFIDAMENTO DIRETTO” esatto e altre etichette che
          iniziano nello stesso modo. Leggerle come se fossero una sola procedura gonfierebbe il
          confronto.
        </p>
      </section>

      <section className={`panel ${styles.thresholdPanel}`} aria-labelledby="threshold-title">
        <div className={styles.sectionHeading}>
          <div>
            <h2 id="threshold-title" className="panel-title">Un segnale vicino alla soglia</h2>
            <p>
              Nella fascia <strong>[135.000 €, 140.000 €)</strong> ci sono {integer(thresholdBand.servicesAndSuppliesRecords)}
              {" "}CIG di servizi e forniture. Questi numeri indicano dove guardare meglio negli atti.
              La fascia serve a scegliere cosa verificare negli atti originali.
            </p>
          </div>
          <span className="tag tag-neutral">Intervallo dichiarato da ANAC</span>
        </div>

        <ScrollRegion className="table-scroll" role="region" aria-label="Indicatori della fascia tra 135 mila e 140 mila euro" tabIndex={0}>
          <p className={styles.tableHint}>Scorri la tabella verso destra →</p>
          <table className="table">
            <caption>Conteggi della fascia di importo e denominatori espliciti</caption>
            <thead>
              <tr>
                <th scope="col">Misura</th>
                <th scope="col" className="num">CIG</th>
                <th scope="col" className="num">Quota sul denominatore</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <th scope="row">Servizi e forniture nella fascia</th>
                <td className="num">{integer(thresholdBand.servicesAndSuppliesRecords)}</td>
                <td className="num">{share(thresholdBand.servicesAndSuppliesRecords, servicesAndSupplies)} su tutti i servizi e forniture</td>
              </tr>
              <tr>
                <th scope="row">Affidamento diretto nella fascia</th>
                <td className="num">{integer(thresholdBand.directAwardRecords)}</td>
                <td className="num">{share(thresholdBand.directAwardRecords, thresholdBand.servicesAndSuppliesRecords)} sulla fascia</td>
              </tr>
              <tr>
                <th scope="row">Contratto d&apos;appalto · definizione stretta</th>
                <td className="num">{integer(thresholdBand.strictContractRecords)}</td>
                <td className="num">{share(thresholdBand.strictContractRecords, thresholdBand.servicesAndSuppliesRecords)} sulla fascia</td>
              </tr>
            </tbody>
          </table>
        </ScrollRegion>

        <p className={styles.note}>
          <strong>Definizione stretta:</strong> per questa riga contiamo solo servizi o forniture con
          etichetta “AFFIDAMENTO DIRETTO”, contratto d&apos;appalto e importo del lotto da 135.000 €
          incluso a 140.000 € escluso.
          <small className={styles.definitionSource}>
            Regola dati: {thresholdBand.strictContractDefinition}
          </small>
        </p>

        <div className={styles.exactAmounts}>
          <h3>Valori del lotto che ricorrono spesso</h3>
          <p>
            Sono conteggi di CIG con lo stesso valore dichiarato. Li mostriamo come indizio
            descrittivo su quanto ricorre quel valore dichiarato.
          </p>
          <ScrollRegion className="table-scroll" role="region" aria-label="Valori esatti del lotto più ricorrenti" tabIndex={0}>
            <p className={styles.tableHint}>Scorri la tabella verso destra →</p>
            <table className="table">
              <caption>Conteggi per valore esatto di importo_lotto, quota sul totale dei CIG unici 2025</caption>
              <thead>
                <tr>
                  <th scope="col">Valore lotto dichiarato</th>
                  <th scope="col" className="num">CIG</th>
                  <th scope="col" className="num">Quota sul totale</th>
                </tr>
              </thead>
              <tbody>
                {exactAmountRows.map((row) => (
                  <tr key={row.amount}>
                    <th scope="row">{exactEuro(row.amount)}</th>
                    <td className="num">{integer(row.records)}</td>
                    <td className="num">{share(row.records, totalCigs)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollRegion>
        </div>
      </section>

      <section className={`panel ${styles.coveragePanel}`} aria-labelledby="coverage-title">
        <h2 id="coverage-title" className="panel-title">Che cosa è entrato nel conteggio</h2>
        <ScrollRegion className="table-scroll" role="region" aria-label="Controlli di copertura del dataset ANAC" tabIndex={0}>
          <p className={styles.tableHint}>Scorri la tabella verso destra →</p>
          <table className="table">
            <caption>Controlli di copertura e record esclusi dal perimetro pubblicato</caption>
            <thead>
              <tr>
                <th scope="col">Controllo</th>
                <th scope="col" className="num">Valore</th>
                <th scope="col">Come leggerlo</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <th scope="row">Righe grezze mensili</th>
                <td className="num">{integer(data.population.rawRows)}</td>
                <td>Righe lette prima della deduplicazione dei CIG.</td>
              </tr>
              <tr>
                <th scope="row">CIG unici pubblicati</th>
                <td className="num">{integer(totalCigs)}</td>
                <td>Il denominatore usato nelle quote della pagina.</td>
              </tr>
              <tr>
                <th scope="row">Importi non positivi</th>
                <td className="num">{integer(data.population.nonPositiveAmountRecords)}</td>
                <td>Esclusi dalle analisi di soglia e importo.</td>
              </tr>
              <tr>
                <th scope="row">CIG senza CPV prevalente</th>
                <td className="num">{integer(data.population.cigsWithoutPrevalentCpv)}</td>
                <td>Restano fuori dalle classificazioni che richiedono quel campo.</td>
              </tr>
              <tr>
                <th scope="row">Record inattivi esclusi</th>
                <td className="num">{integer(data.population.inactiveRecordsExcluded)}</td>
                <td>Nessuno escluso per questo motivo nello snapshot.</td>
              </tr>
            </tbody>
          </table>
        </ScrollRegion>
      </section>

      <IntegratedSectionPreview
        section="appalti"
        title="Dal quadro nazionale ai singoli atti"
        description="Affidamenti, fornitori, rinnovi e confronti Consip sono organizzati in percorsi leggibili; ogni percorso arriva alle righe e alle fonti."
        hubHref="/appalti/dettaglio"
        limit={3}
      />

      <section className={`panel ${styles.sourcePanel}`} id="fonti-metodo" aria-labelledby="sources-title">
        <h2 id="sources-title" className="panel-title">Fonti, metodo e limiti</h2>
        <p>
          La fonte primaria è il dataset ufficiale ANAC dei CIG 2025. Abbiamo letto i dodici file
          mensili disponibili, verificato la copertura annuale e mantenuto separati conteggi, valori
          dichiarati e segnali di screening.
        </p>
        <dl className={styles.sourceList}>
          <div>
            <dt>Dataset ufficiale</dt>
            <dd>
              <a href={data.provenance.datasetUrl} target="_blank" rel="noreferrer">
                ANAC · CIG 2025 ↗
              </a>
            </dd>
          </div>
          <div>
            <dt>Licenza</dt>
            <dd>
              <a href={data.provenance.licenseUrl} target="_blank" rel="noreferrer">
                {data.provenance.license} ↗
              </a>
            </dd>
          </div>
          <div>
            <dt>Ultimo controllo</dt>
            <dd>{longDate(data.observedAt)} · 12 mesi completi</dd>
          </div>
          <div>
            <dt>Provenienza</dt>
            <dd>{data.provenance.owner} · dati aperti BDNCP</dd>
          </div>
        </dl>

        <details open className={styles.methodDetails}>
          <summary>Perimetro tecnico e interpretazione</summary>
          <ul>
            <li>
              Le quote delle procedure usano come denominatore tutti i {integer(totalCigs)} CIG unici
              del 2025. Le quote del sottoinsieme sotto 140.000 € usano solo i {integer(below140000.records)}
              {" "}CIG di servizi e forniture compresi in quel perimetro.
            </li>
            <li>
              “Affidamento diretto” è l&apos;etichetta esatta; la famiglia più ampia comprende tutte le
              etichette che iniziano con quella dicitura e resta distinta dalla procedura unica.
            </li>
            <li>{data.methodology.screeningOnly}</li>
            <li>
              Il dato collega i CIG al valore dichiarato senza nomi di fornitori né concentrazione
              per soggetto.
            </li>
            <li>
              L&apos;importo del lotto è il valore dichiarato nella banca dati. Per verificare un caso
              servono l&apos;atto originale, la procedura completa e le informazioni collegate
              pubblicate dalle fonti ufficiali.
            </li>
          </ul>
        </details>
        <p className={styles.nextStep}>
          Vuoi passare dal quadro ai controlli? Apri la pagina <Link href="/controlli">Cosa vale la pena controllare →</Link>.
        </p>
      </section>
    </main>
  );
}
