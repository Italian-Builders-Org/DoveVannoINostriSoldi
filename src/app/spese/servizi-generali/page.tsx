import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { compactEuro, exactEuro, longDate, percent } from "@/lib/format";
import {
  COFOG_MANUAL_URL,
  getGeneralPublicServicesView,
  parseGeneralPublicServicesYear,
} from "@/lib/general-public-services-spending";
import styles from "./servizi-generali.module.css";

export const metadata: Metadata = {
  title: "Servizi generali della PA: spesa COFOG GF01",
  description: "Spesa pubblica italiana per servizi generali COFOG GF01: dettaglio ufficiale, operazioni sul debito, serie storica e differenza dagli interessi.",
  alternates: { canonical: "/spese/servizi-generali" },
};

const euro = (cents: number) => cents / 100;
const basisPoints = (value: number) => percent(value / 100, 2);

export default async function GeneralPublicServicesPage({
  searchParams,
}: PageProps<"/spese/servizi-generali">) {
  const year = parseGeneralPublicServicesYear((await searchParams).anno);
  if (year === null) notFound();
  const view = getGeneralPublicServicesView(year);
  const maxHistory = Math.max(...view.history.map((row) => row.amountCents));
  const api = `/api/spese/cofog?paese=IT&funzione=GF01&anno=${year}`;

  return (
    <main className="shell page">
      <header className="page-intro">
        <p className="eyebrow">Italia · Eurostat COFOG GF01</p>
        <h1>Servizi generali della PA</h1>
        <p>
          GF01 raccoglie funzioni generali dello Stato e delle altre amministrazioni:
          non è sinonimo di debito e non misura soltanto la burocrazia.
        </p>
        <p className={styles.links}>
          <Link href={`/?anno=${year}#pa-split-title`}>Composizione della spesa italiana →</Link>
          <Link href="/debito">Debito pubblico →</Link>
          <a href="#gf01-fonti">Dati e fonti ↓</a>
        </p>
      </header>

      <form action="/spese/servizi-generali" className={styles.filters} aria-label="Anno della spesa per servizi generali">
        <label htmlFor="gf01-year">Anno
          <select id="gf01-year" name="anno" defaultValue={year}>
            {view.years.toReversed().map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
        </label>
        <button type="submit" className="btn btn-primary">Mostra dati</button>
      </form>
      <section className={`panel ${styles.summary}`} aria-labelledby="gf01-total-title">
        <h2 id="gf01-total-title" className="panel-title">Spesa pubblica per servizi generali · {year}</h2>
        <strong className={styles.total} data-testid="gf01-total">{compactEuro(euro(view.parent.amountCents))}</strong>
        <p className={styles.exact}>{exactEuro(euro(view.parent.amountCents))} · euro correnti</p>
        <dl className={styles.comparisons}>
          <div>
            <dt>Quota del PIL</dt>
            <dd>{percent(view.parent.shareOfGdpHundredths / 100)} · pubblicata da Eurostat</dd>
          </div>
          <div>
            <dt>Quota della spesa PA</dt>
            <dd>{basisPoints(view.parent.shareOfPublicSpendingBasisPoints)} · sul totale Eurostat {year}</dd>
          </div>
        </dl>
        <p>
          Spesa delle Amministrazioni pubbliche (S13) in competenza economica SEC 2010.
          Non sono pagamenti di cassa, stanziamenti del bilancio dello Stato o stock di debito.
        </p>
        {view.parent.flag ? <p className="notice">GF01: {view.flags[view.parent.flag]}.</p> : null}
        <p className={styles.note}>
          Fonte: <a href={view.source.landingUrl}>Eurostat, {view.source.datasetCode}</a> · dato {year} ·
          {" "}controllato il {longDate(view.source.checkedAt)}.
        </p>
      </section>
      <section className="panel" aria-labelledby="gf01-detail-title">
        <h2 id="gf01-detail-title" className="panel-title">Che cosa c’è dentro GF01</h2>
        <p>
          Eurostat pubblica otto sottofunzioni per l’Italia. Le barre mostrano la quota sul totale GF01;
          i valori esatti restano disponibili nella tabella e lo zero osservato non viene trattato come dato mancante.
        </p>
        <ul className={styles.breakdown} aria-label={`Composizione dei servizi generali nel ${year}`}>
          {view.detail.map((row) => (
            <li key={row.function} data-debt={row.function === "GF0107" ? "true" : undefined}>
              <div className={styles.breakdownHeading}>
                <span><code>{row.function}</code> {row.label}</span>
                <strong>{basisPoints(row.shareOfGf01BasisPoints)}</strong>
              </div>
              <span className={styles.bar} aria-hidden="true">
                <span style={{ width: `${row.shareOfGf01BasisPoints / 100}%` }} />
              </span>
              <span className={styles.breakdownValue}>{exactEuro(euro(row.amountCents))}</span>
            </li>
          ))}
        </ul>
        <div className="table-scroll" role="region" aria-label={`Dettaglio COFOG GF01 ${year}`} tabIndex={0}>
          <table className="table">
            <thead><tr><th scope="col">Codice e funzione</th><th scope="col" className="num">Spesa</th><th scope="col" className="num">Quota GF01</th><th scope="col" className="num">% PIL</th></tr></thead>
            <tbody>
              {view.detail.map((row) => (
                <tr key={row.function}>
                  <th scope="row"><code>{row.function}</code> {row.label}</th>
                  <td className="num">{exactEuro(euro(row.amountCents))}</td>
                  <td className="num">{basisPoints(row.shareOfGf01BasisPoints)}</td>
                  <td className="num">{percent(row.shareOfGdpHundredths / 100)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className={styles.note}>
          Le otto righe riconciliano con GF01 entro la sola tolleranza di arrotondamento dichiarata.
          Il totale resta quello pubblicato dalla fonte, non viene ricostruito dalla pagina.
        </p>
      </section>

      <section className="panel" aria-labelledby="gf01-debt-title">
        <h2 id="gf01-debt-title" className="panel-title">Operazioni sul debito non significa “tutto GF01”</h2>
        <p>
          <strong>GF0107</strong> è una delle otto sottofunzioni. Eurostat vi registra gli interessi D.41
          e il consumo intermedio P.2 legato al FISIM; i costi amministrativi della gestione del debito
          rientrano invece in GF0101. Per questo GF0107 non va letto come sinonimo della sola serie degli interessi.
        </p>
        <div className={styles.debtGrid}>
          <article>
            <span>COFOG GF0107 · {year}</span>
            <strong>{compactEuro(euro(view.debtTransactions.amountCents))}</strong>
            <p>Operazioni sul debito pubblico nel perimetro funzionale COFOG.</p>
          </article>
          {view.interestComparison ? (
            <article>
              <span>Interessi D.41 · {year}</span>
              <strong>{compactEuro(euro(view.interestComparison.interestExpenseCents))}</strong>
              <p>Serie economica separata usata nell’approfondimento sul costo degli interessi.</p>
            </article>
          ) : (
            <article>
              <span>Interessi D.41 · {year}</span>
              <strong>Confronto non disponibile</strong>
              <p>Lo snapshot del debito pubblica questa serie dal 2021; non riempiamo gli anni precedenti.</p>
            </article>
          )}
        </div>
        {view.interestComparison ? (
          <p className={styles.note}>
            Differenza osservata fra le due celle: {exactEuro(euro(view.interestComparison.differenceCents))}.
            Non è “altra spesa generale” e non viene usata come categoria derivata.
          </p>
        ) : null}
        <p><Link href="/debito">Apri stock, detentori, scadenze e interessi del debito pubblico →</Link></p>
        <p><a href={COFOG_MANUAL_URL}>Manuale metodologico COFOG di Eurostat ↗</a></p>
      </section>
      <section className="panel" aria-labelledby="gf01-history-title">
        <h2 id="gf01-history-title" className="panel-title">Come cambia GF01 nel tempo</h2>
        <p>
          Stessa divisione e stesso perimetro nazionale. Gli importi sono nominali: il confronto non corregge per l’inflazione.
        </p>
        <div className="table-scroll" role="region" aria-label="Serie storica dei servizi generali" tabIndex={0}>
          <table className={`table ${styles.history}`}>
            <caption>Eurostat COFOG GF01 · {view.period.from}-{view.period.to} · euro correnti</caption>
            <thead><tr><th scope="col">Anno</th><th scope="col" className="num">Spesa</th><th scope="col" className="num">% PIL</th></tr></thead>
            <tbody>
              {view.history.map((row) => (
                <tr key={row.year} data-selected={row.year === year ? "true" : undefined}>
                  <th scope="row">{row.year}{row.flag ? <small>{view.flags[row.flag]}</small> : null}</th>
                  <td className="num">
                    {exactEuro(euro(row.amountCents))}
                    <span className={styles.historyBar} aria-hidden="true">
                      <span style={{ width: `${row.amountCents / maxHistory * 100}%` }} />
                    </span>
                  </td>
                  <td className="num">{percent(row.shareOfGdpHundredths / 100)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <details className="data-details" id="gf01-fonti">
        <summary>Fonti, metodo e limiti</summary>
        <section className={`panel ${styles.provenance}`} aria-labelledby="gf01-source-title">
          <h2 id="gf01-source-title" className="panel-title">Eurostat · gov_10a_exp</h2>
          <p>{view.semantics.soldi.nature}. Il dettaglio pubblicato qui è limitato all’Italia, dove tutte le otto sottofunzioni GF01 sono presenti dal 2014 al 2024.</p>
          <dl className={styles.metadata}>
            <div><dt>Periodo</dt><dd>{view.semantics.periodo.referencePeriod}</dd></div>
            <div><dt>Pubblicato dalla fonte</dt><dd>{longDate(view.source.publicationDate)}</dd></div>
            <div><dt>Acquisito da noi</dt><dd>{longDate(view.source.acquisitionDate)}</dd></div>
            <div><dt>Controllato da noi</dt><dd>{longDate(view.source.checkedAt)}</dd></div>
            <div><dt>Licenza</dt><dd><a href={view.source.termsUrl}>{view.source.license}</a></dd></div>
            <div><dt>Riconciliazione</dt><dd>GF0101-GF0108 → GF01, fail-closed</dd></div>
          </dl>
          <p>
            Selezione principale: Italia (IT), amministrazioni pubbliche (S13), spesa totale (TE), funzione GF01.
            Il dettaglio usa le sottofunzioni GF0101-GF0108 dello stesso dataset e dello stesso rilascio.
          </p>
          <p><a href={api}>API del totale GF01 selezionato</a> · <Link href="/mcp">Dataset COFOG via MCP</Link></p>
          <ul>{view.caveats.map((note) => <li key={note}>{note}</li>)}</ul>
          <details>
            <summary>URL acquisiti e impronte SHA-256</summary>
            {Object.values(view.source.assets).map((asset) => (
              <p key={asset.unit}>
                <a href={asset.url}>Risposta ufficiale Eurostat ({asset.unit})</a><br />
                SHA-256: <code>{asset.sha256}</code>
              </p>
            ))}
            <p>SHA-256 dello snapshot pubblicato: <code>{view.source.dataArtifactSha256}</code>.</p>
          </details>
        </section>
      </details>
    </main>
  );
}
