import type { Metadata } from "next";
import Link from "next/link";
import { PublicDebtHistoryChart } from "@/components/charts/public-debt-history-chart";
import { compactEuro, exactEuro, longDate, percent } from "@/lib/format";
import { getPublicDebtView } from "@/lib/public-debt";
import styles from "./debito.module.css";

export const revalidate = 86_400;
export const metadata: Metadata = {
  title: "Debito pubblico italiano",
  description: "Stock, variazioni, detentori, scadenze e interessi del debito pubblico italiano da Banca d'Italia ed Eurostat.",
};

const TREASURY_URL = "https://www.dt.mef.gov.it/it/debito_pubblico/";
const euro = (cents: number) => cents / 100;
const sourceMillions = (cents: number) => (cents / 100_000_000).toLocaleString("it-IT", { maximumFractionDigits: 3 });
const signed = (cents: number) => `${cents >= 0 ? "+" : "−"}${compactEuro(Math.abs(euro(cents)))}`;
const bpPercent = (basisPoints: number) => percent(basisPoints / 100, 2);

type SourceAction = {
  href: string;
  label: string;
  ariaLabel: string;
};

function SourceRow({
  owner,
  release,
  title,
  detail,
  actions,
}: {
  owner: string;
  release: string;
  title: string;
  detail: string;
  actions: SourceAction[];
}) {
  return (
    <div className={styles.provenanceRow}>
      <div>
        <strong>{owner}</strong>
        <small>{release}</small>
      </div>
      <div>
        <span>{title}</span>
        <small>{detail}</small>
      </div>
      <div className={styles.provenanceActions}>
        {actions.map((action) => (
          <a
            href={action.href}
            key={action.href}
            target="_blank"
            rel="noreferrer"
            aria-label={action.ariaLabel}
          >
            {action.label} ↗
          </a>
        ))}
      </div>
    </div>
  );
}

export default function PublicDebtPage() {
  const data = getPublicDebtView();
  const { stock, change, holders, residualMaturity } = data;
  const annual = data.citizenImpact.annualInterest;
  const refinancing = data.citizenImpact.refinancingExposure;
  const composition = [
    { id: "currency", label: "Monete e depositi", cents: stock.instruments.currencyAndDepositsCents, share: stock.instrumentShares.currencyAndDepositsBasisPoints },
    { id: "securities", label: "Titoli", cents: stock.instruments.securitiesCents, share: stock.instrumentShares.securitiesBasisPoints },
    { id: "loans", label: "Prestiti e altre passività", cents: stock.instruments.loansAndOtherLiabilitiesCents, share: stock.instrumentShares.loansAndOtherLiabilitiesBasisPoints },
  ];
  const maturityBands = [
    { id: "one-year", label: "Fino a un anno", cents: residualMaturity.upToOneYearCents, share: residualMaturity.shares.upToOneYearBasisPoints },
    { id: "one-five-years", label: "Da uno a cinque anni", cents: residualMaturity.oneToFiveYearsCents, share: residualMaturity.shares.oneToFiveYearsBasisPoints },
    { id: "over-five-years", label: "Oltre cinque anni", cents: residualMaturity.overFiveYearsCents, share: residualMaturity.shares.overFiveYearsBasisPoints },
  ];
  const nominalDirection = annual.interestChangeCents > 0 ? "sono aumentati" : annual.interestChangeCents < 0 ? "sono diminuiti" : "sono rimasti invariati";
  const shareDirection = annual.interestShareChangeBasisPoints > 0 ? "è aumentata" : annual.interestShareChangeBasisPoints < 0 ? "è diminuita" : "è rimasta invariata";

  return (
    <main className="shell page">
      <header className="page-intro">
        <span className={styles.kicker}>Banca d’Italia + Eurostat · snapshot verificato</span>
        <h1>Il debito pubblico italiano, senza contatori stimati</h1>
        <p>Stock, variazioni, finanziamento, detentori, scadenze e interessi. I periodi restano separati perché le fonti non si aggiornano insieme.</p>
        <p className={styles.meta}>{data.measurement.precisionNote}</p>
      </header>

      <div className={`stat-strip ${styles.periodStrip}`} aria-label="Periodi dei dati">
        <div>
          <span className="stat-label">Stock al</span>
          <span className="stat-value">{longDate(stock.referenceDate)}</span>
          <span className="stat-note">Banca d’Italia · aggiornamento mensile</span>
        </div>
        <div>
          <span className="stat-label">Detentori al</span>
          <span className="stat-value">{longDate(holders.referenceDate)}</span>
          <span className="stat-note">Banca d’Italia · ultimo periodo completo</span>
        </div>
        <div>
          <span className="stat-label">Interessi</span>
          <span className="stat-value">{annual.referenceYear}</span>
          <span className="stat-note">Eurostat · aggiornamento annuale</span>
        </div>
      </div>

      <section className={`panel ${styles.section}`} aria-labelledby="quanto">
        <h2 className={styles.sectionTitle} id="quanto">1. Quanto debito c’è?</h2>
        <div className={styles.overviewGrid}>
          <div className={styles.hero}>
            <div className={styles.heroValue}>{compactEuro(euro(stock.totalCents))}</div>
            <div className={styles.exact}>{sourceMillions(stock.totalCents)} milioni di euro nella fonte</div>
            <p className={styles.change}>{signed(stock.changeCents)} rispetto al mese precedente · {stock.changeCents >= 0 ? "aumento" : "diminuzione"}</p>
            <p>Debito lordo della PA a fine mese secondo il perimetro Maastricht: non è la spesa dell’anno e non è una fattura individuale.</p>
            <p className={styles.meta}>Dato al {longDate(stock.referenceDate)} · fonte in milioni di euro, equivalente convertito per la visualizzazione · <a href={data.sources.bancaditalia.landingUrl} target="_blank" rel="noreferrer">Fonte: Banca d’Italia</a></p>
            {stock.freshness.state === "stale" && <p className="notice warning-notice"><strong>Aggiornamento in ritardo.</strong> Lo stock ha superato la soglia di 75 giorni.</p>}
          </div>
          <PublicDebtHistoryChart data={stock.history} />
        </div>
      </section>

      <section className={`panel ${styles.section}`} aria-labelledby="perche">
        <h2 className={styles.sectionTitle} id="perche">2. Perché è cambiato?</h2>
        <div className="stat-strip">
          <div><span className="stat-label">Fabbisogno di cassa</span><span className="stat-value">{signed(change.borrowingRequirementCents)}</span></div>
          <div><span className="stat-label">Contributo della liquidità</span><span className="stat-value">{signed(change.liquidityContributionCents)}</span></div>
          <div><span className="stat-label">Altri effetti</span><span className="stat-value">{signed(change.otherEffectsCents)}</span></div>
        </div>
        <p>La variazione dello stock riconcilia come <strong>fabbisogno + contributo della liquidità + scarti, indicizzazione e cambi = variazione del debito</strong>. Nella tavola BDS, transazioni in strumenti di debito ({signed(change.debtInstrumentTransactionsCents)}) + variazione grezza della liquidità ({signed(change.rawLiquidityChangeCents)}) = fabbisogno.</p>
        <p>Il deficit di competenza e il fabbisogno di cassa non coincidono necessariamente nello stesso periodo. Questi sono flussi netti del mese e non identificano da soli una singola decisione politica o voce di spesa.</p>
        <p className={styles.meta}>Dato al {longDate(change.referenceDate)} · unità: euro · formula riconciliata · <a href={data.sources.bancaditalia.bdsUrl} target="_blank" rel="noreferrer">Fonte: BDS Banca d’Italia</a></p>
      </section>

      <section className={`panel ${styles.section}`} aria-labelledby="serve">
        <h2 className={styles.sectionTitle} id="serve">3. A cosa serve e come viene rimborsato?</h2>
        <ol className={styles.sequence} aria-label="Sequenza di finanziamento e rimborso">
          <li>Pagamenti superiori agli incassi nel periodo</li>
          <li>Fabbisogno di cassa</li>
          <li>Titoli, prestiti e liquidità finanziano il fabbisogno</li>
          <li>Alla scadenza il capitale viene rimborsato</li>
          <li>Nuove emissioni possono sostituire titoli scaduti</li>
        </ol>
        <div className={styles.gridTwo}>
          <article className={styles.card}><h3>Emissioni nette a breve</h3><strong>{signed(change.netShortTermSecuritiesCents)}</strong><p>{exactEuro(euro(change.netShortTermSecuritiesCents))}</p></article>
          <article className={styles.card}><h3>Emissioni nette a medio-lungo termine</h3><strong>{signed(change.netMediumLongTermSecuritiesCents)}</strong><p>{exactEuro(euro(change.netMediumLongTermSecuritiesCents))}</p></article>
        </div>
        <p><strong>Netto significa emissioni meno rimborsi.</strong> Un valore positivo non è il totale collocato; un valore negativo indica che nel mese i rimborsi hanno superato le emissioni per quella classe.</p>
        <p>Il dataset mostra finanziamento e rinnovi, non la destinazione di ogni euro raccolto. I pagamenti del Bilancio dello Stato si osservano separatamente nella pagina <Link href="/stato">Amministrazioni centrali</Link>.</p>
        <p className={styles.meta}>Flussi del mese terminato il {longDate(change.referenceDate)} · unità: euro · <a href={data.sources.bancaditalia.bdsUrl} target="_blank" rel="noreferrer">Fonte: BDS Banca d’Italia</a></p>
      </section>

      <section className={`panel ${styles.section}`} aria-labelledby="composto">
        <h2 className={styles.sectionTitle} id="composto">4. Da cosa è composto?</h2>
        <p>Le tre componenti sommano allo stock dello stesso mese. Le quote sono calcolate come importo della componente diviso per debito totale.</p>
        <ul className={styles.barList} aria-label="Composizione del debito">
          {composition.map((item) => <li key={item.id}><div><strong>{item.label}</strong><span>{bpPercent(item.share)}</span></div><span className={styles.bar} aria-hidden="true"><span style={{ width: `${item.share / 100}%` }} /></span></li>)}
        </ul>
        <div className={styles.tableWrap} role="region" aria-label="Composizione del debito in euro convertiti" tabIndex={0}>
          <table className="table"><caption className="table-caption">Composizione dello stock di debito per strumento</caption><thead><tr><th scope="col">Strumento</th><th scope="col" className="num">Importo</th><th scope="col" className="num">Quota</th></tr></thead><tbody>{composition.map((item) => <tr key={item.id}><th scope="row">{item.label}</th><td className="num">{exactEuro(euro(item.cents))}</td><td className="num">{bpPercent(item.share)}</td></tr>)}</tbody></table>
        </div>
        <p className={styles.meta}>Dato al {longDate(stock.referenceDate)} · unità: euro e percentuale dello stock · formula: componente / totale · <a href={data.sources.bancaditalia.bdsUrl} target="_blank" rel="noreferrer">Fonte: BDS Banca d’Italia</a></p>
      </section>

      <section className={`panel ${styles.section}`} aria-labelledby="detiene">
        <h2 className={styles.sectionTitle} id="detiene">5. Chi lo detiene?</h2>
        <p>Dato al {longDate(holders.referenceDate)}: la pubblicazione dei detentori è più lenta dello stock e non viene riempita in avanti.</p>
        <div className={styles.tableWrap} role="region" aria-label="Detentori del debito" tabIndex={0}>
          <table className="table"><caption className="table-caption">Detentori dello stock di debito per settore</caption><thead><tr><th scope="col">Settore</th><th scope="col" className="num">Importo</th><th scope="col" className="num">Quota</th></tr></thead><tbody>{holders.sectors.map((sector) => <tr key={sector.id}><th scope="row">{sector.label}</th><td className="num">{exactEuro(euro(sector.amountCents))}</td><td className="num">{bpPercent(sector.shareBasisPoints)}</td></tr>)}</tbody></table>
        </div>
        <ul className={styles.caveats}>
          <li>Sono settori istituzionali, non singoli investitori o necessariamente singoli paesi.</li>
          <li>“Altri residenti” non equivale alle sole famiglie.</li>
          <li>Gli acquisti della BCE e di altre banche centrali dell’Eurosistema possono apparire tra i non residenti.</li>
        </ul>
        <p className={styles.meta}>Unità: euro e percentuale del totale della sezione · <a href={data.sources.bancaditalia.bdsUrl} target="_blank" rel="noreferrer">Fonte: BDS Banca d’Italia</a></p>
      </section>

      <section className={`panel ${styles.section}`} aria-labelledby="rifinanziato">
        <h2 className={styles.sectionTitle} id="rifinanziato">6. Quando deve essere rifinanziato?</h2>
        <ul className={styles.barList} aria-label="Debito per vita residua">
          {maturityBands.map((item) => <li key={item.id}><div><strong>{item.label}</strong><span>{bpPercent(item.share)}</span></div><span className={styles.bar} aria-hidden="true"><span style={{ width: `${item.share / 100}%` }} /></span></li>)}
        </ul>
        <div className={styles.tableWrap} role="region" aria-label="Vita residua del debito in euro convertiti" tabIndex={0}>
          <table className="table"><caption className="table-caption">Stock di debito per vita residua</caption><thead><tr><th scope="col">Vita residua</th><th scope="col" className="num">Importo</th><th scope="col" className="num">Quota</th></tr></thead><tbody>{maturityBands.map((item) => <tr key={item.id}><th scope="row">{item.label}</th><td className="num">{exactEuro(euro(item.cents))}</td><td className="num">{bpPercent(item.share)}</td></tr>)}</tbody></table>
        </div>
        <p>Vita media residua: <strong>{residualMaturity.averageYears.toLocaleString("it-IT")} anni</strong>. Le fasce sommano al totale del {longDate(residualMaturity.referenceDate)}.</p>
        <p>“Fino a un anno” non è una previsione di crisi né il calendario delle singole aste: misura quanto stock entra presto nella finestra di rifinanziamento.</p>
        <p className={styles.meta}>Unità: euro, percentuale dello stock e anni · <a href={data.sources.bancaditalia.bdsUrl} target="_blank" rel="noreferrer">Fonte: BDS Banca d’Italia</a></p>
      </section>

      <section className={`panel ${styles.section}`} aria-labelledby="vita">
        <h2 className={styles.sectionTitle} id="vita">7. Come può incidere sulla tua vita?</h2>
        <p className={styles.impactIntro}>I dati non dicono che domani aumenteranno le tasse o diminuiranno i servizi. Mostrano però quante risorse assorbono oggi gli interessi e quanto rapidamente le nuove condizioni di finanziamento possono entrare nei conti pubblici.</p>
        <p>Il debito non è una fattura individuale e questi dati non mostrano da soli chi lo “ha creato”.</p>
        {annual.freshness.state === "stale" && <p className="notice warning-notice"><strong>Aggiornamento in ritardo.</strong> Il dato annuale ha superato la soglia di 540 giorni dalla fine dell’anno di riferimento.</p>}
        <div className={styles.impact}>
          <article>
            <h3>Quanto pesa il costo degli interessi</h3>
            <h4>Cosa vediamo</h4>
            <p>{compactEuro(euro(annual.interestExpenseCents))} ({exactEuro(euro(annual.interestExpenseCents))}) nel {annual.referenceYear}, pari a <strong>{annual.euroPerHundredEuro.toLocaleString("it-IT", { minimumFractionDigits: 2 })} euro di interessi ogni 100 euro di spesa pubblica totale</strong>. Il denominatore è {exactEuro(euro(annual.totalGovernmentExpenditureCents))}. Fonte Eurostat, unità: euro.</p>
            <p className={styles.formula}>Formula: <code>D41PAY / TE × 100</code></p>
            <h4>Come funziona</h4>
            <p>Se questa quota cresce, una parte maggiore della spesa pubblica è assorbita dagli interessi e resta meno flessibilità per altre decisioni di bilancio.</p>
            <h4>Come può arrivare alla tua vita</h4>
            <p>Una minore flessibilità può restringere le alternative disponibili quando si decidono servizi, imposte e investimenti.</p>
            <h4>Cosa non dimostra</h4>
            <p>Il dato, da solo, non prova che un servizio verrà tagliato o che una tassa aumenterà.</p>
          </article>
          <article>
            <h3>Il peso sta aumentando o diminuendo?</h3>
            <h4>Cosa vediamo</h4>
            <p>Rispetto al {annual.previousYear}, gli interessi {nominalDirection}: {signed(annual.interestChangeCents)}. La quota sulla spesa totale {shareDirection}: {annual.interestShareChangeBasisPoints >= 0 ? "+" : "−"}{Math.abs(annual.interestShareChangeBasisPoints / 100).toLocaleString("it-IT", { minimumFractionDigits: 2 })} punti percentuali. Fonte Eurostat, unità: euro e punti percentuali.</p>
            <div className={styles.tableWrap} role="region" aria-label="Interessi e spesa pubblica per anno" tabIndex={0}>
              <table className="table"><caption className="table-caption">Interessi e spesa pubblica per anno</caption><thead><tr><th scope="col">Anno</th><th scope="col" className="num">Interessi</th><th scope="col" className="num">Spesa totale</th><th scope="col" className="num">Quota</th></tr></thead><tbody>{annual.history.map((point) => <tr key={point.year}><th scope="row">{point.year}</th><td className="num">{exactEuro(euro(point.interestExpenseCents))}</td><td className="num">{exactEuro(euro(point.totalGovernmentExpenditureCents))}</td><td className="num">{bpPercent(point.interestShareBasisPoints)}</td></tr>)}</tbody></table>
            </div>
            <h4>Come funziona</h4>
            <p>Importo nominale e quota possono muoversi in direzioni diverse perché cambia anche la spesa totale; il confronto mostra entrambe le direzioni senza sceglierne una come più allarmante.</p>
            <h4>Come può arrivare alla tua vita</h4>
            <p>Una quota più alta può ridurre la flessibilità delle decisioni future su servizi, imposte e investimenti.</p>
            <h4>Cosa non dimostra</h4>
            <p>Il confronto osservato non prevede tasse, servizi o tassi futuri e i valori Eurostat possono essere rivisti.</p>
          </article>
          <article>
            <h3>Quanto rapidamente possono cambiare i costi</h3>
            <h4>Cosa vediamo</h4>
            <p>{bpPercent(refinancing.upToOneYearShareBasisPoints)} dello stock ha vita residua fino a un anno; vita media {refinancing.averageYears.toLocaleString("it-IT")} anni, al {longDate(refinancing.referenceDate)}. Fonte Banca d’Italia, unità: percentuale e anni.</p>
            <h4>Come funziona</h4>
            <p>Quando una parte maggiore del debito deve essere rifinanziata presto, i tassi delle nuove emissioni possono trasferirsi più rapidamente sulla spesa futura per interessi. Una durata media più lunga rallenta questo passaggio, ma non elimina il rischio.</p>
            <h4>Come può arrivare alla tua vita</h4>
            <p>Una spesa per interessi meno prevedibile può ridurre la flessibilità per servizi, imposte e investimenti.</p>
            <h4>Cosa non dimostra</h4>
            <p>Non collega automaticamente il dato a mutui, inflazione o decisioni della BCE e non è una previsione.</p>
          </article>
        </div>
      </section>

      <section className={styles.provenanceSection} aria-labelledby="fonti-originali">
        <div className={styles.provenanceHeader}>
          <h2 id="fonti-originali">Apri sempre il dato originale</h2>
          <p>I link portano ai dati e alle pagine ufficiali usati per costruire questa pagina.</p>
        </div>

        <div className={styles.provenanceList}>
          <SourceRow
            owner="Banca d’Italia"
            release="Rilascio mensile · 4 cubi BDS"
            title={data.sources.bancaditalia.title}
            detail={`Stock al ${longDate(stock.referenceDate)} · accesso ${longDate(data.sources.bancaditalia.accessedAt)} · importi originari in milioni di euro`}
            actions={[
              { href: data.sources.bancaditalia.bdsUrl, label: "BDS", ariaLabel: "Apri la Base Dati Statistica di Banca d’Italia (si apre in una nuova scheda)" },
              { href: data.sources.bancaditalia.landingUrl, label: "Report", ariaLabel: "Apri i report sul debito di Banca d’Italia (si apre in una nuova scheda)" },
              { href: data.sources.bancaditalia.termsUrl, label: "Riuso", ariaLabel: "Apri le condizioni di utilizzo di Banca d’Italia (si apre in una nuova scheda)" },
            ]}
          />
          <SourceRow
            owner="Eurostat"
            release="Aggiornamento annuale · gov_10a_main"
            title={data.sources.eurostat.title}
            detail={`Serie D41PAY e TE · fonte aggiornata il ${longDate(data.sources.eurostat.upstreamUpdatedAt)} · accesso ${longDate(data.sources.eurostat.accessedAt)} · importi originari in milioni di euro`}
            actions={[
              { href: data.sources.eurostat.datasetUrl, label: "Dataset", ariaLabel: "Apri il Data Browser Eurostat per gov_10a_main (si apre in una nuova scheda)" },
              { href: data.sources.eurostat.termsUrl, label: "Riuso", ariaLabel: "Apri le condizioni di riuso Eurostat (si apre in una nuova scheda)" },
            ]}
          />
          <SourceRow
            owner="Dipartimento del Tesoro"
            release="Metodo · finanziamento e rimborso"
            title="Debito pubblico e gestione dei titoli di Stato"
            detail="Spiegazione istituzionale di emissioni, scadenze e rischio di rifinanziamento"
            actions={[
              { href: TREASURY_URL, label: "Tesoro", ariaLabel: "Apri la pagina Debito pubblico del Dipartimento del Tesoro (si apre in una nuova scheda)" },
            ]}
          />
        </div>

        <div className={styles.provenanceNotes}>
          <p>{data.measurement.transformation}</p>
          <p>Attribuzioni: {data.sources.bancaditalia.attribution} {data.sources.eurostat.attribution}</p>
          <p>Quote, variazioni e riconciliazioni sono elaborazioni dichiarate di DoveVannoINostriSoldi; i dati recenti possono essere provvisori e soggetti a revisione.</p>
          {data.caveats.map((item) => <p key={item}>{item}</p>)}
        </div>
      </section>
    </main>
  );
}
