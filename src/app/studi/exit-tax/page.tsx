import type { Metadata } from "next";
import Link from "next/link";

import { emigrationShareHigh, scenarioTable, type ExitTaxSnapshot } from "@/lib/exit-tax";
import { ExitTaxUnavailableError, loadExitTax } from "@/lib/exit-tax-store";
import { PUBLIC_SITE_URL } from "@/lib/site";

import styles from "./exit-tax.module.css";

const PATH = "/studi/exit-tax";
const title = "Exit tax: quanto vale tassare chi porta la residenza all'estero";
const description =
  "La manovra 2027 introduce un'imposta sulle plusvalenze non realizzate di chi lascia l'Italia. Cosa prevede, chi riguarda, la stima del Governo rifatta passo per passo, scenari alternativi e il confronto con Francia, Germania, Spagna, Stati Uniti e Norvegia.";

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: `${PUBLIC_SITE_URL}${PATH}` },
  openGraph: { type: "article", title, description, url: `${PUBLIC_SITE_URL}${PATH}`, locale: "it_IT" },
};

// One verified snapshot per instance, read at request time from dvns_snapshots.
export const dynamic = "force-dynamic";

const integer = new Intl.NumberFormat("it-IT", { maximumFractionDigits: 0, useGrouping: "always" });
const one = new Intl.NumberFormat("it-IT", { minimumFractionDigits: 1, maximumFractionDigits: 1, useGrouping: "always" });
const two = new Intl.NumberFormat("it-IT", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct = (value: number, digits = 1) => `${value.toLocaleString("it-IT", { minimumFractionDigits: 0, maximumFractionDigits: digits })}%`;
const mn = (value: number) => `${value < 20 ? two.format(value) : one.format(value)} milioni`;
const bn = (value: number) => `${one.format(value)} miliardi`;

function Unavailable() {
  return (
    <main className="shell page">
      <div className="page-intro">
        <h1>Exit tax</h1>
        <p>Dati temporaneamente non disponibili: senza lo snapshot verificato non mostriamo numeri.</p>
      </div>
    </main>
  );
}

function EmigrationChart({ data }: { data: ExitTaxSnapshot }) {
  const series = data.emigration.series;
  const max = Math.max(...series.map((row) => row.total));
  return (
    <figure className={styles.figure} aria-labelledby="espatri-caption">
      <figcaption id="espatri-caption">
        <strong>Italiani cancellati dall&apos;anagrafe per trasferimento all&apos;estero</strong>
        <span>persone per anno · la parte scura sono i laureati</span>
      </figcaption>
      <div className={styles.bars}>
        {series.map((row) => (
          <div className={styles.barRow} key={row.year} data-year={row.year}>
            <span>{row.year}</span>
            <strong>{integer.format(row.total)}</strong>
            <span className={styles.track} aria-hidden="true">
              <span className={styles.trackHigh} style={{ width: `${(row.high / max) * 100}%` }} />
              <span className={styles.trackRest} style={{ width: `${((row.total - row.high) / max) * 100}%` }} />
            </span>
          </div>
        ))}
      </div>
      <p className={styles.note}>
        Fonte: ISTAT, trasferimenti di residenza, tavola 9 (2025 provvisorio). Il picco del 2024 è gonfiato dalle iscrizioni
        tardive all&apos;AIRE dopo l&apos;aumento delle sanzioni: molte riguardano partenze degli anni precedenti.
      </p>
      <details className={styles.details}>
        <summary>I dati in tabella</summary>
        <div className={`table-scroll ${styles.tableScroll}`} role="region" aria-label="Espatri per anno e titolo di studio" tabIndex={0}>
          <table className={styles.table}>
            <thead>
              <tr><th scope="col">Anno</th><th scope="col" className={styles.num}>Totale</th><th scope="col" className={styles.num}>Laureati</th><th scope="col" className={styles.num}>Quota di laureati</th></tr>
            </thead>
            <tbody>
              {series.map((row) => (
                <tr key={row.year}><th scope="row">{row.year}</th><td className={styles.num}>{integer.format(row.total)}</td><td className={styles.num}>{integer.format(row.high)}</td><td className={styles.num}>{pct(emigrationShareHigh(row))}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}

export default async function ExitTaxStudy() {
  let data: ExitTaxSnapshot;
  try {
    data = await loadExitTax();
  } catch (error) {
    if (error instanceof ExitTaxUnavailableError) return <Unavailable />;
    throw error;
  }
  const { proposal: p, governmentEstimate: g, wealth: w, scenarios: s } = data;
  const last = data.emigration.series.at(-1)!;
  const table = scenarioTable(s);
  const cell = (e: number, gain: number) => s.grid.find((item) => item.emigrationPct === e && item.gainSharePct === gain)!;
  const low = cell(s.emigrationPct[0], s.gainSharePct[0]);
  const high = cell(s.emigrationPct.at(-1)!, s.gainSharePct.at(-1)!);
  const reference = cell(0.1, 35);
  const admissible = data.amendments.rows.filter((row) => row.outcome === "ammissibile");

  return (
    <main className={`shell ${styles.report}`}>
      <nav className={styles.breadcrumb} aria-label="Percorso">
        <Link href="/studi">Studi</Link> <span aria-hidden="true">/</span> <span>Exit tax</span>
      </nav>

      <header className={styles.hero}>
        <p className={styles.eyebrow}>Studio · Fisco e residenza · dati al {data.observedAt.split("-").reverse().join("/")}</p>
        <h1>{title}</h1>
        <p className={styles.dek}>
          La manovra 2027 tassa le plusvalenze maturate da chi trasferisce la residenza fiscale all&apos;estero. Il Governo stima
          un incasso di {mn(g.annual)} di euro l&apos;anno. Con gli stessi dati ufficiali, ma guardando al patrimonio accumulato
          invece che alle vendite di un anno, gli scenari vanno da {mn(low.taxMn)} a quasi {bn(high.taxMn / 1000)} di imposta
          teorica: quanto se ne incassa davvero dipende soprattutto dal rinvio del pagamento.
        </p>
        <dl className={styles.stats}>
          <div><dt>Soglia</dt><dd>{integer.format(p.thresholdEuro)} €</dd><span>di titoli e partecipazioni</span></div>
          <div><dt>Aliquota</dt><dd>{p.ratePct}%</dd><span>sulle plusvalenze non realizzate</span></div>
          <div><dt>Stima del Governo</dt><dd>{mn(g.annual)}</dd><span>di euro l&apos;anno dal 2028</span></div>
          <div><dt>Italiani espatriati</dt><dd>{integer.format(last.total)}</dd><span>nel {last.year}, dato provvisorio ISTAT</span></div>
        </dl>
      </header>

      <section className={styles.section} id="norma" aria-labelledby="norma-title">
        <p className={styles.eyebrow}>01 · La norma</p>
        <h2 id="norma-title">Cosa prevede l&apos;articolo 17 della manovra</h2>
        <div className={styles.prose}>
          <p>
            Il disegno di legge di bilancio 2027 ({p.act}) introduce l&apos;{p.newArticle.replace("Art.", "articolo")}.
            Chi trasferisce la residenza fiscale all&apos;estero paga l&apos;imposta sulle plusvalenze di titoli e partecipazioni come se
            li avesse venduti il giorno prima di partire.
          </p>
          <ul>
            <li>Riguarda le persone fisiche residenti in Italia per {p.residence}, oltre a società semplici ed enti non commerciali.</li>
            <li>Si applica solo se il valore di titoli e partecipazioni è almeno di {integer.format(p.thresholdEuro)} euro e se l&apos;Italia perde il diritto di tassarli dopo la partenza.</li>
            <li>L&apos;aliquota è del {p.ratePct}%; per i titoli di Stato la base si riduce al {pct(p.governmentBondsPct, 2)}, come per le altre plusvalenze su quei titoli.</li>
            <li>Si paga entro {p.paymentDays} giorni. Chi va in un Paese dell&apos;Unione europea, o in un Paese con accordi di cooperazione fiscale, può rinviare il pagamento alla vendita versando un acconto del {p.advancePct}% e una garanzia.</li>
            <li>Il rinvio dura {p.deferralYearsEu} anni per l&apos;UE e {p.deferralYearsOther} per gli altri Paesi. Se in quel periodo non vende, se torna in Italia o se muore, l&apos;imposta non è dovuta e l&apos;acconto viene restituito.</li>
          </ul>
          <p>Vale per chi perde la residenza dal 1° gennaio 2027. {p.status}.</p>
        </div>
        <details className={styles.details}>
          <summary>I {data.amendments.total} emendamenti all&apos;articolo 17</summary>
          <p>
            In Commissione Bilancio ne sono stati ammessi {admissible.length}. Tra questi ci sono proposte di sopprimere l&apos;articolo,
            di alzare la soglia e di escludere start-up e PMI innovative: il testo può ancora cambiare.
          </p>
          <div className={`table-scroll ${styles.tableScroll}`} role="region" aria-label="Emendamenti all'articolo 17" tabIndex={0}>
            <table className={styles.table}>
              <thead><tr><th scope="col">Emendamento</th><th scope="col">Gruppo</th><th scope="col">Esito</th></tr></thead>
              <tbody>
                {data.amendments.rows.map((row) => (
                  <tr key={row.id}><th scope="row">{row.id}</th><td>{row.groups.join(", ")}</td><td>{row.outcome}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
        <div className={styles.callout}>
          <h3>Per le imprese esiste già</h3>
          <p>
            Per le imprese che spostano la residenza fuori dall&apos;Italia una regola simile c&apos;è già: {data.businessExitTax.rule}.
            La relazione tecnica stimava un incasso tra {integer.format(data.businessExitTax.minEuro)} e {integer.format(data.businessExitTax.maxEuro)} euro
            l&apos;anno, perché i casi sono pochissimi. La novità è estendere la regola a chi non ha un&apos;impresa.
          </p>
        </div>
      </section>

      <section className={styles.section} id="chi" aria-labelledby="chi-title">
        <p className={styles.eyebrow}>02 · Chi se ne va</p>
        <h2 id="chi-title">Quanti italiani lasciano il Paese</h2>
        <div className={styles.prose}>
          <p>
            Nel {last.year} si sono cancellati dall&apos;anagrafe per trasferirsi all&apos;estero {integer.format(last.total)} italiani,
            il {pct(emigrationShareHigh(last))} laureati. Le prime destinazioni sono{" "}
            {data.emigration.destinations.slice(0, 5).map((d) => `${d.country} (${integer.format(d.total)})`).join(", ")}.
          </p>
          <p>
            Questi dati dicono quante persone partono, non quanto possiedono. Nessuna fonte pubblica collega chi emigra al suo
            reddito o al suo patrimonio, ed è questo il punto più debole di qualunque stima del gettito.
          </p>
        </div>
        <EmigrationChart data={data} />
      </section>

      <section className={styles.section} id="stima" aria-labelledby="stima-title">
        <p className={styles.eyebrow}>03 · La stima del Governo</p>
        <h2 id="stima-title">{mn(g.annual)} di euro l&apos;anno: come ci arriva la relazione tecnica</h2>
        <ol className={styles.steps}>
          <li><span>{integer.format(g.inputs.substituteTax)} milioni</span> di imposta sostitutiva sui redditi di capitale e sulle plusvalenze versata nel 2025</li>
          <li><span>× {pct(g.inputs.shareAboveThreshold)}</span> la quota della ricchezza finanziaria delle famiglie sopra la soglia di 800.000 euro</li>
          <li><span>× {pct(g.inputs.emigrationRate, 2)}</span> la quota della popolazione sopra i 15 anni che emigra in un anno</li>
          <li><span>= {mn(g.potential)}</span> di gettito potenziale; la metà, {mn(g.annual)}, come acconto, e dal 2032 {mn(g.refunds)} l&apos;anno di rimborsi</li>
        </ol>
        <div className={styles.prose}>
          <p>Abbiamo rifatto il conto e torna. Il metodo però ha tre limiti che spostano il risultato di molto, in entrambe le direzioni.</p>
          <ul>
            <li>
              Moltiplica l&apos;imposta pagata in un anno sulle vendite effettive, cioè un flusso. L&apos;exit tax invece colpisce tutte le
              plusvalenze accumulate negli anni e non ancora realizzate, cioè uno stock, molto più grande.
            </li>
            <li>
              Usa il tasso di emigrazione di tutta la popolazione, fatta in gran parte di giovani tra i 25 e i 35 anni con patrimoni
              modesti. Per chi ha più di 800.000 euro in titoli il tasso può essere molto più basso, o più alto se la norma
              spinge a partire prima.
            </li>
            <li>Non considera le partenze anticipate prima del 2027 né chi rinuncia a trasferirsi per non pagare.</li>
          </ul>
          <blockquote className={styles.quote}>
            <p>{data.corteConti}</p>
            <cite>Corte dei conti, audizione sulla manovra 2027</cite>
          </blockquote>
        </div>
      </section>

      <section className={styles.section} id="scenari" aria-labelledby="scenari-title">
        <p className={styles.eyebrow}>04 · Scenari</p>
        <h2 id="scenari-title">Quanto potrebbe valere guardando al patrimonio</h2>
        <div className={styles.prose}>
          <p>
            Secondo i conti distributivi della BCE e della Banca d&apos;Italia ({w.quarter}), le famiglie italiane hanno {bn(w.assetsBn)} di
            euro in titoli, azioni, partecipazioni e fondi; il {pct(w.topDecileSharePct)} è del 10% più ricco. Applicando la quota sopra
            soglia usata dal Governo ({pct(g.inputs.shareAboveThreshold)}) restano {bn(w.stockAboveThresholdBn)} di euro potenzialmente soggetti all&apos;imposta.
          </p>
          <p>
            Per stimare l&apos;imposta servono due numeri che nessuna fonte pubblica: quanta parte di questi beni esce ogni anno con chi
            si trasferisce, e quanta parte del loro valore è plusvalenza non ancora tassata. La tabella li fa variare. Sono ipotesi,
            non previsioni.
          </p>
        </div>
        <div className={`table-scroll ${styles.tableScroll}`} role="region" aria-labelledby="scenari-tabella" tabIndex={0}>
          <table className={`${styles.table} ${styles.scenarioTable}`}>
            <caption id="scenari-tabella">Imposta teorica all&apos;uscita, milioni di euro l&apos;anno · aliquota {s.ratePct}%</caption>
            <thead>
              <tr>
                <th scope="col">Quota del patrimonio sopra soglia che lascia l&apos;Italia ogni anno</th>
                {table.columns.map((gain) => <th scope="col" className={styles.num} key={gain}>Plusvalenza al {gain}% del valore</th>)}
              </tr>
            </thead>
            <tbody>
              {table.rows.map((row) => (
                <tr key={row.emigrationPct} data-scenario-row={row.emigrationPct}>
                  <th scope="row">{pct(row.emigrationPct, 2)}{row.emigrationPct === g.inputs.emigrationRate ? " (tasso usato dal Governo)" : ""}</th>
                  {row.cells.map((item, index) => <td className={styles.num} key={index}>{item ? one.format(item.taxMn) : "n.d."}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className={styles.note}>
          Esempio: se ogni anno partisse lo {pct(reference.emigrationPct, 2)} del patrimonio sopra soglia ({bn(reference.leavingStockBn)} di euro) e il {reference.gainSharePct}%
          del suo valore fosse plusvalenza, l&apos;imposta teorica sarebbe di {mn(reference.taxMn)} di euro, di cui {mn(reference.advanceMn)} come acconto. {s.note}
        </p>
      </section>

      <section className={styles.section} id="rinvio" aria-labelledby="rinvio-title">
        <p className={styles.eyebrow}>05 · Il rinvio</p>
        <h2 id="rinvio-title">Tra imposta teorica e incasso c&apos;è il rinvio</h2>
        <div className={styles.prose}>
          <p>
            Il diritto europeo non permette di far pagare subito tutto a chi si trasferisce in un altro Paese dell&apos;Unione: per
            questo la norma prevede il rinvio. Ma chi rinvia e non vende entro {p.deferralYearsEu} anni non deve nulla e si vede
            restituire l&apos;acconto. L&apos;incasso finale dipende quindi da quante persone vendono presto, e non dall&apos;imposta teorica.
          </p>
          <p>
            La Francia ha un&apos;imposta simile dal 2011. Al 31 dicembre 2017 aveva calcolato 5,75 miliardi di imposte teoriche, ma ne
            aveva incassati solo 138 milioni in sei anni, circa 23 milioni l&apos;anno: quasi tutto era sospeso, soprattutto per chi si
            era trasferito in un altro Paese UE.
          </p>
        </div>
      </section>

      <section className={styles.section} id="estero" aria-labelledby="estero-title">
        <p className={styles.eyebrow}>06 · Negli altri Paesi</p>
        <h2 id="estero-title">Come funziona all&apos;estero</h2>
        <div className={`table-scroll ${styles.tableScroll}`} role="region" aria-labelledby="estero-tabella" tabIndex={0}>
          <table className={`${styles.table} ${styles.countryTable}`}>
            <caption id="estero-tabella">Exit tax sulle persone fisiche, regole e incassi pubblicati</caption>
            <thead>
              <tr><th scope="col">Paese</th><th scope="col">Chi paga</th><th scope="col">Aliquota</th><th scope="col">Rinvio</th><th scope="col">Incassi pubblicati</th></tr>
            </thead>
            <tbody>
              <tr data-country="Italia">
                <th scope="row">Italia (proposta)<small>{p.newArticle}</small></th>
                <td>Chi ha almeno {integer.format(p.thresholdEuro)} euro di titoli ed è stato residente {p.residence}</td>
                <td>{p.ratePct}%</td>
                <td>Acconto del {p.advancePct}%, rinvio fino a {p.deferralYearsEu} anni nell&apos;UE e {p.deferralYearsOther} altrove</td>
                <td>Stima del Governo: {mn(g.annual)} l&apos;anno</td>
              </tr>
              {data.international.map((row) => (
                <tr key={row.country} data-country={row.country}>
                  <th scope="row">{row.country}<small>{row.rule}</small></th>
                  <td>{row.who}</td>
                  <td>{row.rate}</td>
                  <td>{row.deferral}</td>
                  <td>{row.revenue} {row.sourceUrls.map((url, index) => <a key={url} href={url} target="_blank" rel="noreferrer" aria-label={`Fonte ${index + 1} per ${row.country}`}>[{index + 1}]</a>)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className={styles.note}>
          Riportiamo solo regole e cifre verificate sui documenti ufficiali indicati. Dove un Paese non pubblica gli incassi lo scriviamo.
        </p>
      </section>

      <section className={styles.section} id="effetti" aria-labelledby="effetti-title">
        <p className={styles.eyebrow}>07 · Effetti collaterali</p>
        <h2 id="effetti-title">Partenze anticipate, rinunce e doppie imposte</h2>
        <div className={styles.prose}>
          <p>
            In Norvegia le plusvalenze accertate a chi lasciava il Paese sono passate da 7.621 milioni di corone nel 2021 a 134.405
            nel 2022, per poi scendere a 42.099 nel 2023. Un salto di quasi venti volte in un anno mostra quanto le uscite di grandi
            patrimoni possano concentrarsi in poco tempo. In Italia il rischio è che si concentrino nel 2026, prima che la norma entri
            in vigore.
          </p>
          <p>
            Una parte delle persone può decidere di non trasferirsi per non pagare: è l&apos;effetto che la Corte dei conti considera più
            rilevante dell&apos;incasso. Altre possono spostare prima i titoli in strutture che sfuggono alla norma, cosa che le stime
            ufficiali non misurano.
          </p>
          <p>
            Per la doppia imposizione la norma tassa solo i casi in cui l&apos;Italia perde il diritto di tassare dopo la partenza. Il
            rischio resta per chi si trasferisce in un Paese che tassa di nuovo, al momento della vendita, una plusvalenza già colpita
            in Italia: dipende dalle convenzioni e da come il nuovo Paese calcola il costo dei titoli.
          </p>
        </div>
      </section>

      <section className={styles.section} id="metodo" aria-labelledby="metodo-title">
        <p className={styles.eyebrow}>Metodo e limiti</p>
        <h2 id="metodo-title">Come abbiamo lavorato</h2>
        <div className={styles.prose}>
          <ul>
            <li>Ogni documento è scaricato dalla fonte ufficiale e verificato con la sua impronta SHA-256. Prima di pubblicare, il programma controlla che ogni cifra e ogni frase citata siano davvero nel documento: se una fonte cambia, il calcolo si ferma.</li>
            <li>La stima del Governo è ricalcolata dai suoi stessi numeri. Gli scenari usano la ricchezza finanziaria della BCE e della Banca d&apos;Italia e la quota sopra soglia della relazione tecnica; tasso di uscita e quota di plusvalenza sono ipotesi dichiarate.</li>
            <li>Gli scenari non tengono conto dell&apos;aliquota ridotta sui titoli di Stato, delle minusvalenze, delle partenze anticipate e di chi rinuncia a partire: per questo sono tetti teorici, non previsioni di incasso.</li>
            <li>Le cancellazioni anagrafiche non coincidono con il cambio di residenza fiscale e arrivano spesso in ritardo.</li>
          </ul>
        </div>
        <h3 className={styles.subtitle}>Fonti</h3>
        <ul className={styles.sources}>
          {data.sources.map((source) => (
            <li key={source.id}><a href={source.url} target="_blank" rel="noreferrer">{source.label}</a> · {source.owner} · {source.license}</li>
          ))}
        </ul>
        <p className={styles.note}>Versione {data.version} dello studio.</p>
      </section>
    </main>
  );
}
