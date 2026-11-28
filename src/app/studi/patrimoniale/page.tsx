import type { Metadata } from "next";
import Link from "next/link";

import { pctOfGdp, scenarioTable, variantTable, type PatrimonialeSnapshot } from "@/lib/patrimoniale";
import { loadPatrimoniale, PatrimonialeUnavailableError } from "@/lib/patrimoniale-store";
import { PUBLIC_SITE_URL } from "@/lib/site";

import styles from "./patrimoniale.module.css";

const PATH = "/studi/patrimoniale";
const title = "Patrimoniale: quanto potrebbe rendere e chi la pagherebbe";
const description =
  "Come è distribuita la ricchezza delle famiglie italiane, quali imposte sul patrimonio esistono già, cosa propongono gli atti in Parlamento, scenari di gettito dichiarati come ipotesi e il confronto con Svizzera, Norvegia, Spagna e Francia.";

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
const two = new Intl.NumberFormat("it-IT", { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: "always" });
const pct = (value: number, digits = 1) => `${value.toLocaleString("it-IT", { minimumFractionDigits: 0, maximumFractionDigits: digits })}%`;
const bn = (value: number) => `${one.format(value)} miliardi`;
const mn = (value: number) => `${integer.format(value)} milioni`;
const euroK = (k: number) => (k === 1000 ? "1 milione" : k >= 1000 ? `${one.format(k / 1000).replace(/,0$/u, "")} milioni` : `${integer.format(Math.round(k * 1000))} euro`);
const quarter = (period: string) => period.replace(/^(\d{4})-Q(\d)$/u, "$2° trimestre $1");

function Unavailable() {
  return (
    <main className="shell page">
      <div className="page-intro">
        <h1>Patrimoniale</h1>
        <p>Dati temporaneamente non disponibili: senza lo snapshot verificato non mostriamo numeri.</p>
      </div>
    </main>
  );
}

function Bands({ data }: { data: PatrimonialeSnapshot }) {
  const total = data.distribution.totalBn;
  const max = Math.max(...data.distribution.bands.map((band) => Math.max(band.householdsPct, (band.wealthBn / total) * 100)));
  return (
    <figure className={styles.figure} aria-labelledby="fasce-caption">
      <figcaption id="fasce-caption">
        <strong>Quota di famiglie e quota di ricchezza netta, per fascia di ricchezza</strong>
        <span>{quarter(data.distribution.period)} · conti distributivi BCE</span>
      </figcaption>
      <div className={styles.bars}>
        {data.distribution.bands.map((band) => {
          const share = (band.wealthBn / total) * 100;
          return (
            <div className={styles.barRow} key={band.group} data-band={band.group}>
              <span>{band.label}</span>
              <strong>{pct(share)} della ricchezza</strong>
              <span className={styles.pair} aria-hidden="true">
                <span className={styles.pairPeople} style={{ width: `${(band.householdsPct / max) * 100}%` }} />
                <span className={styles.pairWealth} style={{ width: `${(Math.max(share, 0.3) / max) * 100}%` }} />
              </span>
            </div>
          );
        })}
      </div>
      <p className={styles.legend}><span className={styles.legendPeople}>quota delle famiglie</span><span className={styles.legendWealth}>quota della ricchezza netta</span></p>
      <details className={styles.details}>
        <summary>I dati in tabella</summary>
        <div className={`table-scroll ${styles.tableScroll}`} role="region" aria-label="Ricchezza per fascia" tabIndex={0}>
          <table className={styles.table}>
            <thead><tr><th scope="col">Fascia</th><th scope="col" className={styles.num}>Famiglie</th><th scope="col" className={styles.num}>Ricchezza netta</th><th scope="col" className={styles.num}>Media per famiglia</th><th scope="col" className={styles.num}>Soglia di ingresso</th></tr></thead>
            <tbody>
              {data.distribution.bands.map((band) => (
                <tr key={band.group}>
                  <th scope="row">{band.label}</th>
                  <td className={styles.num}>{band.householdsPct}%</td>
                  <td className={styles.num}>{bn(band.wealthBn)}</td>
                  <td className={styles.num}>{euroK(band.perHouseholdK)}</td>
                  <td className={styles.num}>{band.thresholdK === null ? "" : euroK(band.thresholdK)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}

function Composition({ data }: { data: PatrimonialeSnapshot }) {
  const { all, top10 } = data.composition;
  const shares = all.items.map((item) => {
    const top = top10.items.find((t) => t.id === item.id)?.valueBn ?? 0;
    return { ...item, top, topShare: (top / item.valueBn) * 100 };
  });
  return (
    <figure className={styles.figure} aria-labelledby="composizione-caption">
      <figcaption id="composizione-caption">
        <strong>Quanta parte di ogni tipo di bene è del 10% più ricco</strong>
        <span>miliardi di euro e quota del decimo decile · {quarter(data.distribution.period)}</span>
      </figcaption>
      <div className={styles.bars}>
        {shares.filter((item) => item.valueBn >= 100).sort((a, b) => b.topShare - a.topShare).map((item) => (
          <div className={styles.barRow} key={item.id} data-asset={item.id}>
            <span>{item.label}</span>
            <strong>{pct(item.topShare, 0)} di {bn(item.valueBn)}</strong>
            <span className={styles.track} aria-hidden="true"><span className={styles.trackHigh} style={{ width: `${item.topShare}%` }} /></span>
          </div>
        ))}
      </div>
      <p className={styles.note}>
        Il 10% più ricco ha quasi tutte le partecipazioni in società non quotate e meno di metà delle case: una patrimoniale sui più ricchi
        colpirebbe soprattutto quote di imprese, che non hanno un prezzo di mercato.
      </p>
    </figure>
  );
}

export default async function PatrimonialeStudy() {
  let data: PatrimonialeSnapshot;
  try {
    data = await loadPatrimoniale();
  } catch (error) {
    if (error instanceof PatrimonialeUnavailableError) return <Unavailable />;
    throw error;
  }
  const d = data.distribution;
  const s = data.scenarios;
  const avs = data.proposals.avs;
  const intl = data.international;
  const gdp = data.gdp2025Mn;
  const table = scenarioTable(s);
  const variants = variantTable(s);
  const first = data.shareSeries[0];
  const level = (k: number) => data.tail.levels.find((l) => l.thresholdK === k)!;
  const cell = (k: number, rate: number) => s.grid.find((c) => c.thresholdK === k && c.ratePct === rate)!;
  const avsRevenue = Object.fromEntries(avs.revenue.map((r) => [r.variant, r.revenueBn]));
  const swissPersons = intl.series.at(-1)?.CHE ?? 0;
  const norwayPersons = intl.series.at(-1)?.NOR ?? 0;
  const seriesYears = [1995, 2000, 2005, 2010, 2015, 2017, 2018, 2020, 2022, 2024];
  const regions = [...data.territory.regions].sort((a, b) => b.ratioMain - a.ratioMain);
  const italy = data.euroArea.find((row) => row.area === "IT")!;
  const italyRank = data.euroArea.filter((row) => row.area !== "I10").findIndex((row) => row.area === "IT") + 1;
  const countries = data.euroArea.filter((row) => row.area !== "I10").length;

  return (
    <main className={`shell ${styles.report}`}>
      <nav className={styles.breadcrumb} aria-label="Percorso">
        <Link href="/studi">Studi</Link> <span aria-hidden="true">/</span> <span>Patrimoniale</span>
      </nav>

      <header className={styles.hero}>
        <p className={styles.eyebrow}>Studio · Fisco e ricchezza · dati al {data.observedAt.split("-").reverse().join("/")}</p>
        <h1>{title}</h1>
        <p className={styles.dek}>
          Le famiglie italiane possiedono {bn(d.totalBn)} di euro di ricchezza netta, e il {pct(d.top10Pct)} è del 10% più ricco. Una
          patrimoniale sopra il milione di euro con aliquota dell&apos;1% darebbe in teoria {bn(cell(1000, 1).revenueBn)}; con le case ai
          valori catastali e le imprese esenti scende a {bn(variants.rows[0].cells.at(-1)!.revenueBn)}. Nei Paesi che la applicano
          davvero l&apos;incasso va dallo {pct(intl.series.at(-1)?.FRA ?? 0, 2)} all&apos;{pct(swissPersons, 2)} del PIL. Questo studio mostra
          numeri e ipotesi, senza prendere posizione.
        </p>
        <dl className={styles.stats}>
          <div><dt>Ricchezza netta delle famiglie</dt><dd>{one.format(d.totalBn / 1000)} mila mld</dd><span>{quarter(d.period)}, BCE</span></div>
          <div><dt>Quota del 10% più ricco</dt><dd>{pct(d.top10Pct)}</dd><span>era il {pct(first.top10Pct)} nel {first.period.slice(0, 4)}</span></div>
          <div><dt>Famiglie sopra 1 milione</dt><dd>{one.format(level(1000).households / 1e6)} milioni</dd><span>stima del modello, {pct((level(1000).households / (d.households * 1e6)) * 100)} delle famiglie</span></div>
          <div><dt>Quota della metà più povera</dt><dd>{pct(d.bottom50Pct)}</dd><span>della ricchezza netta, BCE</span></div>
        </dl>
      </header>

      <section className={styles.section} id="esistenti" aria-labelledby="esistenti-title">
        <p className={styles.eyebrow}>01 · Cosa c&apos;è già</p>
        <h2 id="esistenti-title">Le imposte sul patrimonio che l&apos;Italia applica già</h2>
        <div className={styles.prose}>
          <p>
            In Italia non esiste un&apos;imposta sul patrimonio complessivo, ma diversi beni sono già tassati per il solo fatto di
            possederli: le case con l&apos;IMU, i conti e gli investimenti con l&apos;imposta di bollo, gli immobili e le attività
            all&apos;estero con IVIE e IVAFE. Nel 2018, secondo la Banca d&apos;Italia, queste imposte valevano circa{" "}
            {integer.format(data.existingContext.ricottiTotalBn)} miliardi.
          </p>
        </div>
        <div className={`table-scroll ${styles.tableScroll}`} role="region" aria-labelledby="esistenti-tabella" tabIndex={0}>
          <table className={styles.table}>
            <caption id="esistenti-tabella">Gettito delle imposte sul patrimonio già in vigore, milioni di euro</caption>
            <thead><tr><th scope="col">Imposta</th><th scope="col">Anno</th><th scope="col" className={styles.num}>Gettito</th><th scope="col" className={styles.num}>Quota del PIL 2025</th><th scope="col">Come è misurato</th></tr></thead>
            <tbody>
              {data.existingTaxes.map((tax) => (
                <tr key={tax.id} data-tax={tax.id}>
                  <th scope="row">{tax.label}</th>
                  <td>{tax.year}</td>
                  <td className={styles.num}>{one.format(tax.valueMn).replace(/,0$/u, "")}</td>
                  <td className={styles.num}>{pct(tax.pctGdp, 3)}</td>
                  <td>{tax.basis}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className={styles.note}>
          Fonti: MEF, Bollettino delle entrate tributarie di dicembre 2025, e analisi delle dichiarazioni IRPEF 2024. Le voci non vanno
          sommate: hanno anni e criteri di misura diversi. Il bollo comprende tutte le sue forme, non solo conti e investimenti; nel 2025 è
          cresciuto soprattutto perché la legge di bilancio ha cambiato il modo di versare il bollo sui prodotti assicurativi. Nelle statistiche OCSE l&apos;Italia risulta
          quasi a zero tra le imposte sul patrimonio netto ({pct(intl.ranking.find((r) => r.code === "ITA")?.pctGdp ?? 0, 2)} del PIL),
          perché IMU e bollo sono classificati come imposte sugli immobili e sulle transazioni.
        </p>
      </section>

      <section className={styles.section} id="distribuzione" aria-labelledby="distribuzione-title">
        <p className={styles.eyebrow}>02 · La ricchezza</p>
        <h2 id="distribuzione-title">Come è distribuita la ricchezza delle famiglie</h2>
        <div className={styles.prose}>
          <p>
            Le {one.format(d.households)} milioni di famiglie italiane hanno in media {euroK(d.meanK)} di ricchezza netta, ma la metà ne ha
            meno di {euroK(d.medianK)}. Il 10% più ricco possiede il {pct(d.top10Pct)} del totale, il 5% più ricco il {pct(d.top5Pct)}, la
            metà più povera il {pct(d.bottom50Pct)}. Per entrare nel 10% più ricco servono {euroK(d.bands.at(-1)!.thresholdK!)}.
          </p>
          <p>
            Dal {first.period.slice(0, 4)} la quota del 10% più ricco è salita di {one.format(d.top10Pct - first.top10Pct)} punti. Tra i{" "}
            {countries} Paesi dell&apos;area euro con questi conti l&apos;Italia è {italyRank}ª per concentrazione al vertice ({pct(italy.top10Pct)}{" "}
            contro il {pct(data.euroArea.find((row) => row.area === "I10")?.top10Pct ?? 0)} della media dell&apos;area).
          </p>
        </div>
        <Bands data={data} />
        <div className={styles.split}>
          <Composition data={data} />
          <figure className={styles.figure} aria-labelledby="serie-caption">
            <figcaption id="serie-caption">
              <strong>Quota della ricchezza del 10% più ricco</strong>
              <span>quarto trimestre di ogni anno · BCE</span>
            </figcaption>
            <div className={styles.bars}>
              {data.shareSeries.map((point) => (
                <div className={styles.barRow} key={point.period} data-period={point.period}>
                  <span>{point.period.endsWith("Q4") ? point.period.slice(0, 4) : quarter(point.period)}</span>
                  <strong>{pct(point.top10Pct)}</strong>
                  <span className={styles.track} aria-hidden="true"><span className={styles.trackHigh} style={{ width: `${point.top10Pct}%` }} /></span>
                </div>
              ))}
            </div>
          </figure>
        </div>
        <details className={styles.details}>
          <summary>Il confronto con l&apos;area euro</summary>
          <div className={`table-scroll ${styles.tableScroll}`} role="region" aria-label="Concentrazione della ricchezza nell'area euro" tabIndex={0}>
            <table className={styles.table}>
              <thead><tr><th scope="col">Paese</th><th scope="col" className={styles.num}>10% più ricco</th><th scope="col" className={styles.num}>5% più ricco</th><th scope="col" className={styles.num}>50% più povero</th><th scope="col" className={styles.num}>Indice di Gini</th></tr></thead>
              <tbody>
                {data.euroArea.map((row) => (
                  <tr key={row.area} className={row.area === "IT" ? styles.highlight : undefined} data-area={row.area}>
                    <th scope="row">{row.name}</th>
                    <td className={styles.num}>{pct(row.top10Pct)}</td>
                    <td className={styles.num}>{pct(row.top5Pct)}</td>
                    <td className={styles.num}>{pct(row.bottom50Pct)}</td>
                    <td className={styles.num}>{one.format(row.gini)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      </section>

      <section className={styles.section} id="chi" aria-labelledby="chi-title">
        <p className={styles.eyebrow}>03 · Chi la pagherebbe</p>
        <h2 id="chi-title">Quante famiglie sopra ogni soglia, e dove</h2>
        <div className={styles.prose}>
          <p>
            La BCE pubblica la ricchezza per decili ma non dice quante famiglie superano 1, 2 o 5 milioni. Per stimarlo abbiamo descritto
            il 10% più ricco con una distribuzione di Pareto, la forma usata di norma per i patrimoni più alti, calibrata su due numeri
            pubblicati: la soglia d&apos;ingresso nel decile e la sua ricchezza media. Il modello ricostruisce la quota del 5% più ricco al{" "}
            {pct(data.tail.check.modelPct)}, contro il {pct(data.tail.check.publishedPct)} pubblicato.
          </p>
        </div>
        <div className={`table-scroll ${styles.tableScroll}`} role="region" aria-labelledby="soglie-tabella" tabIndex={0}>
          <table className={`${styles.table} ${styles.levelsTable}`}>
            <caption id="soglie-tabella">Famiglie con ricchezza netta sopra la soglia, stima del modello</caption>
            <thead><tr><th scope="col">Soglia</th><th scope="col" className={styles.num}>Famiglie</th><th scope="col" className={styles.num}>Quota delle famiglie</th><th scope="col" className={styles.num}>La loro ricchezza</th></tr></thead>
            <tbody>
              {data.tail.levels.map((row) => (
                <tr key={row.thresholdK} data-level={row.thresholdK}>
                  <th scope="row">{euroK(row.thresholdK)}{row.extrapolated ? <small className={styles.flag}>estrapolato</small> : null}</th>
                  <td className={styles.num}>{integer.format(Math.round(row.households / 1000) * 1000)}</td>
                  <td className={styles.num}>{pct((row.households / (d.households * 1e6)) * 100, 2)}</td>
                  <td className={styles.num}>{bn(row.wealthBn)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className={styles.note}>
          Sono famiglie, non persone: una patrimoniale individuale, come quelle in discussione, colpirebbe meno contribuenti perché il
          patrimonio di una coppia si divide in due. Oltre i {euroK(data.tail.check.thresholdK)} il modello va oltre l&apos;ultimo dato che
          possiamo verificare, e più la soglia è alta più la stima è incerta.
        </p>
        <h3 className={styles.subtitle}>Il territorio</h3>
        <div className={styles.prose}>
          <p>
            Secondo l&apos;indagine della Banca d&apos;Italia sul 2022, una famiglia del Nord ha in media{" "}
            {integer.format(data.territory.areas[0].meanEuro)} euro di ricchezza netta, una del Centro{" "}
            {integer.format(data.territory.areas[1].meanEuro)}, una del Sud e delle Isole {integer.format(data.territory.areas[2].meanEuro)}.
            Le mediane sono molto più vicine ({integer.format(data.territory.areas[0].medianEuro)}, {integer.format(data.territory.areas[1].medianEuro)} e{" "}
            {integer.format(data.territory.areas[2].medianEuro)} euro): la differenza tra le medie viene soprattutto dai patrimoni più alti, più frequenti al Nord.
          </p>
        </div>
        <details className={styles.details}>
          <summary>Case per regione: valore di mercato e valore usato per l&apos;IMU</summary>
          <div className={`table-scroll ${styles.tableScroll}`} role="region" aria-label="Valore delle abitazioni per regione" tabIndex={0}>
            <table className={styles.table}>
              <thead><tr><th scope="col">Regione</th><th scope="col" className={styles.num}>Case delle persone fisiche</th><th scope="col" className={styles.num}>Abitazione principale media</th><th scope="col" className={styles.num}>Valore di mercato su valore IMU</th></tr></thead>
              <tbody>
                {regions.map((row) => (
                  <tr key={row.region} data-region={row.region}>
                    <th scope="row">{row.region}</th>
                    <td className={styles.num}>{bn(row.valueBn)}</td>
                    <td className={styles.num}>{integer.format(row.mainHomeEuro)} euro</td>
                    <td className={styles.num}>{two.format(row.ratioMain)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className={styles.note}>Fonte: Agenzia delle Entrate e MEF, Gli immobili in Italia 2026, anno d&apos;imposta 2023, tabelle 2.2 e 3.7.</p>
        </details>
      </section>

      <section className={styles.section} id="proposte" aria-labelledby="proposte-title">
        <p className={styles.eyebrow}>04 · Le proposte</p>
        <h2 id="proposte-title">Cosa c&apos;è in Parlamento</h2>
        <div className={styles.prose}>
          <p>
            Nella XIX legislatura non c&apos;è una proposta di legge sulla patrimoniale in esame. Ci sono due atti.
          </p>
          <ul>
            <li>
              L&apos;emendamento {avs.act.replace("A.C. 3174-bis, emendamento ", "")} di {avs.group} alla legge di bilancio 2027. Introduce
              un&apos;imposta sul patrimonio netto delle persone fisiche oltre {euroK(avs.exemptEuro / 1000)} di euro, con aliquote del{" "}
              {avs.schedule.map((step) => pct(step.ratePct)).join(", ")} su scaglioni che partono da{" "}
              {avs.schedule.map((step) => euroK(step.fromK)).join(", ")}. La prima casa è esente fino a{" "}
              {integer.format(avs.mainHomeExemptEuro)} euro, IMU, IVIE, IVAFE e bollo si detraggono dall&apos;imposta, e il totale non può
              superare il {avs.capPctIncome}% del reddito. Il testo non indica il gettito. {avs.status}.
            </li>
            <li>
              Il disegno di legge {data.proposals.s2102.act}, «{data.proposals.s2102.title}», di {data.proposals.s2102.initiative.toLowerCase()},
              presentato al Senato il 19 novembre 2026. {data.proposals.s2102.status}.
            </li>
          </ul>
        </div>
      </section>

      <section className={styles.section} id="scenari" aria-labelledby="scenari-title">
        <p className={styles.eyebrow}>05 · Scenari</p>
        <h2 id="scenari-title">Quanto potrebbe rendere: tre leve</h2>
        <div className={styles.prose}>
          <p>
            Il gettito dipende da tre scelte: la soglia, l&apos;aliquota e cosa si conta nel patrimonio. La prima tabella applica
            un&apos;aliquota unica alla parte di patrimonio sopra la soglia, valutando tutto ai prezzi di mercato. Sono ipotesi, non
            previsioni: non tengono conto di chi sposta i beni, li sottovaluta o se ne va.
          </p>
        </div>
        <div className={`table-scroll ${styles.tableScroll}`} role="region" aria-labelledby="scenari-tabella" tabIndex={0}>
          <table className={`${styles.table} ${styles.scenarioTable}`}>
            <caption id="scenari-tabella">Gettito teorico annuo, miliardi di euro (tra parentesi la quota del PIL)</caption>
            <thead>
              <tr>
                <th scope="col">Soglia per famiglia</th>
                {table.columns.map((rate) => <th scope="col" className={styles.num} key={rate}>Aliquota {pct(rate)}</th>)}
              </tr>
            </thead>
            <tbody>
              {table.rows.map((row) => (
                <tr key={row.thresholdK} data-scenario-row={row.thresholdK}>
                  <th scope="row">{euroK(row.thresholdK)}</th>
                  {row.cells.map((c, index) => (
                    <td className={styles.num} key={index} data-revenue={c?.revenueBn}>{c ? `${one.format(c.revenueBn)} (${pct(pctOfGdp(c.revenueBn, gdp), 2)})` : "n.d."}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className={styles.prose}>
          <p>
            Nessun Paese incassa cifre simili. La Svizzera, dove l&apos;imposta parte da poche decine di migliaia di franchi, raccoglie
            dalle persone l&apos;{pct(swissPersons, 2)} del PIL, la Norvegia lo {pct(norwayPersons, 2)}. La seconda tabella mostra quanto
            pesano due scelte che quasi tutti i sistemi fanno, con aliquota dell&apos;{pct(s.variantRatePct)}:
          </p>
          <ul>
            <li>
              Valutare le case come per l&apos;IMU: il valore di mercato è in media {two.format(data.existingContext.ratioVsmVip)} volte
              quello catastale e le case sono il {pct(s.housingSharePct)} dei beni del 10% più ricco.
            </li>
            <li>Esentare imprese e partecipazioni non quotate, come fa la Spagna per le imprese di famiglia: sono il {pct(s.businessSharePct)} dei beni del 10% più ricco.</li>
          </ul>
        </div>
        <div className={`table-scroll ${styles.tableScroll}`} role="region" aria-labelledby="varianti-tabella" tabIndex={0}>
          <table className={`${styles.table} ${styles.scenarioTable}`}>
            <caption id="varianti-tabella">Gettito teorico con aliquota dell&apos;{pct(s.variantRatePct)}, miliardi di euro</caption>
            <thead>
              <tr>
                <th scope="col">Soglia per famiglia</th>
                {variants.columns.map((v) => <th scope="col" className={styles.num} key={v.id}>{v.label}{v.erosionPct ? ` (base −${pct(v.erosionPct)})` : ""}</th>)}
              </tr>
            </thead>
            <tbody>
              {variants.rows.map((row) => (
                <tr key={row.thresholdK} data-variant-row={row.thresholdK}>
                  <th scope="row">{euroK(row.thresholdK)}</th>
                  {row.cells.map((c, index) => <td className={styles.num} key={index}>{c ? one.format(c.revenueBn) : "n.d."}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className={styles.warning}>
          <p>
            Applicata alla stessa distribuzione, l&apos;imposta dell&apos;emendamento {avs.act.replace("A.C. 3174-bis, emendamento ", "")} darebbe in
            teoria {bn(avsRevenue.piena)} con tutto ai valori di mercato e {bn(avsRevenue.catastoImprese)} con case al catasto e imprese
            esenti. Il calcolo è per famiglia e non considera l&apos;esenzione della prima casa, le detrazioni di IMU e bollo e il tetto
            sul reddito, che riducono ancora l&apos;imposta. Tutti i patrimoni colpiti stanno nella parte estrapolata della distribuzione,
            sopra {euroK(data.tail.check.thresholdK)}: è la stima più incerta della pagina.
          </p>
        </div>
        <p className={styles.note}>{s.note}</p>
      </section>

      <section className={styles.section} id="effetti" aria-labelledby="effetti-title">
        <p className={styles.eyebrow}>06 · Effetti</p>
        <h2 id="effetti-title">Perché l&apos;incasso reale è più basso</h2>
        <div className={styles.prose}>
          <p>
            Le fonti ufficiali che abbiamo non misurano quante persone o quanti capitali si spostano per una patrimoniale. Mostrano però
            quanto il gettito dipenda dalle regole, e quali scelte lo riducono.
          </p>
          <ul>
            <li>
              In Francia l&apos;imposta sulla fortuna rendeva lo {pct(intl.series.find((r) => r.year === 2017)?.FRA ?? 0, 2)} del PIL nel
              2017. Dal 2018 è limitata agli immobili e rende lo {pct(intl.series.find((r) => r.year === 2018)?.FRA ?? 0, 2)}: è bastato
              togliere dalla base titoli e partecipazioni.
            </li>
            <li>
              In Spagna l&apos;imposta temporanea sulle grandi fortune ha reso {integer.format(intl.spain.itsgf2023Mn)} milioni nel 2023,{" "}
              {integer.format(intl.spain.itsgf2024Mn)} nel 2024 e circa {integer.format(intl.spain.itsgf2025Mn)} nel 2025. Nel 2024 le due
              imposte insieme hanno reso {two.format(intl.spain.revenue2024Euro / 1e9)} miliardi; le regioni possono ridurre quella ordinaria
              fino ad azzerarla, come fa Madrid con una riduzione del 100%.
            </li>
            <li>
              Le case hanno un valore catastale e le azioni quotate un prezzo, ma le imprese non quotate no: nel 10% più ricco valgono il{" "}
              {pct(s.businessSharePct)} dei beni. Ogni sistema le stima in modo diverso, e le stime sono il punto più facile da contestare.
            </li>
            <li>
              Una base catastale tratterebbe in modo diverso case con lo stesso valore: il rapporto tra valore di mercato e valore IMU va da{" "}
              {two.format(regions.at(-1)!.ratioMain)} in {regions.at(-1)!.region} a {two.format(regions[0].ratioMain)} in {regions[0].region}.
            </li>
            <li>
              Chi ha un patrimonio alto e un reddito basso deve vendere beni per pagare. Per questo l&apos;emendamento AVS mette un tetto al{" "}
              {avs.capPctIncome}% del reddito, come fa la Spagna, dove imposta sul patrimonio e IRPEF insieme non possono superare il{" "}
              {intl.spain.capPctIncome}% della base IRPF.
            </li>
            <li>
              Chi ha case e investimenti paga già IMU e bollo. Se diventano detraibili, come prevede l&apos;emendamento AVS, il gettito netto
              della nuova imposta scende di quanto i contribuenti ne pagano già.
            </li>
          </ul>
        </div>
      </section>

      <section className={styles.section} id="estero" aria-labelledby="estero-title">
        <p className={styles.eyebrow}>07 · Negli altri Paesi</p>
        <h2 id="estero-title">Chi ha una patrimoniale e quanto incassa</h2>
        <div className={`table-scroll ${styles.tableScroll}`} role="region" aria-labelledby="ocse-tabella" tabIndex={0}>
          <table className={styles.table}>
            <caption id="ocse-tabella">Imposte ricorrenti sul patrimonio netto, quota del PIL (OCSE, voce 4200)</caption>
            <thead><tr><th scope="col">Paese</th><th scope="col">Anno</th><th scope="col" className={styles.num}>Quota del PIL</th></tr></thead>
            <tbody>
              {intl.ranking.map((row) => (
                <tr key={row.code} className={row.code === "ITA" ? styles.highlight : undefined} data-oecd={row.code}>
                  <th scope="row">{row.name}</th><td>{row.year}</td><td className={styles.num}>{pct(row.pctGdp, 3)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className={styles.note}>
          La voce comprende anche le imposte sul patrimonio delle società: per Lussemburgo, Belgio e Italia è quasi tutto gettito
          delle imprese. Gli altri Paesi OCSE non hanno gettito in questa voce.
        </p>
        <div className={`table-scroll ${styles.tableScroll}`} role="region" aria-labelledby="paesi-tabella" tabIndex={0}>
          <table className={`${styles.table} ${styles.countryTable}`}>
            <caption id="paesi-tabella">Quattro sistemi a confronto</caption>
            <thead><tr><th scope="col">Paese</th><th scope="col">Chi paga</th><th scope="col">Aliquote</th><th scope="col">Gettito dalle persone</th></tr></thead>
            <tbody>
              <tr data-country="Svizzera">
                <th scope="row">Svizzera<small>imposte cantonali e comunali</small></th>
                <td>Residenti oltre una soglia che va da {integer.format(intl.switzerland.thresholdFromChf)} a 402.000 franchi di patrimonio netto (coniugi senza figli, 2024)</td>
                <td>Progressive nella maggior parte dei cantoni, fisse in nove; nessuna imposta federale dal {intl.switzerland.federalAbolished}</td>
                <td>{two.format(intl.local2024.CHE)} miliardi di franchi nel 2024, {pct(swissPersons, 2)} del PIL</td>
              </tr>
              <tr data-country="Norvegia">
                <th scope="row">Norvegia<small>formuesskatt</small></th>
                <td>Patrimonio oltre {integer.format(intl.norway.municipalThresholdNok)} corone (2026), il doppio per i coniugi; {integer.format(intl.norway.taxpayers2024)} contribuenti nel 2024</td>
                <td>{pct(intl.norway.municipalRatePct, 2)} al comune e {pct(intl.norway.stateRatePct, 2)} allo Stato, {pct(intl.norway.stateTopRatePct, 2)} oltre {integer.format(intl.norway.stateThresholdNok)} corone; sconti sul valore di case e azioni</td>
                <td>{one.format(intl.local2024.NOR)} miliardi di corone nel 2024, {pct(norwayPersons, 2)} del PIL</td>
              </tr>
              <tr data-country="Spagna">
                <th scope="row">Spagna<small>Impuesto sobre el Patrimonio e imposta sulle grandi fortune</small></th>
                <td>Patrimonio oltre {integer.format(intl.spain.exemptEuro)} euro, prima casa esente fino a {integer.format(intl.spain.mainHomeEuro)}; {integer.format(intl.spain.declarants2024)} dichiaranti nel 2024; imposta aggiuntiva oltre {integer.format(intl.spain.itsgfAboveEuro / 1e6)} milioni</td>
                <td>Dallo 0,2% al {pct(intl.spain.topRatePct)}; le regioni possono ridurla fino ad azzerarla, come Madrid</td>
                <td>{two.format(intl.spain.revenue2024Euro / 1e9)} miliardi di euro nel 2024, {pct(intl.series.at(-1)?.ESP ?? 0, 2)} del PIL</td>
              </tr>
              <tr data-country="Francia">
                <th scope="row">Francia<small>imposta sulla fortuna immobiliare (IFI) dal 2018</small></th>
                <td>Solo il patrimonio immobiliare netto; {integer.format(intl.france.ifiTaxpayers2025)} contribuenti nel 2025</td>
                <td>Progressive; scaglioni invariati dalla creazione nel 2018</td>
                <td>{mn(intl.france.ifi2025Mn)} di euro nel 2025, {pct(intl.series.at(-1)?.FRA ?? 0, 2)} del PIL nel 2024</td>
              </tr>
            </tbody>
          </table>
        </div>
        <details className={styles.details}>
          <summary>Serie storica dal 1995</summary>
          <div className={`table-scroll ${styles.tableScroll}`} role="region" aria-label="Imposte sul patrimonio delle persone, quota del PIL" tabIndex={0}>
            <table className={styles.table}>
              <thead><tr><th scope="col">Anno</th><th scope="col" className={styles.num}>Svizzera</th><th scope="col" className={styles.num}>Norvegia</th><th scope="col" className={styles.num}>Spagna</th><th scope="col" className={styles.num}>Francia</th><th scope="col" className={styles.num}>Italia</th></tr></thead>
              <tbody>
                {intl.series.filter((row) => seriesYears.includes(row.year)).map((row) => (
                  <tr key={row.year}>
                    <th scope="row">{row.year}</th>
                    {(["CHE", "NOR", "ESP", "FRA", "ITA"] as const).map((code) => <td className={styles.num} key={code}>{row[code] === null || row[code] === undefined ? "n.d." : pct(row[code] as number, 2)}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className={styles.note}>OCSE, Revenue Statistics, voce 4210 (imposte ricorrenti sul patrimonio netto delle persone), quota del PIL.</p>
        </details>
      </section>

      <section className={styles.section} id="metodo" aria-labelledby="metodo-title">
        <p className={styles.eyebrow}>Metodo e limiti</p>
        <h2 id="metodo-title">Come abbiamo lavorato</h2>
        <div className={styles.prose}>
          <ul>
            <li>Ogni documento è scaricato dalla fonte ufficiale e bloccato con la sua impronta SHA-256. Prima di pubblicare, il programma controlla che ogni cifra citata sia davvero nel testo del documento: se una fonte cambia, il calcolo si ferma.</li>
            <li>La distribuzione viene dai conti distributivi della BCE ({quarter(d.period)}), che riportano l&apos;indagine della Banca d&apos;Italia ai totali dei conti nazionali. Le fasce sono per famiglia e ai valori di mercato.</li>
            <li>Sopra la soglia del 10% più ricco ({euroK(data.tail.thresholdK)}) usiamo una distribuzione di Pareto con parametro {two.format(data.tail.alpha)}, ricavato dalla ricchezza media del decile. Il modello riproduce la quota del 5% più ricco con uno scarto di {one.format(Math.abs(data.tail.check.gapPts))} punti; oltre quella soglia è un&apos;estrapolazione.</li>
            <li>Le riduzioni della base nelle varianti usano la composizione dei beni dell&apos;intero 10% più ricco e il rapporto medio nazionale tra valore di mercato e valore IMU delle abitazioni principali. Sono approssimazioni dichiarate.</li>
            <li>Gli scenari non includono effetti di comportamento, evasione, costi di accertamento e contenzioso: sono tetti teorici, non previsioni di incasso.</li>
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
