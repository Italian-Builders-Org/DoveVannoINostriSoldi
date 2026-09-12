import type { Metadata } from "next";
import Link from "next/link";
import { longDate } from "@/lib/format";
import { getGdpView } from "@/lib/gdp";
import styles from "./pil.module.css";

export const metadata: Metadata = {
  title: "PIL e conti nazionali",
  description:
    "PIL italiano Eurostat SEC 2010: livelli reali e nominali, crescita trimestrale e annuale, quote della domanda e confronto con Francia, Germania e Spagna.",
  alternates: { canonical: "/pil" },
};

const euro = new Intl.NumberFormat("it-IT", {
  style: "currency",
  currency: "EUR",
  maximumFractionDigits: 0,
});
const percent = new Intl.NumberFormat("it-IT", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

function millionEuroLabel(value: number): string {
  return `${euro.format(value * 1_000_000)}`;
}

function percentLabel(value: number): string {
  return `${percent.format(value)}%`;
}

export default function GdpPage() {
  const view = getGdpView();
  const assets = Object.entries(view.metadata.source.assets);

  return (
    <main className="shell page">
      <header className="page-intro">
        <p className="eyebrow">Conti nazionali · Eurostat SEC 2010</p>
        <h1>PIL italiano</h1>
        <p>
          Livello, crescita e composizione della domanda dal prodotto interno lordo ufficiale.
          Non è cassa pubblica e non assegna meriti o colpe a un governo.
        </p>
        <p className={styles.links}>
          <a href="#pil-trimestrale">Trimestrale ↓</a>
          <a href="#pil-annuale">Annuale ↓</a>
          <a href="#pil-componenti">Domanda ↓</a>
          <a href="#pil-confronto">Confronto UE ↓</a>
          <a href="#pil-fonti">Fonti ↓</a>
          <Link href="/economia">Economia →</Link>
          <Link href="/governi">Pagella governi →</Link>
        </p>
      </header>

      <section className={`panel ${styles.hero}`} aria-labelledby="pil-ultimo-title">
        <div>
          <h2 id="pil-ultimo-title" className="panel-title">Italia · {view.latestQuarter.period}</h2>
          <strong className={styles.heroRate} data-testid="gdp-yoy">
            {percentLabel(view.latestQuarter.yoyGrowth)}
          </strong>
          <p className={styles.heroLabel}>crescita reale rispetto allo stesso trimestre dell’anno precedente</p>
        </div>
        <dl className={styles.heroMetrics}>
          <div>
            <dt>PIL nominale</dt>
            <dd>{millionEuroLabel(view.latestQuarter.nominalMillionEuro)}</dd>
            <small>prezzi correnti · CP_MEUR</small>
          </div>
          <div>
            <dt>PIL reale</dt>
            <dd>{millionEuroLabel(view.latestQuarter.realMillionEuro)}</dd>
            <small>volumi concatenati 2020 · CLV20_MEUR</small>
          </div>
          <div>
            <dt>Trimestre su trimestre</dt>
            <dd>{percentLabel(view.latestQuarter.qoqGrowth)}</dd>
            <small>volumi · CLV_PCH_PRE</small>
          </div>
        </dl>
        <p className={styles.sourceLine}>
          Fonte: <a href={view.metadata.source.landingUrl}>Eurostat namq_10_gdp</a>
          {" · "}controllato il {longDate(view.metadata.source.acquisition.checkedAt)}.
        </p>
      </section>

      <section className="panel" id="pil-trimestrale" aria-labelledby="pil-trimestrale-title">
        <h2 id="pil-trimestrale-title" className="panel-title">Andamento trimestrale</h2>
        <p className={styles.lead}>
          Variazione annua del PIL reale (volumi concatenati). L’asse non è un totale di spesa pubblica.
        </p>
        <ol className={styles.bars} aria-label="Crescita reale a/a per trimestre">
          {view.quarterly.slice(-16).map((row) => (
            <li key={row.period}>
              <span>{row.period}</span>
              <span
                className={styles.bar}
                style={{
                  width: `${Math.max(4, (Math.abs(row.yoyGrowth) / view.historyMaxAbsGrowth) * 100)}%`,
                  background: row.yoyGrowth < 0 ? "var(--danger, #b42318)" : undefined,
                }}
                title={percentLabel(row.yoyGrowth)}
              />
              <strong>{percentLabel(row.yoyGrowth)}</strong>
            </li>
          ))}
        </ol>
      </section>

      <section className="panel" id="pil-annuale" aria-labelledby="pil-annuale-title">
        <h2 id="pil-annuale-title" className="panel-title">Serie annuale</h2>
        <div className="table-scroll" role="region" aria-label="PIL annuale Italia" tabIndex={0}>
          <table className="table">
            <caption>PIL annuale Italia · Eurostat nama_10_gdp</caption>
            <thead>
              <tr>
                <th scope="col">Anno</th>
                <th scope="col" className="num">Nominale</th>
                <th scope="col" className="num">Reale (2020)</th>
                <th scope="col" className="num">Crescita reale</th>
              </tr>
            </thead>
            <tbody>
              {view.annual.map((row) => (
                <tr key={row.period}>
                  <th scope="row">{row.period}</th>
                  <td className="num">{millionEuroLabel(row.nominalMillionEuro)}</td>
                  <td className="num">{millionEuroLabel(row.realMillionEuro)}</td>
                  <td className="num">{percentLabel(row.yoyGrowth)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className={styles.note}>
          Ultimo anno annuale pubblicato: {view.latestAnnual.period}. I trimestri più recenti non
          sostituiscono l’annualità finché Eurostat non la rilascia.
        </p>
      </section>

      <section className="panel" id="pil-componenti" aria-labelledby="pil-componenti-title">
        <h2 id="pil-componenti-title" className="panel-title">Quote della domanda · {view.latestQuarter.period}</h2>
        <p className={styles.lead}>
          Quote ufficiali sul PIL (PC_GDP). Non sommano a 100: mancano scorte e altre voci.
          L’export netto mostrato sotto è solo P6 − P7, non una serie Eurostat autonoma.
        </p>
        <ul className={styles.components}>
          {view.components.map((item) => (
            <li key={item.key}>
              <span>{item.label}</span>
              <strong>{percentLabel(item.value)}</strong>
            </li>
          ))}
          <li>
            <span>Export netto (P6 − P7, derivato)</span>
            <strong>{percentLabel(view.latestQuarter.netExportsShare)}</strong>
          </li>
        </ul>
      </section>

      <section className="panel" id="pil-confronto" aria-labelledby="pil-confronto-title">
        <h2 id="pil-confronto-title" className="panel-title">Confronto europeo · {view.peers[0]?.period}</h2>
        <p className={styles.lead}>
          Crescita reale a/a sullo stesso trimestre, stessa destagionalizzazione SCA. Non è una classifica.
        </p>
        <ol className={styles.peerList}>
          {view.peers
            .slice()
            .sort((left, right) => right.yoyGrowth - left.yoyGrowth)
            .map((peer) => (
              <li key={peer.geo} data-italy={peer.geo === "IT" ? "true" : undefined}>
                <span>{peer.label}</span>
                <strong>
                  {percentLabel(peer.yoyGrowth)}
                  {peer.provisional ? " · provvisorio" : ""}
                </strong>
              </li>
            ))}
        </ol>
      </section>

      <section className="panel" id="pil-fonti" aria-labelledby="pil-fonti-title">
        <h2 id="pil-fonti-title" className="panel-title">Fonti, limiti e letture collegate</h2>
        <ul className={styles.caveats}>
          {view.caveats.map((caveat) => (
            <li key={caveat}>{caveat}</li>
          ))}
        </ul>
        <p className={styles.note}>
          Stesso mondo macro della <Link href="/governi">pagella dei governi</Link>, ma senza voto né
          attribuzione al mandato: qui si legge solo la serie ufficiale.
        </p>
        <div className="table-scroll" role="region" aria-label="Asset Eurostat acquisiti" tabIndex={0}>
          <table className="table">
            <caption>Risposte JSON-stat source-locked</caption>
            <thead>
              <tr>
                <th scope="col">Asset</th>
                <th scope="col">Dataset</th>
                <th scope="col">Aggiornamento fonte</th>
                <th scope="col">SHA-256</th>
              </tr>
            </thead>
            <tbody>
              {assets.map(([name, asset]) => (
                <tr key={name}>
                  <th scope="row">{name}</th>
                  <td>
                    <a href={asset.url}>{asset.datasetCode}</a>
                  </td>
                  <td>{asset.sourceUpdated}</td>
                  <td>
                    <code>{asset.sha256.slice(0, 12)}…</code>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
