import type { Metadata } from "next";
import Link from "next/link";
import IntegratedSectionPreview from "@/components/integrated-section-preview";
import {
  auditClassifications,
  auditReviewedAt,
  auditScenarioAssumptions,
  auditScenarioBasis,
  auditScenarios,
  auditSignals,
  availableAuditYears,
  centralScenarioBreakdown,
  getAuditSignalsForYear,
  getProcurementAvailability,
  getProcurementComparisonForYear,
  procurementComparisons,
  procurementServicesAndSupplies2025,
  type AuditSignal,
} from "@/lib/audit-data";
import { exactEuro, integer, longDate, percent } from "@/lib/format";
import { municipalityName } from "@/lib/municipality-name";
import { queryOpenCivitasSpendingOutliers } from "@/lib/opencivitas-outliers";
import { openCivitasSnapshot } from "@/lib/opencivitas-snapshot";
import styles from "./controlli.module.css";

export const metadata: Metadata = {
  title: "Cosa controllare",
  description:
    "Numeri e aree della spesa pubblica che meritano verifiche più approfondite, senza trasformare segnali in accuse.",
};

type PageProps = {
  searchParams: Promise<{ anno?: string | string[] }>;
};

const number = new Intl.NumberFormat("it-IT", {
  maximumFractionDigits: 1,
  useGrouping: "always",
});

const scenarioTotalNumber = new Intl.NumberFormat("it-IT", {
  maximumFractionDigits: 2,
  minimumFractionDigits: 2,
});

const scenarioComponentNumber = new Intl.NumberFormat("it-IT", {
  maximumFractionDigits: 1,
  minimumFractionDigits: 1,
});

const OUTLIER_TABLE_SIZE = 15;
const toneLabels = {
  observed: "Misura diretta",
  attention: "Priorità di verifica",
  policy: "Effetto di policy",
  stock: "Stock / esposizione",
} as const;
const populationBandLabels = {
  "meno-di-1.000": "Meno di 1.000",
  "1.000-4.999": "Da 1.000 a 4.999",
  "5.000-19.999": "Da 5.000 a 19.999",
  "20.000-o-piu": "20.000 o più",
  "non-disponibile": "Non disponibile",
} as const;
const availableControlYears = [...new Set([...availableAuditYears, openCivitasSnapshot.referenceYear])]
  .sort((left, right) => right - left);

function signedEuroFromCents(cents: number): string {
  const value = exactEuro(Math.abs(cents) / 100);
  if (cents > 0) return `+${value}`;
  if (cents < 0) return `−${value}`;
  return value;
}

function referencePeriod(value: string): string {
  const parts = value.split("-");
  if (parts.length === 1) return value;

  const date = new Date(`${parts.length === 2 ? `${value}-01` : value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat("it-IT", {
    ...(parts.length === 3 ? { day: "numeric" as const } : {}),
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

function formatSignal(signal: AuditSignal) {
  let formatted: string;
  if (signal.unit === "percent") formatted = percent(signal.value);
  else if (signal.unit === "billion-euro") formatted = `${number.format(signal.value)} mld €`;
  else if (signal.unit === "million-euro") formatted = `${number.format(signal.value)} mln €`;
  else formatted = integer(signal.value);

  if (signal.valueQualifier === "over") return `oltre ${formatted}`;
  if (signal.valueQualifier === "about") return `circa ${formatted}`;
  return formatted;
}

function formatScenarioComponent(valueBillion: number): string {
  if (valueBillion >= 1) {
    return `${new Intl.NumberFormat("it-IT", { maximumFractionDigits: 3 }).format(valueBillion)} mld €`;
  }
  return `${scenarioComponentNumber.format(valueBillion * 1_000)} mln €`;
}

function requestedYear(raw: string | string[] | undefined): number | null {
  if (typeof raw !== "string" || !/^20\d{2}$/.test(raw)) return null;
  const year = Number.parseInt(raw, 10);
  return availableControlYears.includes(year) ? year : null;
}

export default async function ControlsPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const selectedYear = requestedYear(params.anno);
  const selectedAuditYear = selectedYear !== null && availableAuditYears.includes(selectedYear);
  const signals = selectedYear === null
    ? auditSignals
    : selectedAuditYear
      ? getAuditSignalsForYear(selectedYear)
      : [];
  const comparison = selectedAuditYear
    ? getProcurementComparisonForYear(selectedYear)
    : selectedYear === null
      ? procurementComparisons[2025]
      : null;
  const procurementAvailability = selectedYear !== null
    ? getProcurementAvailability(selectedYear)
    : null;
  const procurementRows = Object.values(procurementComparisons).sort(
    (left, right) => right.year - left.year,
  );
  const maxScenario = Math.max(...auditScenarios.map((scenario) => scenario.annualBillion));
  const centralTotal = centralScenarioBreakdown.reduce((sum, item) => sum + item.value, 0);
  const maxBreakdown = Math.max(...centralScenarioBreakdown.map((item) => item.value));
  const comparisonValue = comparison
    ? (comparison.totalValueBillion * comparison.byValue) / 100
    : null;
  const classificationEntries = Object.entries(auditClassifications);
  const spendingOutliers = queryOpenCivitasSpendingOutliers({
    year: openCivitasSnapshot.referenceYear,
    limit: OUTLIER_TABLE_SIZE,
  });
  const topSpendingOutliers = spendingOutliers.outliers;
  const showsMunicipalScreening =
    selectedYear === null || selectedYear === openCivitasSnapshot.referenceYear;
  const showsProcurement2025 = selectedYear === null || selectedYear === 2025;
  const showsPolicyScenarios = selectedYear === null;
  const pageSections = [
    { id: "official-signals-title", label: "Segnali ufficiali", shown: true },
    { id: "municipal-screening-title", label: "Comuni oltre la soglia", shown: showsMunicipalScreening },
    { id: "appalti-related-title", label: "Appalti pubblici", shown: true },
    { id: "procurement-2025-title", label: "Appalti 2025", shown: showsProcurement2025 },
    { id: "policy-scenarios-title", label: "Ipotesi di miglioramento", shown: showsPolicyScenarios },
  ].filter((section) => section.shown);

  return (
    <main className="shell page">
      <div className="page-intro">
        <h1>Cosa vale la pena controllare</h1>
        <p>
          Numeri presi da relazioni ufficiali, rivisti il {longDate(`${auditReviewedAt}T00:00:00Z`)}.
          Ogni numero dice una cosa precisa e mostra anche i suoi limiti.
        </p>
      </div>

      <nav className={styles.yearFilter} aria-label="Filtra i controlli per anno">
        <span>Periodo</span>
        <div>
          <Link href="/controlli" aria-current={selectedYear === null ? "page" : undefined}>
            Tutti
          </Link>
          {availableControlYears.map((year) => (
            <Link
              href={`/controlli?anno=${year}`}
              key={year}
              aria-current={selectedYear === year ? "page" : undefined}
            >
              {year}
            </Link>
          ))}
        </div>
      </nav>

      <nav className={styles.pageIndex} aria-labelledby="page-index-title">
        <h2 id="page-index-title">In questa pagina</h2>
        <ul>
          {pageSections.map((section) => (
            <li key={section.id}>
              <a href={`#${section.id}`}>{section.label}</a>
            </li>
          ))}
        </ul>
      </nav>

      <section
        className="notice scope-notice"
        aria-labelledby="controlli-reading-title"
      >
        <h2 id="controlli-reading-title">Cosa dicono questi segnali</h2>
        <p>
          Pagamenti, debiti e costi non si mescolano. Un segnale indica cosa approfondire; non sostituisce Guardia di finanza, ANAC, Corte dei conti o il controllo umano. Vedi le{" "}
          <Link href="/fonti">fonti</Link>, il <Link href="/metodologia">metodo</Link>, gli{" "}
          <Link href="/appalti">appalti</Link>, il <Link href="/mcp">dataset MCP ANAC</Link> e il{" "}
          <a
            href="https://dati.anticorruzione.it/opendata/dataset"
            target="_blank"
            rel="noreferrer"
            aria-label="Apri il catalogo open data ANAC in una nuova scheda"
          >
            catalogo ANAC ↗
          </a>
          .
        </p>
      </section>

      <section className={`panel ${styles.typeLegend}`} aria-labelledby="signal-types-title">
        <h2 id="signal-types-title" className="panel-title">Come leggere i numeri</h2>
        <p className={styles.legendLead}>
          Ogni blocco è un tipo di dato diverso. La riga colorata mostra quanto è forte il segnale,
          non una colpa.
        </p>
        <ul className={styles.toneLegend}>
          {(Object.keys(toneLabels) as Array<keyof typeof toneLabels>).map((tone) => (
            <li key={tone} data-tone={tone}>
              <span className={styles.toneSwatch} aria-hidden="true" />
              <span>
                <strong>{toneLabels[tone]}</strong>
                {tone === "attention" && " · cifre da approfondire con la fonte"}
                {tone === "observed" && " · valore pubblicato o contato"}
                {tone === "policy" && " · effetto di una scelta pubblica"}
                {tone === "stock" && " · esposizione accumulata nel tempo"}
              </span>
            </li>
          ))}
        </ul>
        <details className={styles.readingGuide}>
          <summary>Definizioni dei tipi di segnale</summary>
          <p>
            Le etichette sulle schede riprendono le categorie sotto. Servono a capire quanto
            possiamo concludere da ogni numero.
          </p>
          <dl>
            {classificationEntries.map(([id, classification]) => (
              <div key={id}>
                <dt>{classification.label}</dt>
                <dd>{classification.plainMeaning}</dd>
              </div>
            ))}
          </dl>
        </details>
      </section>

      <section className={styles.signalSection} aria-labelledby="official-signals-title">
        <header className={styles.sectionIntro}>
          <h2 id="official-signals-title">Segnali da relazioni ufficiali</h2>
          <p>
            Cifre pubblicate da autorità di controllo. Ogni scheda indica ambito, stato del dato e
            limiti di lettura.
          </p>
        </header>
        {signals.length === 0 ? (
          <p className={styles.note}>
            Per l&apos;anno selezionato non ci sono segnali da relazioni ufficiali nel nostro
            ambito. Non significa che non ce ne siano: significa che qui non ne abbiamo ancora uno
            verificabile.
          </p>
        ) : null}

        <div className={styles.signals}>
          {signals.map((signal) => (
            <article className="panel" key={signal.id} data-tone={signal.tone}>
              <p className={styles.signalMeta}>
                <span>{signal.area} · {referencePeriod(signal.referenceDate)}</span>
                <span className={styles.signalTone} data-tone={signal.tone}>
                  {toneLabels[signal.tone]}
                </span>
              </p>
              <h3>{signal.label}</h3>
              <strong className={styles.signalValue}>{formatSignal(signal)}</strong>
              <p className={styles.signalMeaning}>{signal.plainMeaning}</p>
              <details className={styles.signalDetails}>
                <summary>Perimetro e stato del dato</summary>
                <dl>
                  <div>
                    <dt>Tipo di segnale</dt>
                    <dd>{auditClassifications[signal.classification].label}</dd>
                  </div>
                  <div>
                    <dt>Comprende</dt>
                    <dd>{signal.coverage}</dd>
                  </div>
                  <div>
                    <dt>Stato</dt>
                    <dd>{signal.evidenceStatus}</dd>
                  </div>
                </dl>
              </details>
              <footer>
                <span>{signal.caveat}</span>
                <a href={signal.source.url} target="_blank" rel="noreferrer">
                  {signal.source.institution} ↗
                </a>
              </footer>
            </article>
          ))}
        </div>
      </section>

      {showsMunicipalScreening && (
        <section className={`panel ${styles.derivedSection}`} aria-labelledby="municipal-screening-title">
          <header className={styles.sectionIntro}>
            <div>
              <span className={styles.derivedBadge}>Screening derivato · OpenCivitas</span>
              <h2 id="municipal-screening-title" className="panel-title">
                Comuni oltre la soglia regionale · dati {openCivitasSnapshot.referenceYear}
              </h2>
            </div>
            <p>
              Non è un esito ufficiale di controllo: ordiniamo le differenze per abitante rispetto
              alla spesa standard e segnaliamo i valori oltre la soglia di Tukey (1,5 × IQR) per
              Regione a statuto ordinario.
            </p>
          </header>

          <div className="stat-strip">
            <div>
              <span className="stat-label">Record usati per le soglie</span>
              <span className="stat-value">{integer(spendingOutliers.evaluatedMunicipalities)}</span>
              <span className="stat-note">
                {integer(spendingOutliers.notEvaluatedForSmallCohort)} non valutati in coorti sotto 4
              </span>
            </div>
            <div>
              <span className="stat-label">Valori oltre la soglia</span>
              <span className="stat-value">{integer(spendingOutliers.pagination.total)}</span>
              <span className="stat-note">
                su {integer(spendingOutliers.evaluatedMunicipalities)} record valutati
              </span>
            </div>
            <div>
              <span className="stat-label">Esclusi dalla fonte</span>
              <span className="stat-value">{integer(spendingOutliers.excludedForDataQuality)}</span>
              <span className="stat-note">campi monetari segnalati come non affidabili</span>
            </div>
          </div>

          {topSpendingOutliers.length > 0 ? (
            <div
              className={"table-scroll " + styles.outlierTable}
              role="region"
              aria-label="Screening derivato dei Comuni oltre la soglia regionale"
              tabIndex={0}
            >
              <table className="table">
                <caption>
                  {topSpendingOutliers.length} di {integer(spendingOutliers.pagination.total)}
                  {" "}risultati dello screening, ordinati per distanza dalla soglia per facilitare
                  la lettura · OpenCivitas {openCivitasSnapshot.referenceYear}
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Comune</th>
                    <th scope="col">Provincia · Regione</th>
                    <th scope="col" className="num">Differenza per abitante</th>
                    <th scope="col" className="num">Popolazione implicita</th>
                    <th scope="col">Distanza dalla soglia</th>
                  </tr>
                </thead>
                <tbody>
                  {topSpendingOutliers.map((outlier) => (
                    <tr key={outlier.istatCode}>
                      <th scope="row">
                        {municipalityName(outlier.name)}
                        <small>{outlier.istatCode}</small>
                      </th>
                      <td>
                        {municipalityName(outlier.province)} · {municipalityName(outlier.region)}
                      </td>
                      <td className="num">
                        {signedEuroFromCents(outlier.differencePerCapitaCents)}
                        <small>{outlier.direction === "sopra" ? "sopra" : "sotto"} la soglia</small>
                      </td>
                      <td className="num">
                        {outlier.impliedPopulation === null
                          ? "non disponibile"
                          : "~" + integer(outlier.impliedPopulation)}
                        <small>{populationBandLabels[outlier.populationBand]}</small>
                      </td>
                      <td>
                        {outlier.excessMultiple === null
                          ? "IQR = 0"
                          : number.format(outlier.excessMultiple) + " × IQR"}
                        <small>{signedEuroFromCents(outlier.distanceBeyondFenceCents)} oltre</small>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className={styles.note}>Nessun valore supera la soglia con i dati attuali.</p>
          )}

          <details className={styles.signalDetails}>
            <summary>Come teniamo conto delle dimensioni dei Comuni</summary>
            <p className={styles.note}>
              La soglia principale resta regionale. Come controllo di sensibilità, ripetiamo il
              calcolo dentro fasce di popolazione implicita; i gruppi con meno di 4 Comuni non
              producono una soglia. La popolazione in tabella è la media arrotondata delle due
              ricostruzioni totale ÷ per abitante. Resta una stima implicita, distinta da un
              dato demografico ISTAT.
            </p>
            <div className={"table-scroll " + styles.outlierTable} role="region" aria-label="Controllo di sensibilità per fascia di popolazione" tabIndex={0}>
              <table className="table">
                <caption>Controllo di sensibilità del metodo per fascia di popolazione implicita</caption>
                <thead>
                  <tr>
                    <th scope="col">Fascia</th>
                    <th scope="col" className="num">Coorti</th>
                    <th scope="col" className="num">Coorti valutate</th>
                    <th scope="col" className="num">Comuni valutati</th>
                    <th scope="col" className="num">Valori oltre soglia</th>
                  </tr>
                </thead>
                <tbody>
                  {spendingOutliers.sensitivityByPopulationBand.map((band) => (
                    <tr key={band.band}>
                      <th scope="row">{populationBandLabels[band.band]}</th>
                      <td className="num">{integer(band.cohorts)}</td>
                      <td className="num">{integer(band.evaluatedCohorts)}</td>
                      <td className="num">{integer(band.evaluatedMunicipalities)}</td>
                      <td className="num">{integer(band.outliers)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>

          <div className={styles.screeningMeta}>
            <strong>Provenienza e limiti</strong>
            <p>
              Snapshot OpenCivitas pubblicato il {longDate(openCivitasSnapshot.publishedAt)}, osservato
              il {longDate(openCivitasSnapshot.source.observedAt)} · {openCivitasSnapshot.coverage.territorialScope}.
              {" "}{spendingOutliers.methodologyWarning}{" "}{spendingOutliers.populationMethodWarning}{" "}
              <a href={openCivitasSnapshot.source.datasetUrl} target="_blank" rel="noreferrer">
                Apri il dataset ufficiale ↗
              </a>
            </p>
          </div>
          <p className={styles.note}>
            I risultati sono ordinati per distanza dalla soglia solo per facilitare la lettura.
          </p>
          <p className={styles.note}>
            Per il dettaglio di spesa storica, spesa standard e servizi consulta il{" "}
            <Link href="/territori/confronto">confronto tra Comuni →</Link>.
          </p>
        </section>
      )}

      <section className={`panel ${styles.relatedSection}`} aria-labelledby="appalti-related-title">
        <header className={styles.sectionIntro}>
          <h2 id="appalti-related-title">Appalti pubblici</h2>
          <p>
            Serie ANAC omogenee e confronti tra percentuali. Per CIG 2025 verificati e
            concentrazioni vicino alle soglie consulta la pagina dedicata.
          </p>
          <p className={styles.relatedLinks}>
            <Link href="/appalti">Apri Appalti 2025 →</Link>
            {" · "}
            <Link href="/incarichi">Incarichi pubblici →</Link>
          </p>
        </header>
        {comparison && comparisonValue !== null ? (
          <div className={styles.comparison}>
            <div>
              <span>
                <strong>{percent(comparison.byNumber)}</strong> delle procedure
              </span>
              <div className={styles.track} aria-hidden="true">
                <i style={{ width: `${comparison.byNumber}%` }} />
              </div>
              <p>{comparison.subject}, procedure da 40.000 euro in su, anno {comparison.year}.</p>
            </div>
            <div>
              <span>
                <strong>{percent(comparison.byValue)}</strong> del valore
              </span>
              <div className={styles.track} aria-hidden="true">
                <i style={{ width: `${comparison.byValue}%` }} />
              </div>
              <p>
                Circa {number.format(comparisonValue)} miliardi su {number.format(comparison.totalValueBillion)}.
              </p>
            </div>
          </div>
        ) : (
          <div className={styles.unavailable}>
            <strong>Dati annuali ANAC non disponibili per questo periodo.</strong>
            <p>
              {procurementAvailability?.message ??
                "Per questo periodo non abbiamo una serie ANAC annuale verificata."}
            </p>
          </div>
        )}

        <div
          className={`table-scroll ${styles.procurementTable}`}
          role="region"
          aria-label="Serie annuale degli affidamenti diretti ANAC"
          tabIndex={0}
        >
          <table className="table">
            <caption>Affidamenti diretti nelle relazioni annuali ANAC, stesso perimetro</caption>
            <thead>
              <tr>
                <th scope="col">Anno</th>
                <th scope="col">Procedure</th>
                <th scope="col" className="num">Quota sul numero</th>
                <th scope="col" className="num">Quota sul valore</th>
                <th scope="col">Fonte</th>
              </tr>
            </thead>
            <tbody>
              {procurementRows.map((row) => (
                <tr key={row.year}>
                  <th scope="row">{row.year}</th>
                  <td>{integer(row.procedureCount)}</td>
                  <td className="num">{percent(row.byNumber)}</td>
                  <td className="num">{percent(row.byValue)}</td>
                  <td>
                    <a href={row.sourceUrl} target="_blank" rel="noreferrer">
                      Pubblicata il {longDate(row.sourcePublishedAt)} ↗
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className={styles.note}>
          Una quota alta sul numero delle procedure può differire dalla quota sul valore. Il dato
          indica dove approfondire concorrenza e motivazioni.
        </p>
      </section>

      {showsProcurement2025 && (
        <section className="panel" aria-labelledby="procurement-2025-title">
          <h2 id="procurement-2025-title" className="panel-title">
            Appalti 2025: 55,3% e quasi 95% usano calcoli diversi
          </h2>
          <div className="stat-strip">
            <div>
              <span className="stat-label">Tutte le procedure da 40.000 euro in su</span>
              <span className="stat-value">{percent(procurementComparisons[2025].byNumber)}</span>
              <span className="stat-note">sono affidamenti diretti</span>
            </div>
            <div>
              <span className="stat-label">Studio ANAC su servizi e forniture</span>
              <span className="stat-value">
                {procurementServicesAndSupplies2025.directAwardShareQualifier}{" "}
                {percent(procurementServicesAndSupplies2025.directAwardShare)}
              </span>
              <span className="stat-note">dato ufficiale sugli affidamenti diretti</span>
            </div>
            <div>
              <span className="stat-label">Tra 135.000 e 140.000 euro nel 2025</span>
              <span className="stat-value">
                {integer(procurementServicesAndSupplies2025.thresholdBandCount2025)}
              </span>
              <span className="stat-note">acquisizioni indicate da ANAC</span>
            </div>
            <div>
              <span className="stat-label">Stessa fascia nel 2021</span>
              <span className="stat-value">
                {integer(procurementServicesAndSupplies2025.thresholdBandCount2021)}
              </span>
              <span className="stat-note">acquisizioni indicate da ANAC</span>
            </div>
          </div>
          <p className={styles.note}>
            Il {percent(procurementComparisons[2025].byNumber)} considera tutte le procedure da
            40.000 euro in su. Il quasi {percent(procurementServicesAndSupplies2025.directAwardShare)}
            viene da uno studio diverso di ANAC su servizi e forniture, con un perimetro più stretto.
            La concentrazione vicino alla soglia indica casi da approfondire.{" "}
            <a href={procurementServicesAndSupplies2025.sourceUrl} target="_blank" rel="noreferrer">
              Leggi la fonte ANAC ↗
            </a>
          </p>
          <details className={styles.signalDetails}>
            <summary>Come abbiamo controllato il quasi 95%</summary>
            <dl>
              <div>
                <dt>Che cosa scrive ANAC</dt>
                <dd>
                  Quasi il 95% nel gruppo specifico di contratti usato nel suo studio su servizi e
                  forniture.
                </dd>
              </div>
              <div>
                <dt>Che cosa otteniamo dai file aperti</dt>
                <dd>
                  {percent(procurementServicesAndSupplies2025.replicatedDirectAwardShare)} usando i
                  dodici file mensili 2025 disponibili il{" "}
                  {longDate(procurementServicesAndSupplies2025.replicationObservedAt)}. La differenza
                  può dipendere da rettifiche successive o da ulteriori dettagli del perimetro.
                </dd>
              </div>
              <div>
                <dt>Come lo presentiamo</dt>
                <dd>
                  Manteniamo il dato ufficiale e mostriamo separatamente il nostro controllo. Non
                  correggiamo i dati per farli coincidere.{" "}
                  <a
                    href={procurementServicesAndSupplies2025.replicationUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Vedi metodo e risultati ↗
                  </a>
                </dd>
              </div>
            </dl>
          </details>
        </section>
      )}

      {showsPolicyScenarios && (
        <>
          <section className={`panel ${styles.policySection}`} aria-labelledby="policy-scenarios-title">
            <header className={styles.sectionIntro}>
              <span className={styles.policyBadge}>
                {auditClassifications["policy-scenario"].label}
              </span>
              <h2 id="policy-scenarios-title" className="panel-title">
                Tre ipotesi di miglioramento annuale
              </h2>
              <p>{auditClassifications["policy-scenario"].plainMeaning}</p>
            </header>
            <div className={styles.scenarios}>
              {auditScenarios.map((scenario) => (
                <div key={scenario.id}>
                  <strong>{scenarioTotalNumber.format(scenario.annualBillion)} mld €</strong>
                  <span>Ipotesi {scenario.label.toLocaleLowerCase("it-IT")}</span>
                  <div className={styles.track} aria-hidden="true">
                    <i style={{ width: `${(scenario.annualBillion / maxScenario) * 100}%` }} />
                  </div>
                </div>
              ))}
            </div>
            <p className={styles.note}>
              Sono scenari di politica pubblica costruiti su ipotesi dichiarate.
            </p>
            <details className={styles.scenarioMethod}>
              <summary>Vedi formula e ipotesi</summary>
              <div
                className="table-scroll"
                role="region"
                aria-label="Ipotesi percentuali dei tre scenari"
                tabIndex={0}
              >
                <table className="table">
                  <caption>Percentuali applicate alle quattro basi del modello</caption>
                  <thead>
                    <tr>
                      <th scope="col">Scenario</th>
                      <th scope="col">Appalti</th>
                      <th scope="col">Agevolazioni fiscali</th>
                      <th scope="col">Personale sanitario esterno</th>
                      <th scope="col">Acquisti senza impegno</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(auditScenarioAssumptions).map(([id, assumptions]) => (
                      <tr key={id}>
                        <th scope="row">{assumptions.label}</th>
                        <td>
                          {percent(assumptions.procurementAuditedShare * 100)} analizzato,
                          {" "}{percent(assumptions.procurementEfficiencyRate * 100)} di miglioramento
                        </td>
                        <td>{percent(assumptions.taxReviewRate * 100)}</td>
                        <td>{percent(assumptions.healthcareReductionRate * 100)}</td>
                        <td>{percent(assumptions.debtPreventionRate * 100)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          </section>

          <section className={`panel ${styles.policySection}`}>
            <header className={styles.sectionIntro}>
              <span className={styles.policyBadge}>
                {auditClassifications["policy-scenario"].label}
              </span>
              <h2 className="panel-title">
                Composizione dell&apos;ipotesi centrale · {scenarioTotalNumber.format(centralTotal)} mld €
              </h2>
            </header>
            <ul className={styles.breakdown}>
              {centralScenarioBreakdown.map((item) => (
                <li key={item.label}>
                  <span>{item.label}</span>
                  <i aria-hidden="true">
                    <b style={{ width: `${(item.value / maxBreakdown) * 100}%` }} />
                  </i>
                  <b>{formatScenarioComponent(item.value)}</b>
                </li>
              ))}
            </ul>
            <p className={styles.note}>
              Sono stime costruite su ipotesi dichiarate. Le basi del modello sono quelle del dossier
              rivisto il {longDate(auditScenarioBasis.reviewedAt)}:
              {" "}{number.format(auditScenarioBasis.taxExpendituresBillion)} miliardi di agevolazioni fiscali,
              {" "}{number.format(auditScenarioBasis.reducedCompetitionBillion)} miliardi di appalti con confronto ridotto,
              {" "}{number.format(auditScenarioBasis.externalHealthcareStaffBillion * 1_000)} milioni di personale sanitario esterno
              e {number.format(auditScenarioBasis.purchasesWithoutPriorCommitmentBillion * 1_000)} milioni di acquisti senza impegno preventivo.
            </p>
          </section>
        </>
      )}

      <IntegratedSectionPreview
        section="controlli"
        title="Apri i registri da verificare"
        description="Segnalazioni, atti della Corte dei conti e working set restano separati per stato probatorio e portano alle fonti disponibili."
        hubHref="/trasparenza"
        limit={3}
      />

    </main>
  );
}
