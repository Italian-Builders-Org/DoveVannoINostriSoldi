import type { Metadata } from "next";
import Link from "next/link";

import { FUNCTION_LABELS, PILLAR_LABELS, PILLARS, describeGroup, explainEntry } from "@/lib/dvns-index";
import { IndexSnapshotUnavailableError, loadDvnsIndex, type IndexData } from "@/lib/dvns-index-store";

import styles from "../dvns-index.module.css";

export const metadata: Metadata = {
  title: "DVNS Index, il metodo: dati, regole e calcolo passo per passo",
  description:
    "Come si calcola il DVNS Index: quali dati ufficiali usa (OpenCivitas, SIOPE, ANAC, ISTAT), come confronta ogni Comune con quelli simili, pesi, fasce, solidità e limiti, con un esempio completo.",
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
            <li>Raccogliamo per ogni Comune quattro misure da fonti ufficiali: servizi in rapporto alla spesa, spesa oltre il fabbisogno, quota di investimenti, apertura degli appalti.</li>
            <li>Confrontiamo ogni misura con quella dei Comuni simili per dimensione e territorio, e la trasformiamo in un punteggio da 0 a 100.</li>
            <li>Facciamo la media pesata dei quattro punteggi: questo è il DVNS Index.</li>
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
          <h2 id="pilastri" className="panel-title">I quattro pilastri</h2>
          <div className={styles.pillarMethod}>
            <article>
              <h3>01 · {PILLAR_LABELS.resa.title} <span>peso {weight("resa")}</span></h3>
              <p className={styles.question}>{PILLAR_LABELS.resa.question}</p>
              <p><strong>Misura.</strong> Servizi rispetto alla media dei Comuni della stessa fascia di popolazione, meno spesa rispetto al fabbisogno standard. Entrambi i valori sono pubblicati da OpenCivitas, in percentuale.</p>
              <p><strong>Esempio.</strong> Un Comune con il 20% di servizi in più e il 5% di spesa in più ottiene +15. Uno con il 10% di servizi in meno e la spesa in linea ottiene −10.</p>
              <p><strong>Regola.</strong> Più servizi per ogni euro è meglio. Usiamo la media del 2021 e del 2022, così un anno anomalo pesa meno. È il pilastro più importante perché è il più vicino alla domanda &quot;cosa ottengo per quello che spendo&quot;.</p>
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
              <p><strong>Misura.</strong> Pagamenti per investimenti divisi per la somma di spesa corrente e investimenti, sommando il 2024 e il 2025.</p>
              <p><strong>Regola.</strong> Una quota più alta è meglio: scuole, strade e impianti restano ai cittadini anche negli anni successivi. Sommiamo due anni perché un&apos;opera finita da poco non decida da sola il voto. Il rimborso dei debiti non entra nel calcolo: rimborsare è un comportamento corretto, non va né premiato né penalizzato.</p>
            </article>
            <article>
              <h3>04 · {PILLAR_LABELS.appalti.title} <span>peso {weight("appalti")}</span></h3>
              <p className={styles.question}>{PILLAR_LABELS.appalti.question}</p>
              <p><strong>Misura, per il 60%.</strong> La quota del valore delle procedure da almeno {integer.format(rules.procurementThresholdEuro)} € assegnata con affidamento diretto o con procedura negoziata senza bando.</p>
              <p><strong>Misura, per il 40%.</strong> Quanto il valore aggiudicato si concentra su pochi fornitori, con l&apos;indice di Herfindahl-Hirschman, usato anche dalle autorità della concorrenza.</p>
              <p><strong>Regola.</strong> Meno concentrazione e meno procedure senza gara è meglio. Non contano le adesioni alle convenzioni Consip, perché la gara si è già svolta a monte, né gli affidamenti alle società in house del Comune. Le procedure delegate a una centrale di committenza restano del Comune che le ha delegate.</p>
              <p><strong>Pochi appalti.</strong> Servono almeno {rules.minProcedures} procedure o {rules.minAwards} aggiudicazioni. Quando sono poche, un solo contratto sposta molto la quota: per questo avviciniamo il valore alla mediana nazionale ({one.format(summary.medianWithoutTenderShare)}% del valore senza gara) in proporzione a quanti dati mancano. Con 5 procedure il valore si sposta molto, con 200 quasi per niente.</p>
            </article>
          </div>
        </section>

        <section className="panel" aria-labelledby="confronto">
          <h2 id="confronto" className="panel-title">Il confronto tra Comuni simili</h2>
          <p className={styles.lede}>
            Confrontare Milano con un paese di montagna non avrebbe senso. Ogni Comune viene confrontato con i Comuni che
            hanno la stessa fascia di popolazione e di superficie, la stessa zona altimetrica, lo stesso grado di
            urbanizzazione e la stessa posizione rispetto a costa e isole. Se i Comuni così simili sono meno di 10,
            allarghiamo il gruppo togliendo un criterio alla volta. Le città con almeno 100.000 abitanti si confrontano
            sempre tra loro.
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
            <li><strong>Punteggio.</strong> Media pesata dei quattro percentili: {weight("resa")} resa della spesa, {weight("sovraspesa")} spesa non giustificata, {weight("investire")} capacità di investire, {weight("appalti")} apertura degli appalti.</li>
            <li><strong>Classifica.</strong> Entrano solo i Comuni con tutti e quattro i pilastri: oggi {integer.format(summary.ranked)}. Gli altri hanno un punteggio parziale ({integer.format(summary.partial)}) oppure non sono valutabili ({integer.format(summary.specialStatute)} nelle Regioni a statuto speciale, che OpenCivitas non copre).</li>
            <li><strong>Fasce.</strong> A raccoglie il 20% migliore, E il 20% peggiore. Le soglie attuali sono: A da {one.format(summary.bandCutoffs[0])}, B da {one.format(summary.bandCutoffs[1])}, C da {one.format(summary.bandCutoffs[2])}, D da {one.format(summary.bandCutoffs[3])}. La fascia conta più della posizione esatta: tra il 1.200° e il 1.250° posto la differenza è piccola.</li>
            <li><strong>Intervallo di posizione.</strong> Dagli stessi ricalcoli ricaviamo dove cade la posizione di ogni Comune escludendo il 5% dei casi più estremi da ciascun lato, per esempio &quot;tra 1° e 19°&quot;. In cima alla classifica le distanze sono piccole e la posizione esatta cambia facilmente: la fascia è il dato più affidabile.</li>
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
              Risultato: {integer.format(example.rank ?? 0)}° su {integer.format(summary.ranked)} in Italia e {example.peerRank}° su {example.peerRanked} tra
              le città simili, fascia {example.band}. <Link href={`/dvns-index?comune=${EXAMPLE_ISTAT}#scheda`} prefetch={false}>Vedi la scheda di Bologna</Link>.
            </p>
          </section>
        ) : null}

        <section className="panel" aria-labelledby="limiti">
          <h2 id="limiti" className="panel-title">Cosa l&apos;indice non dice</h2>
          <ul className={styles.criteria}>
            <li>Non misura la qualità dei servizi. OpenCivitas ne misura la quantità, per esempio i posti negli asili o le strade gestite.</li>
            <li>Non indica sprechi né illeciti. Un affidamento diretto è spesso legittimo: la quota senza gara dice quanto il Comune usa la concorrenza, non se ha violato regole.</li>
            <li>Mette insieme periodi diversi: servizi e fabbisogni 2021-2022, gli ultimi pubblicati da OpenCivitas; pagamenti 2024-2025; appalti 2025.</li>
            <li>Il fabbisogno standard è una stima statistica ufficiale, non un dato contabile.</li>
            <li>La quantità di servizi viene dai questionari che i Comuni compilano per SOSE. Quando tra il 2021 e il 2022 cambia di più di 100 punti percentuali lo segnaliamo come &quot;dato da verificare&quot;: è più probabile un errore di compilazione che un cambiamento reale. Succede soprattutto nei Comuni piccoli.</li>
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
