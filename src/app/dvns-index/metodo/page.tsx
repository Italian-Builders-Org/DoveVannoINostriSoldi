import type { Metadata } from "next";
import Link from "next/link";

import { BANDS, FUNCTION_LABELS, PILLAR_LABELS, PILLARS, describeGroup, explainEntry, regionName, regionVarianceShare, stabilityByBand } from "@/lib/dvns-index";
import { IndexSnapshotUnavailableError, loadDvnsIndex, type IndexData } from "@/lib/dvns-index-store";

import styles from "../dvns-index.module.css";

export const metadata: Metadata = {
  title: "DVNS Index, il metodo: dati, regole e calcolo passo per passo",
  description:
    "Come si calcola il DVNS Index: quali dati ufficiali usa (OpenCivitas, SIOPE, ANAC, Ragioneria Generale dello Stato, ISPRA, ISTAT), come confronta ogni Comune con quelli simili, pesi, fasce, solidità, limiti e quanto fidarsi, con un esempio completo.",
  alternates: { canonical: "/dvns-index/metodo" },
};

// Numbers come from the same verified snapshot as the index page, read once per instance.
export const dynamic = "force-dynamic";

const integer = new Intl.NumberFormat("it-IT", { maximumFractionDigits: 0, useGrouping: "always" });
const one = new Intl.NumberFormat("it-IT", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const EXAMPLE_ISTAT = "037006";

function Unavailable() {
  return (
    <main className="shell page">
      <div className="page-intro">
        <h1>DVNS Index, il metodo</h1>
        <p>Dati temporaneamente non disponibili: senza lo snapshot verificato non mostriamo numeri.</p>
      </div>
    </main>
  );
}

export default async function DvnsIndexMethodPage() {
  let data: IndexData;
  try {
    data = await loadDvnsIndex();
  } catch (error) {
    if (error instanceof IndexSnapshotUnavailableError) return <Unavailable />;
    throw error;
  }
  const { snapshot } = data;
  const { rules, summary } = snapshot;
  const example = data.byIstat.get(EXAMPLE_ISTAT) ?? null;
  const exampleParts = example ? explainEntry(example, rules) : [];
  const exampleGroup = example?.group === null || example?.group === undefined ? null : snapshot.groups[example.group];
  const weight = (pillar: (typeof PILLARS)[number]) => `${Math.round(rules.weights[pillar] * 100)}%`;
  const share = (value: number | null | undefined) => (value === null || value === undefined ? "n.d." : `${Math.round(value * 100)}%`);
  const byBand = stabilityByBand(snapshot.entries);
  const regionScore = regionVarianceShare(snapshot.entries, (entry) => entry.score);
  const regionDelay = regionVarianceShare(snapshot.entries, (entry) => entry.pillars.puntualita ?? null);
  const exampleRegional = example ? data.regional.get(example.istat) : undefined;

  return (
    <main className="shell page">
      <div className="page-intro">
        <nav className={styles.breadcrumb} aria-label="Percorso">
          <Link href="/dvns-index">DVNS Index</Link>
          <span aria-hidden="true">/</span>
          <span>Metodo</span>
        </nav>
        <h1>Come si calcola il DVNS Index</h1>
        <p>
          Il DVNS Index dà a ogni Comune un punteggio da 0 a 100 che risponde a una domanda: rispetto ai Comuni simili,
          come spende i suoi soldi? Ha due componenti. La prima è oggettiva: dati ufficiali che chiunque può scaricare e
          verificare. La seconda è un indicatore: le regole con cui stabiliamo cosa conta come &quot;meglio&quot; e quanto
          pesa ogni aspetto. Le regole sono scelte nostre e sono tutte scritte in questa pagina.
        </p>
      </div>

      <div className={styles.methodBody}>
        <section className="panel" aria-labelledby="breve">
          <h2 id="breve" className="panel-title">In breve</h2>
          <ol className={styles.steps}>
            <li>Raccogliamo per ogni Comune sei misure da fonti ufficiali: servizi in rapporto alla spesa, spesa oltre il fabbisogno, investimenti, apertura degli appalti, tempi di pagamento dei fornitori, raccolta differenziata.</li>
            <li>Confrontiamo ogni misura con quella dei Comuni simili per dimensione e territorio, e la trasformiamo in un punteggio da 0 a 100.</li>
            <li>Facciamo la media pesata dei sei punteggi: questo è il DVNS Index.</li>
            <li>Ordiniamo i Comuni e li dividiamo in cinque fasce, da A a E, con un quinto dei Comuni ciascuna.</li>
            <li>Ricalcoliamo tutto {integer.format(rules.sensitivity.draws)} volte con pesi diversi, per dire quanto è solida la fascia di ogni Comune.</li>
          </ol>
        </section>

        <section className="panel" aria-labelledby="dati">
          <h2 id="dati" className="panel-title">I dati</h2>
          <div className="table-scroll" role="region" aria-labelledby="dati-tabella" tabIndex={0}>
            <table className={`table ${styles.methodTable}`}>
              <caption id="dati-tabella" className="table-caption">Fonti ufficiali usate dall&apos;indice</caption>
              <thead>
                <tr><th scope="col">Fonte</th><th scope="col">Cosa usiamo</th><th scope="col">Periodo</th><th scope="col">Copertura</th></tr>
              </thead>
              <tbody>
                <tr>
                  <th scope="row">OpenCivitas (MEF e SOSE)</th>
                  <td>Spesa storica, fabbisogno standard e livello dei servizi di ogni Comune, sul totale e per sei funzioni: {Object.values(FUNCTION_LABELS).join(", ")}.</td>
                  <td>2021 e 2022, gli ultimi anni pubblicati</td>
                  <td>Comuni delle 15 Regioni a statuto ordinario</td>
                </tr>
                <tr>
                  <th scope="row">SIOPE (Ragioneria Generale dello Stato e Banca d&apos;Italia)</th>
                  <td>Pagamenti di cassa per spesa corrente e investimenti (titoli 1 e 2 del bilancio).</td>
                  <td>2024 e 2025</td>
                  <td>Tutti i Comuni con movimenti</td>
                </tr>
                <tr>
                  <th scope="row">ANAC, CIG</th>
                  <td>Le {integer.format(summary.anacProcedures)} procedure pubblicate nel 2025: importo e modo di scelta del contraente.</td>
                  <td>2025</td>
                  <td>Tutte le stazioni appaltanti</td>
                </tr>
                <tr>
                  <th scope="row">ANAC, aggiudicazioni</th>
                  <td>A chi vanno i contratti: importo aggiudicato per operatore economico.</td>
                  <td>CIG 2025</td>
                  <td>Aggiudicazioni con un unico operatore</td>
                </tr>
                <tr>
                  <th scope="row">Piattaforma dei crediti commerciali (Ragioneria Generale dello Stato)</th>
                  <td>Tempo medio ponderato di ritardo nel pagamento delle fatture commerciali.</td>
                  <td>Fatture pagate nel 2024 e nel 2025</td>
                  <td>Tutti i Comuni censiti nell&apos;Indice delle PA</td>
                </tr>
                <tr>
                  <th scope="row">ISPRA, Catasto rifiuti</th>
                  <td>Percentuale di raccolta differenziata di ogni Comune.</td>
                  <td>2022 e 2023</td>
                  <td>Tutti i Comuni</td>
                </tr>
                <tr>
                  <th scope="row">ISTAT SITUAS</th>
                  <td>Popolazione, superficie, zona altimetrica, grado di urbanizzazione, costa e isole: servono a trovare i Comuni simili.</td>
                  <td>Ultima geografia pubblicata</td>
                  <td>Tutti i Comuni</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className={styles.lede}>
            I file sono scaricati dalle fonti, verificati con la loro impronta SHA-256 e mai modificati. Se un file cambia
            senza che lo abbiamo controllato, il calcolo si ferma invece di pubblicare numeri sbagliati.
          </p>
        </section>

        <section className="panel" aria-labelledby="pilastri">
          <h2 id="pilastri" className="panel-title">I sei pilastri</h2>
          <div className={styles.pillarMethod}>
            <article>
              <h3>01 · {PILLAR_LABELS.resa.title} <span>peso {weight("resa")}</span></h3>
              <p className={styles.question}>{PILLAR_LABELS.resa.question}</p>
              <p><strong>Misura.</strong> Servizi rispetto alla media dei Comuni della stessa fascia di popolazione, meno spesa rispetto al fabbisogno standard. Entrambi i valori sono pubblicati da OpenCivitas, in percentuale.</p>
              <p><strong>Esempio.</strong> Un Comune con il 20% di servizi in più e il 5% di spesa in più ottiene +15. Uno con il 10% di servizi in meno e la spesa in linea ottiene −10.</p>
              <p><strong>Regola.</strong> Più servizi per ogni euro è meglio. Usiamo la media del 2021 e del 2022, così un anno anomalo pesa meno. È il pilastro più importante perché è il più vicino alla domanda &quot;cosa ottengo per quello che spendo&quot;.</p>
              <p><strong>Spesa bassa non è sempre efficienza.</strong> Un Comune può spendere meno del fabbisogno perché è bravo o perché non ha i soldi. Per distinguere i due casi guardiamo i tempi di pagamento: se il Comune paga i fornitori in ritardo, la spesa sotto il fabbisogno non dà punti e conta solo il livello dei servizi. Oggi la regola si applica a {integer.format(summary.underspendWithoutCredit)} Comuni.</p>
            </article>
            <article>
              <h3>02 · {PILLAR_LABELS.sovraspesa.title} <span>peso {weight("sovraspesa")}</span></h3>
              <p className={styles.question}>{PILLAR_LABELS.sovraspesa.question}</p>
              <p><strong>Misura.</strong> La parte di spesa oltre il fabbisogno standard che non è coperta da servizi sopra la media.</p>
              <p><strong>Esempio.</strong> Spesa +30% e servizi +40%: nessuna penalità. Spesa +30% e servizi +10%: penalità di 20 punti. Spesa sotto il fabbisogno: nessuna penalità.</p>
              <p><strong>Regola.</strong> Chi spende di più per offrire di più non viene penalizzato. Viene penalizzato solo chi spende di più senza dare di più.</p>
              <p><strong>Perché non sempre 100.</strong> Molti Comuni non hanno spesa non giustificata e sono a pari merito. Nel percentile i pari merito contano a metà, quindi chi non ha penalità ottiene circa 55-65 e non 100: il pilastro distingue soprattutto chi spende troppo.</p>
            </article>
            <article>
              <h3>03 · {PILLAR_LABELS.investire.title} <span>peso {weight("investire")}</span></h3>
              <p className={styles.question}>{PILLAR_LABELS.investire.question}</p>
              <p><strong>Misura, per metà.</strong> Pagamenti per investimenti divisi per la somma di spesa corrente e investimenti, sommando il 2024 e il 2025.</p>
              <p><strong>Misura, per l&apos;altra metà.</strong> Euro investiti per abitante all&apos;anno, nella media dei due anni. Senza questa parte un Comune con pochissima spesa corrente sembrerebbe un grande investitore anche investendo poco.</p>
              <p><strong>Regola.</strong> Più investimenti è meglio: scuole, strade e impianti restano ai cittadini anche negli anni successivi. Sommiamo due anni perché un&apos;opera finita da poco non decida da sola il voto. Il rimborso dei debiti non entra nel calcolo: rimborsare è un comportamento corretto, non va né premiato né penalizzato.</p>
            </article>
            <article>
              <h3>04 · {PILLAR_LABELS.appalti.title} <span>peso {weight("appalti")}</span></h3>
              <p className={styles.question}>{PILLAR_LABELS.appalti.question}</p>
              <p><strong>Misura, per il 60%.</strong> La quota del valore delle procedure da almeno {integer.format(rules.procurementThresholdEuro)} € assegnata con affidamento diretto o con procedura negoziata senza bando.</p>
              <p><strong>Misura, per il 40%.</strong> Quanto il valore aggiudicato si concentra su pochi fornitori, con l&apos;indice di Herfindahl-Hirschman, usato anche dalle autorità della concorrenza. Escludiamo rifiuti, energia e acqua (divisioni CPV {rules.concentrationExcludedCpvDivisions.join(", ")}): in questi servizi un solo gestore per territorio è normale e non dice nulla sulle scelte del Comune.</p>
              <p><strong>Regola.</strong> Meno concentrazione e meno procedure senza gara è meglio. Non contano le adesioni alle convenzioni Consip, perché la gara si è già svolta a monte, né gli affidamenti alle società in house del Comune. Le procedure delegate a una centrale di committenza restano del Comune che le ha delegate.</p>
              <p><strong>Pochi appalti.</strong> Servono almeno {rules.minProcedures} procedure o {rules.minAwards} aggiudicazioni. Quando sono poche, un solo contratto sposta molto la quota: per questo avviciniamo il valore alla mediana nazionale ({one.format(summary.medianWithoutTenderShare)}% del valore senza gara) in proporzione a quanti dati mancano. Con 5 procedure il valore si sposta molto, con 200 quasi per niente. Un Comune che non arriva nemmeno alle soglie minime prende 50, la media: con zero procedure la stessa regola darebbe esattamente la mediana. Oggi succede a {integer.format(summary.appaltiNeutral)} Comuni in classifica, quasi tutti piccoli; la scheda di ognuno lo segnala.</p>
            </article>
            <article>
              <h3>05 · {PILLAR_LABELS.puntualita.title} <span>peso {weight("puntualita")}</span></h3>
              <p className={styles.question}>{PILLAR_LABELS.puntualita.question}</p>
              <p><strong>Misura.</strong> Il ritardo medio con cui il Comune paga le fatture rispetto alla scadenza, ponderato sull&apos;importo, nella media del 2024 e del 2025. Un valore negativo vuol dire che paga in anticipo.</p>
              <p><strong>Regola.</strong> Meno ritardo è meglio. La legge chiede di pagare entro 30 giorni, 60 per alcune forniture. È un dato contabile, registrato fattura per fattura dalla Ragioneria Generale dello Stato: il Comune non lo dichiara, lo produce pagando.</p>
              <p><strong>Errori di registrazione.</strong> Un pagamento più di {integer.format(rules.implausibleEarlyPaymentDays)} giorni prima della scadenza vorrebbe dire pagare prima di ricevere la fattura: è una scadenza registrata male. Quell&apos;anno non viene usato ({integer.format(summary.implausibleDelays)} casi, per esempio un Comune risultava pagare con 771 giorni di anticipo).</p>
              <p><strong>Perché conta.</strong> Un Comune che paga tardi scarica i suoi problemi di cassa sulle imprese, spesso piccole e locali. E serve a leggere gli altri pilastri: spendere poco pagando tardi non è efficienza.</p>
            </article>
            <article>
              <h3>06 · {PILLAR_LABELS.risultati.title} <span>peso {weight("risultati")}</span></h3>
              <p className={styles.question}>{PILLAR_LABELS.risultati.question}</p>
              <p><strong>Misura.</strong> La percentuale di raccolta differenziata calcolata da ISPRA, nella media del 2022 e del 2023.</p>
              <p><strong>Regola.</strong> Più alta è meglio. L&apos;obiettivo di legge è il 65%.</p>
              <p><strong>Perché questo dato.</strong> Gli altri pilastri misurano quanto si spende e come. Questo misura un risultato, rilevato da un ente terzo per tutti i Comuni con lo stesso metodo. È un solo servizio e non rappresenta tutto, ma è il risultato misurato più completo che esiste oggi per gli 8.000 Comuni. Pesa poco proprio per questo.</p>
            </article>
          </div>
        </section>

        <section className="panel" aria-labelledby="confronto">
          <h2 id="confronto" className="panel-title">Il confronto tra Comuni simili</h2>
          <p className={styles.lede}>
            Confrontare Milano con un paese di montagna non avrebbe senso. Ogni Comune viene confrontato con i Comuni che
            hanno la stessa fascia di popolazione e di superficie, la stessa zona altimetrica, lo stesso grado di
            urbanizzazione e la stessa posizione rispetto a costa e isole. Contano solo i Comuni coperti da OpenCivitas:
            se sono meno di {integer.format(rules.minPeers)}, allarghiamo il gruppo togliendo un criterio alla volta. Con
            pochi Comuni il confronto è troppo grossolano: essere il migliore su 7 vale già 100, anche con risultati
            soltanto buoni. Le città con almeno 100.000 abitanti si confrontano sempre tra loro.
          </p>
          <p className={styles.lede}>
            Dentro il gruppo ogni misura diventa un percentile: 70 vuol dire che il Comune fa meglio del 70% dei Comuni
            simili. Per questo il punteggio finale è già corretto per dimensione e territorio, e la classifica nazionale
            mette a confronto posizioni relative, non euro.
          </p>
        </section>

        <section className="panel" aria-labelledby="punteggio">
          <h2 id="punteggio" className="panel-title">Punteggio, fasce e solidità</h2>
          <ul className={styles.criteria}>
            <li><strong>Punteggio.</strong> Media pesata dei sei percentili: {weight("resa")} resa della spesa, {weight("sovraspesa")} spesa non giustificata, {weight("investire")} capacità di investire, {weight("appalti")} apertura degli appalti, {weight("puntualita")} puntualità nei pagamenti, {weight("risultati")} raccolta differenziata.</li>
            <li><strong>Classifica.</strong> Entrano i Comuni con tutti i pilastri, contando come presenti gli appalti neutri, e con dati sui servizi coerenti tra il 2021 e il 2022: oggi {integer.format(summary.ranked)}. Gli altri hanno un punteggio parziale ({integer.format(summary.partial)}, di cui {integer.format(summary.volatile)} per servizi dichiarati troppo variabili) oppure non sono valutabili ({integer.format(summary.specialStatute)} nelle Regioni a statuto speciale, che OpenCivitas non copre).</li>
            <li><strong>Fasce.</strong> A raccoglie il 20% migliore, E il 20% peggiore. Le soglie attuali sono: A da {one.format(summary.bandCutoffs[0])}, B da {one.format(summary.bandCutoffs[1])}, C da {one.format(summary.bandCutoffs[2])}, D da {one.format(summary.bandCutoffs[3])}. La fascia conta più della posizione esatta: tra il 1.200° e il 1.250° posto la differenza è piccola.</li>
            <li><strong>Posizione nella Regione.</strong> Ogni scheda mostra anche la posizione tra i Comuni della stessa Regione. Aiuta a separare &quot;fa bene per il contesto in cui si trova&quot; da &quot;fa bene in assoluto&quot;.</li>
            <li><strong>Intervallo di posizione.</strong> Dagli stessi ricalcoli ricaviamo dove cade la posizione di ogni Comune escludendo il 5% dei casi più estremi da ciascun lato, per esempio &quot;tra 1° e 6°&quot;. In cima alla classifica le distanze sono piccole e la posizione esatta cambia facilmente: la fascia è il dato più affidabile.</li>
            <li><strong>Solidità.</strong> I pesi sono una scelta, quindi li mettiamo alla prova: ricalcoliamo la classifica {integer.format(rules.sensitivity.draws)} volte spostando ogni peso fino a {Math.round(rules.sensitivity.spread * 100)} punti in più o in meno. La solidità è la quota di volte in cui il Comune resta nella stessa fascia. Oggi la mediana è {one.format(summary.medianStability * 100)}%.</li>
          </ul>
        </section>

        {example ? (
          <section className="panel" aria-labelledby="esempio">
            <h2 id="esempio" className="panel-title">Un esempio completo: Bologna</h2>
            <p className={styles.lede}>
              Bologna è confrontata con {exampleGroup ? describeGroup(exampleGroup) : "i Comuni simili"}. Ecco come nasce il
              suo punteggio, {one.format(example.score ?? 0)}.
            </p>
            <div className="table-scroll" role="region" aria-labelledby="esempio-tabella" tabIndex={0}>
              <table className={`table ${styles.methodTable}`}>
                <caption id="esempio-tabella" className="table-caption">Dal dato al punteggio</caption>
                <thead>
                  <tr><th scope="col">Pilastro</th><th scope="col">Dati</th><th scope="col" className="num">Percentile</th><th scope="col" className="num">Peso</th><th scope="col" className="num">Punti</th></tr>
                </thead>
                <tbody>
                  {exampleParts.map((part) => (
                    <tr key={part.pillar}>
                      <th scope="row">{PILLAR_LABELS[part.pillar].title}</th>
                      <td>{part.facts.join(" ")}</td>
                      <td className="num">{part.percentile === null ? "n.d." : one.format(part.percentile)}</td>
                      <td className="num">{weight(part.pillar)}</td>
                      <td className="num">{part.points === null ? "n.d." : one.format(part.points)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr><th scope="row" colSpan={4}>DVNS Index</th><td className="num"><strong>{one.format(example.score ?? 0)}</strong></td></tr>
                </tfoot>
              </table>
            </div>
            <p className={styles.lede}>
              Risultato: {integer.format(example.rank ?? 0)}° su {integer.format(summary.ranked)} in Italia, {example.peerRank}° su {example.peerRanked} tra
              le città simili{exampleRegional ? `, ${exampleRegional.rank}° su ${integer.format(exampleRegional.total)} in ${regionName(example.regionCode)}` : ""}, fascia {example.band}. <Link href={`/dvns-index?comune=${EXAMPLE_ISTAT}#scheda`} prefetch={false}>Vedi la scheda di Bologna</Link>.
            </p>
          </section>
        ) : null}

        <section className="panel" aria-labelledby="prova">
          <h2 id="prova" className="panel-title">Una prova esterna: i Comuni in dissesto</h2>
          <p className={styles.lede}>
            Per capire se l&apos;indice misura qualcosa di reale lo confrontiamo con un dato che non usa: l&apos;elenco dei
            Comuni in dissesto finanziario pubblicato dal Ministero dell&apos;Interno (decreto del 17 giugno 2024,{" "}
            {integer.format(summary.validation.listed)} Comuni che hanno dichiarato il dissesto dal 2017). Di questi,{" "}
            {integer.format(summary.validation.ranked)} sono in classifica; gli altri sono quasi tutti in Sicilia, che
            OpenCivitas non copre.
          </p>
          <div className="table-scroll" role="region" aria-labelledby="prova-tabella" tabIndex={0}>
            <table className={`table ${styles.methodTable}`}>
              <caption id="prova-tabella" className="table-caption">Comuni in dissesto per fascia del DVNS Index</caption>
              <thead>
                <tr><th scope="col">Fascia</th><th scope="col" className="num">Comuni in dissesto</th><th scope="col" className="num">Quota</th><th scope="col" className="num">Se l&apos;indice fosse casuale</th></tr>
              </thead>
              <tbody>
                {BANDS.map((band) => (
                  <tr key={band}>
                    <th scope="row">{band}</th>
                    <td className="num">{integer.format(summary.validation.bands[band])}</td>
                    <td className="num">{Math.round((100 * summary.validation.bands[band]) / summary.validation.ranked)}%</td>
                    <td className="num">20%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className={styles.lede}>
            Se l&apos;indice fosse rumore, i Comuni in dissesto si distribuirebbero un quinto per fascia. Invece il loro
            punteggio mediano è {one.format(summary.validation.medianScore)}, contro {one.format(summary.medianScore)} di tutti
            i Comuni, e il {Math.round((100 * summary.validation.bands.E) / summary.validation.ranked)}% è in fascia E, quella degli ultimi. I pilastri che li riconoscono meglio sono la puntualità nei pagamenti e
            la resa della spesa. I pochi in fascia A o B hanno dichiarato il dissesto anni fa e oggi pagano i fornitori quasi
            in tempo: è plausibile che si siano rimessi in sesto.
          </p>
        </section>

        <section className="panel" aria-labelledby="fiducia">
          <h2 id="fiducia" className="panel-title">Quanto fidarsi dell&apos;indice</h2>
          <p className={styles.lede}>
            Il DVNS Index è fatto di due cose diverse, e conviene tenerle separate. I <strong>dati</strong> sono ufficiali e
            verificabili: se un numero è sbagliato, è sbagliato alla fonte o nel nostro codice, e chiunque può controllarlo. Il{" "}
            <strong>ragionamento</strong> è nostro: decidere che più servizi per euro è meglio, che un pagamento in ritardo è un
            segnale negativo, che la resa pesa il {weight("resa")}. Queste scelte si possono discutere. Le abbiamo rese
            esplicite e le abbiamo messe alla prova, ma restano scelte.
          </p>
          <h3 className={styles.subtitle}>A cosa crede di più</h3>
          <ul className={styles.criteria}>
            <li><strong>La fascia, più della posizione.</strong> Con pesi diversi i Comuni in fascia A restano in A nel {share(byBand.A)} dei casi (valore mediano), quelli in fascia E nel {share(byBand.E)}, quelli in fascia C nel {share(byBand.C)}: il centro della classifica è affollato e lì una fascia vale poco più dell&apos;altra.</li>
            <li><strong>Gli estremi, più del centro.</strong> Chi è molto in alto o molto in basso lo è su più pilastri insieme. Chi è nel mezzo spesso è forte in uno e debole in un altro.</li>
            <li><strong>Misure diverse, non la stessa ripetuta.</strong> Investimenti, appalti, puntualità e raccolta differenziata sono quasi indipendenti tra loro: un Comune non sale in classifica perché lo stesso dato viene contato più volte. L&apos;eccezione è la coppia resa e spesa non giustificata, che viene dagli stessi dati OpenCivitas: insieme pesano il {Math.round((rules.weights.resa + rules.weights.sovraspesa) * 100)}%, e lo dichiariamo.</li>
          </ul>
          <h3 className={styles.subtitle}>Le obiezioni che abbiamo corretto</h3>
          <div className="table-scroll" role="region" aria-labelledby="obiezioni-tabella" tabIndex={0}>
            <table className={`table ${styles.methodTable}`}>
              <caption id="obiezioni-tabella" className="table-caption">Debolezze trovate nella prima versione e come sono state trattate</caption>
              <thead>
                <tr><th scope="col">Obiezione</th><th scope="col">Cosa abbiamo fatto</th></tr>
              </thead>
              <tbody>
                <tr><th scope="row">Spendere poco veniva premiato anche quando è mancanza di soldi</th><td>La spesa sotto il fabbisogno dà punti solo se il Comune paga i fornitori nei tempi. Altrimenti contano solo i servizi.</td></tr>
                <tr><th scope="row">L&apos;indice misurava solo la spesa, nessun risultato</th><td>Aggiunta la raccolta differenziata di ISPRA, rilevata da un ente terzo. Aggiunti i tempi di pagamento, che sono dati contabili e non dichiarati.</td></tr>
                <tr><th scope="row">I servizi OpenCivitas sono dichiarati dai Comuni</th><td>Usiamo la media di due anni. I Comuni con uno scarto di oltre {integer.format(rules.volatileServicesPoints)} punti tra un anno e l&apos;altro ({integer.format(summary.volatile)}) restano fuori dalla classifica.</td></tr>
                <tr><th scope="row">Un Comune con poca spesa corrente sembrava investire molto</th><td>Metà del pilastro investimenti ora guarda agli euro per abitante, non solo alla quota.</td></tr>
                <tr><th scope="row">Rifiuti, energia e acqua hanno quasi sempre un solo fornitore</th><td>Esclusi dal calcolo della concentrazione sui fornitori.</td></tr>
                <tr><th scope="row">Pochi appalti, quote estreme</th><td>Con pochi appalti il valore viene avvicinato alla mediana nazionale; senza appalti sufficienti il pilastro vale 50. Prima questi Comuni restavano fuori: sotto i 1.000 abitanti era in classifica meno della metà.</td></tr>
                <tr><th scope="row">Gruppi di confronto troppo piccoli</th><td>Ogni pilastro si calcola su almeno {integer.format(rules.minPeerValues)} Comuni simili che hanno quel dato; se non bastano, per quel pilastro il gruppo si allarga.</td></tr>
                <tr><th scope="row">La posizione esatta in cima alla classifica è instabile</th><td>Per ogni Comune pubblichiamo l&apos;intervallo di posizione con pesi diversi e la solidità della fascia.</td></tr>
              </tbody>
            </table>
          </div>
          <h3 className={styles.subtitle}>Le obiezioni che restano</h3>
          <ul className={styles.criteria}>
            <li><strong>Il contesto economico.</strong> La Regione spiega circa il {share(regionScore)} delle differenze di punteggio, e il {share(regionDelay)} di quelle nei tempi di pagamento. Una parte riflette scelte amministrative, una parte redditi, evasione e trasferimenti diversi. Il confronto tra Comuni simili per dimensione e territorio non toglie questo effetto: per questo mostriamo anche la posizione nella Regione.</li>
            <li><strong>I pesi.</strong> Sono una scelta. I ricalcoli con pesi diversi dicono quanto conta questa scelta per ogni Comune, ma non dicono quali pesi siano &quot;giusti&quot;.</li>
            <li><strong>La quantità, non la qualità.</strong> OpenCivitas misura quanti servizi, non quanto sono buoni. La raccolta differenziata è l&apos;unico risultato misurato.</li>
            <li><strong>Periodi diversi.</strong> Servizi 2021-2022, rifiuti 2022-2023, pagamenti e investimenti 2024-2025, appalti 2025. Un cambio di giunta recente si vede solo in parte.</li>
          </ul>
          <p className={styles.lede}>
            In sintesi: usalo per capire in quale gruppo sta un Comune e perché, e per fare domande alla sua amministrazione.
            Non usarlo come una sentenza su chi governa, né per dire che il 12° è migliore del 15°.
          </p>
        </section>

        <section className="panel" aria-labelledby="limiti">
          <h2 id="limiti" className="panel-title">Cosa l&apos;indice non dice</h2>
          <ul className={styles.criteria}>
            <li>Non misura la qualità dei servizi. OpenCivitas ne misura la quantità, per esempio i posti negli asili o le strade gestite.</li>
            <li>Non indica sprechi né illeciti. Un affidamento diretto è spesso legittimo: la quota senza gara dice quanto il Comune usa la concorrenza, non se ha violato regole.</li>
            <li>Mette insieme periodi diversi: servizi e fabbisogni 2021-2022, gli ultimi pubblicati da OpenCivitas; raccolta differenziata 2022-2023; pagamenti 2024-2025; appalti 2025.</li>
            <li>Il fabbisogno standard è una stima statistica ufficiale, non un dato contabile.</li>
            <li>La quantità di servizi viene dai questionari che i Comuni compilano per SOSE. Quando tra il 2021 e il 2022 cambia di più di {integer.format(rules.volatileServicesPoints)} punti percentuali il Comune resta fuori dalla classifica: è più probabile un errore di compilazione che un cambiamento reale. Succede soprattutto nei Comuni piccoli.</li>
            <li>Il ritardo nei pagamenti è una media ponderata sull&apos;importo: una sola fattura grande pagata tardi può pesare più di molte piccole pagate in tempo.</li>
            <li>Non copre i Comuni delle Regioni a statuto speciale, per i quali OpenCivitas non pubblica dati.</li>
          </ul>
        </section>

        <section className="panel" aria-labelledby="riproduci">
          <h2 id="riproduci" className="panel-title">Come verificarlo</h2>
          <p className={styles.lede}>
            Il calcolo è nel codice aperto del sito: lo script <code>scripts/etl/dvns_index.py</code> e le regole in{" "}
            <code>scripts/etl/specs/dvns-index.source.json</code>, con pesi, soglie e impronte dei file di partenza. Con gli
            stessi file e lo stesso script chiunque ottiene gli stessi punteggi. Versione attuale dell&apos;indice:{" "}
            {snapshot.version}.
          </p>
          <ul className={styles.criteria}>
            {snapshot.sources.map((source) => (
              <li key={source.id}>
                <a href={source.url} target="_blank" rel="noreferrer">{source.label} ↗</a> · {source.owner} · licenza {source.license}
              </li>
            ))}
            <li><a href="https://github.com/Italian-Builders-Org/DoveVannoINostriSoldi" target="_blank" rel="noreferrer">Codice del sito su GitHub ↗</a></li>
          </ul>
        </section>
      </div>
    </main>
  );
}
