import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { integer } from "@/lib/format";
import { decodeEntityProcurementRouteCode, formatAnacConcentrationHhi, formatAnacConcentrationPercent } from "@/lib/data/anac-entity-procurement-page";
import { ANAC_PEER_MINIMUM, anacPeerSource, loadAnacPeerSnapshot, peerCpvOverlap, selectAnacPeers, summarizeAnacPeers, type AnacPeerDimension, type AnacPeerMetric } from "@/lib/data/anac-procurement-peers";
import styles from "./confronti.module.css";

type Props = { params: Promise<{ codice: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };
export const dynamic = "force-dynamic";
export const maxDuration = 15;
export const metadata: Metadata = { title: "Confronto appalti tra Comuni", robots: { index: false, follow: false } };

const indicators: ReadonlyArray<{ key: AnacPeerMetric; label: string; selection: string }> = [
  { key: "top1Share", label: "Quota primo aggiudicatario", selection: "top1" },
  { key: "top10Share", label: "Quota primi 10 aggiudicatari", selection: "top10" },
  { key: "hhi10000", label: "Concentrazione HHI", selection: "all" },
];
const profileHref = (code: string) => `/enti/${encodeURIComponent(code)}/appalti`;
const detailHref = (code: string, dimension: AnacPeerDimension, selection: string) => `${profileHref(code)}?view=concentration&metric=${dimension}&selection=${selection}`;

export default async function ProcurementPeersPage({ params, searchParams }: Props) {
  const code = decodeEntityProcurementRouteCode((await params).codice);
  const query = await searchParams;
  if (!code || Object.keys(query).some((k) => !["metric", "page"].includes(k))
    || (query.metric !== undefined && query.metric !== "count" && query.metric !== "value")
    || (query.page !== undefined && (typeof query.page !== "string" || !/^[1-9][0-9]{0,5}$/.test(query.page)))) notFound();
  const dimension: AnacPeerDimension = query.metric === "value" ? "value" : "count";
  let snapshot;
  try { snapshot = await loadAnacPeerSnapshot(); } catch {
    return <main className="shell page"><h1>Confronto non disponibile</h1><p>I dati del confronto non sono verificabili.</p><Link href={profileHref(code)}>Torna agli appalti dell’ente</Link></main>;
  }
  const group = selectAnacPeers(snapshot.rows, code, dimension);
  const target = group.target;
  const pageCount = Math.max(1, Math.ceil(group.peers.length / 25));
  const page = Math.min(Number(query.page ?? 1), pageCount);
  const peers = group.peers.slice((page - 1) * 25, page * 25);
  const comparisonHref = (metric: AnacPeerDimension, number = 1) => `${profileHref(code)}/confronti?metric=${metric}&page=${number}`;
  return (
    <main className={`shell page ${styles.page}`}>
      <p><Link href={profileHref(code)}>← Appalti dell’ente</Link></p>
      <div className="page-intro">
        <h1>Confronta gli appalti{target ? ` · ${target.name}` : ""}</h1>
        <p>Concentrazione degli aggiudicatari tra Comuni con dimensione, attività e categorie d’acquisto simili.</p>
      </div>
      <p className={styles.scope}>CIG pubblicati nel 2025 · Popolazione 2024 · Snapshot cross-temporale</p>
      <nav aria-label="Base del confronto" className={styles.tabs}>
        <Link href={comparisonHref("count")} aria-current={dimension === "count" ? "page" : undefined}>Numero di aggiudicazioni</Link>
        <Link href={comparisonHref("value")} aria-current={dimension === "value" ? "page" : undefined}>Valore attribuibile</Link>
      </nav>
      <section className="panel" aria-labelledby="comparison-title">
        <h2 className="panel-title" id="comparison-title">{group.publish ? `Il confronto con ${integer(group.peers.length)} altri Comuni` : "Confronto non pubblicato"}</h2>
        {group.exclusions.length ? <ul>{group.exclusions.map((reason) => <li key={reason}>{reason}.</li>)}</ul>
          : !group.publish ? <p>{integer(group.peers.length)} altri Comuni soddisfano i criteri. Per mediana e percentile ne servono almeno {ANAC_PEER_MINIMUM}.</p> : null}
        {group.publish && target ? <>
          <div className={styles.indicators}>
            {indicators.map(({ key, label, selection }) => {
              const summary = summarizeAnacPeers(target, group.peers, dimension, key)!;
              const format = key === "hhi10000" ? formatAnacConcentrationHhi : formatAnacConcentrationPercent;
              return <article className={styles.indicator} key={key}>
                <h3>{label}</h3>
                <Link className={styles.value} href={detailHref(code, dimension, selection)} aria-label={`${label}: ${format(summary.value)}. Vedi le aggiudicazioni`}>{format(summary.value)}</Link>
                <dl><div><dt>Mediana dei pari</dt><dd>{format(summary.median)}</dd></div><div><dt>Percentile</dt><dd>{formatAnacConcentrationPercent(summary.percentile)}</dd></div></dl>
              </article>;
            })}
          </div>
          <p className={styles.note}>Un percentile alto indica maggiore concentrazione rispetto a questo gruppo. Non misura la qualità dell’amministrazione o la presenza di illeciti.</p>
        </> : <p><Link href={profileHref(code)}>Consulta gli indicatori del solo ente</Link></p>}
        <p className={styles.note}>{dimension === "count" ? "Le quote usano le relazioni tra operatori e aggiudicazioni: un’aggiudicazione con più operatori può contare più volte." : "Le quote usano solo importi positivi attribuibili a un singolo operatore. Gli importi dichiarati non sono pagamenti."} HHI: scala da 0 a 10.000.</p>
      </section>
      <section className="panel" aria-labelledby="criteria-title">
        <h2 className="panel-title" id="criteria-title">Criteri del gruppo</h2>
        <ul className={styles.criteria}>
          <li>Popolazione e numero di procedure: da metà al doppio del Comune selezionato.</li>
          <li>Sovrapposizione delle categorie CPV a due cifre: almeno 80% delle procedure.</li>
          <li>Almeno 30 aggiudicazioni; CPV interpretabile e aggiudicatari identificati in almeno il 90% dei rispettivi casi.</li>
          {dimension === "value" ? <li>Almeno 30 importi positivi attribuibili; copertura di almeno il 90% delle aggiudicazioni e del valore positivo dichiarato.</li> : null}
        </ul>
        {target ? <p>{target.name}: {target.population === null ? "popolazione 2024 non disponibile" : `${integer(target.population)} residenti`}, {integer(target.procedures)} procedure, {integer(target.awards)} aggiudicazioni.</p> : null}
        <details>
          <summary>Copertura e metodo</summary>
          <div className={styles.details}>
            <p>{integer(group.eligibleCount)} Comuni superano i requisiti di copertura per questa base di confronto, su {integer(snapshot.municipalProfiles)} collegati univocamente a ISTAT e {integer(snapshot.totalProfiles)} profili ANAC complessivi. Solo quelli che soddisfano anche dimensione, attività e CPV entrano nel gruppo.</p>
            {target ? <p>Copertura di {target.name}: CPV {integer(Object.values(target.mix).reduce((s, n) => s + n, 0))}/{integer(target.procedures)} procedure; aggiudicatari identificati {integer(target.stableAwards)}/{integer(target.awards)} aggiudicazioni; importi positivi attribuibili {integer(target.valueObservations)}/{integer(target.awards)}.</p> : null}
            <p>La sovrapposizione somma, per ogni categoria CPV a due cifre, la minore delle due quote di procedure. I CPV mancanti restano nel denominatore. Il codice descrive l’oggetto dichiarato dell’acquisto; non certifica un mercato omogeneo.</p>
            <p>Il Comune selezionato è escluso da mediana e percentile. Il percentile conta i pari con valore inferiore e metà di quelli a pari valore. Con un numero pari di Comuni, la mediana è la media dei due valori centrali.</p>
            <p>Le soglie sono scelte metodologiche del progetto, non standard ANAC o ISTAT. Il confronto è descrittivo: non corregge tutte le differenze tra enti e non rappresenta una classifica nazionale. Gli enti con identità ambigua o popolazione non disponibile sono esclusi.</p>
          </div>
        </details>
      </section>
      {peers.length > 0 && target ? <section className="panel" aria-labelledby="peers-title">
        <h2 className="panel-title" id="peers-title">Comuni nel gruppo · {integer(group.peers.length)}</h2>
        <p className={styles.note}>I valori collegano alle aggiudicazioni che li compongono.</p>
        <p className={styles.tableHint}>Scorri la tabella in orizzontale →</p>
        <div className="table-scroll" role="region" aria-label="Confronto dei Comuni" tabIndex={0}>
          <table className="table">
            <caption>Popolazione 2024 e appalti dei CIG pubblicati nel 2025.</caption>
            <thead><tr><th scope="col">Comune</th><th scope="col" className="num">Residenti</th><th scope="col" className="num">Procedure</th><th scope="col" className="num">CPV in comune</th><th scope="col" className="num">Top 1</th><th scope="col" className="num">Top 10</th><th scope="col" className="num">HHI</th></tr></thead>
            <tbody>{peers.map((peer) => <tr key={peer.codiceIpa}>
              <th scope="row"><Link href={profileHref(peer.codiceIpa)}>{peer.name}</Link></th>
              <td className="num">{integer(peer.population!)}</td><td className="num">{integer(peer.procedures)}</td><td className="num">{formatAnacConcentrationPercent(peerCpvOverlap(target, peer))}</td>
              {indicators.map(({ key, selection }) => <td className="num" key={key}><Link href={detailHref(peer.codiceIpa, dimension, selection)}>{(key === "hhi10000" ? formatAnacConcentrationHhi : formatAnacConcentrationPercent)(peer[dimension]![key])}</Link></td>)}
            </tr>)}</tbody>
          </table>
        </div>
        {pageCount > 1 ? <nav className={styles.tabs} aria-label="Pagine del gruppo">{page > 1 ? <Link href={comparisonHref(dimension, page - 1)}>← Precedente</Link> : null}<span>Pagina {page} di {pageCount}</span>{page < pageCount ? <Link href={comparisonHref(dimension, page + 1)}>Successiva →</Link> : null}</nav> : null}
      </section> : null}
      <section className="panel" aria-labelledby="sources-title">
        <h2 className="panel-title" id="sources-title">Fonti e periodo</h2>
        <p><a href="https://dati.anticorruzione.it/opendata/dataset/cig-2025" target="_blank" rel="noreferrer">ANAC · CIG pubblicati nel 2025</a>, tutti i mesi. Aggiudicazioni e anagrafiche derivano dagli snapshot collegati: non è copertura nazionale corrente. Licenza ANAC: CC BY-SA 4.0.</p>
        <p><a href="https://situas.istat.it/" target="_blank" rel="noreferrer">ISTAT · SITUAS</a>: Comuni al 31/12/2025, popolazione {anacPeerSource.populationYear}. Collegamento tramite codice fiscale dell’ente, senza corrispondenze basate sul nome.</p>
        <p><Link href={`${profileHref(code)}#method-title`}>Provenienza e date degli snapshot ANAC</Link></p>
      </section>
    </main>
  );
}
