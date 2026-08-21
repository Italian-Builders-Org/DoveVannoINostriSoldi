import type { CSSProperties } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { queryCptRegionalFiscal } from "@/lib/cpt-regional-fiscal-snapshot";
import { longDate } from "@/lib/format";
import styles from "./fisco.module.css";

export const metadata: Metadata = {
  title: "Entrate e spese pubbliche per territorio",
  description:
    "Entrate, spese e saldo contabile territorializzato della Pubblica Amministrazione consolidata, con valori pro capite CPT 2023.",
};

const euro = new Intl.NumberFormat("it-IT", {
  style: "currency",
  currency: "EUR",
  maximumFractionDigits: 0,
});

const billionEuro = new Intl.NumberFormat("it-IT", {
  style: "currency",
  currency: "EUR",
  notation: "compact",
  maximumFractionDigits: 1,
});

function exactFromCents(cents: number): string {
  return euro.format(cents / 100);
}

function compactFromCents(cents: number): string {
  return billionEuro.format(cents / 100);
}

function signedFromCents(cents: number): string {
  const value = exactFromCents(Math.abs(cents));
  if (cents > 0) return `+${value}`;
  if (cents < 0) return `−${value}`;
  return value;
}

export default function RegionalFiscalPage() {
  const data = queryCptRegionalFiscal();
  const rows = [...data.rows].sort(
    (left, right) => (right.balancePerCapitaCents ?? 0) - (left.balancePerCapitaCents ?? 0),
  );
  const maxBalance = Math.max(...rows.map((row) => Math.abs(row.balancePerCapitaCents ?? 0)), 1);

  return (
    <main className="shell page">
      <div className="page-intro">
        <h1>Entrate e spese pubbliche, regione per regione</h1>
        <p>
          Confronto {data.year} della Pubblica Amministrazione consolidata nei Conti Pubblici
          Territoriali. La vista è ordinata per saldo pro capite; i totali assoluti restano nella
          tabella. Entrate e spese sono flussi di cassa attribuiti al territorio, non il bilancio
          della sola Regione. Le entrate territorializzate non equivalgono alle tasse versate dai
          residenti: includono le componenti definite dal perimetro CPT.
        </p>
      </div>

      <div className={styles.formula}>
        <span className={styles.visuallyHidden}>
          Il saldo contabile territoriale è uguale alle entrate territorializzate meno le spese territorializzate.
        </span>
        <div className={styles.formulaVisual} aria-hidden="true">
          <span>Entrate territorializzate</span>
          <b>−</b>
          <span>Spese territorializzate</span>
          <b>=</b>
          <strong>Saldo contabile territoriale</strong>
        </div>
      </div>

      <section className="panel" aria-labelledby="fiscal-chart-title">
        <div className={styles.sectionHeading}>
          <div>
            <h2 className="panel-title" id="fiscal-chart-title">Saldo pro capite · {data.year}</h2>
            <p>Un segno positivo indica entrate superiori alle spese nel perimetro CPT PA; un segno negativo indica il contrario.</p>
          </div>
          <div className={styles.legend} aria-label="Legenda">
            <span><i className={styles.positiveSwatch} />Entrate maggiori</span>
            <span><i className={styles.negativeSwatch} />Spese maggiori</span>
          </div>
        </div>

        <ol className={styles.balanceChart} aria-label="Territori ordinati per saldo contabile pro capite">
          {rows.map((row) => {
            const balance = row.balancePerCapitaCents ?? 0;
            const width = `${Math.max((Math.abs(balance) / maxBalance) * 100, 1)}%`;
            return (
              <li key={row.regionCode}>
                <span className={styles.regionName}>{row.region}</span>
                <span className={styles.axis} aria-hidden="true">
                  <span
                    className={balance >= 0 ? styles.positiveBar : styles.negativeBar}
                    style={{ "--bar-width": width } as CSSProperties}
                  />
                </span>
                <strong className={styles.balanceValue}>
                  <span className={styles.visuallyHidden}>{balance >= 0 ? "positivo" : "negativo"}: </span>
                  {signedFromCents(balance)}
                </strong>
              </li>
            );
          })}
        </ol>
        <p className={styles.note}>Importi per abitante, popolazione ISTAT al 31 dicembre 2023.</p>
      </section>

      <section className="panel" aria-labelledby="fiscal-table-title">
        <h2 className="panel-title" id="fiscal-table-title">Entrate, spese e saldo</h2>
        <div
          className="table-scroll"
          role="region"
          aria-label="Dettaglio entrate e spese per territorio; scorri orizzontalmente per vedere tutte le colonne"
          tabIndex={0}
        >
          <table className="table">
            <caption className={styles.visuallyHidden}>Valori CPT PA consolidati {data.year}, ordinati per saldo pro capite</caption>
            <thead>
              <tr>
                <th scope="col">Territorio</th>
                <th scope="col" className="num">Entrate per abitante</th>
                <th scope="col" className="num">Spese per abitante</th>
                <th scope="col" className="num">Saldo per abitante</th>
                <th scope="col" className="num">Entrate totali</th>
                <th scope="col" className="num">Spese totali</th>
                <th scope="col" className="num">Saldo totale</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.regionCode} id={`regione-${row.regionCode}`}>
                  <th scope="row">{row.region}</th>
                  <td className="num">{exactFromCents(row.revenuePerCapitaCents ?? 0)}</td>
                  <td className="num">{exactFromCents(row.expenditurePerCapitaCents ?? 0)}</td>
                  <td className="num">{signedFromCents(row.balancePerCapitaCents ?? 0)}</td>
                  <td className="num">{compactFromCents(row.revenueCents)}</td>
                  <td className="num">{compactFromCents(row.expenditureCents)}</td>
                  <td className="num">{signedFromCents(row.balanceCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="notice">
        <strong>Questo non è un voto alle regioni</strong>
        <p>{data.methodology.warning} {data.methodology.notFiscalResidual}</p>
      </div>

      <section className={styles.methodology} aria-labelledby="fiscal-method-title">
        <h2 id="fiscal-method-title">Come leggere questi dati</h2>
        <dl>
          <div><dt>Perimetro</dt><dd>{data.definitions.scope}</dd></div>
          <div><dt>Base contabile</dt><dd>{data.definitions.accountingBasis}</dd></div>
          <div><dt>Formula</dt><dd>{data.definitions.balanceFormula}</dd></div>
          <div><dt>Comparabilità</dt><dd>{data.methodology.comparability}</dd></div>
        </dl>
        <p>
          Fonte: <a href={data.provenance.catalogUrl} target="_blank" rel="noreferrer">Sistema Conti Pubblici Territoriali: catalogo ufficiale<span className={styles.visuallyHidden}>, si apre in una nuova scheda</span></a>.
          Snapshot verificato il {longDate(data.provenance.observedAt)}; i dati arrivano al {data.year}. <Link href="/fonti/stato">Controlla lo stato delle fonti →</Link>
        </p>
        <div className={styles.sources}>
          <h3>Fonti e verifiche</h3>
          <ul>
            {data.provenance.inputs.map((input) => {
              const label = input.kind === "revenue" ? "Entrate CPT" : input.kind === "expenditure" ? "Spese CPT" : "Popolazione ISTAT";
              return (
                <li key={input.kind}>
                  <a href={input.resourceUrl} target="_blank" rel="noreferrer">{label}<span className={styles.visuallyHidden}>, si apre in una nuova scheda</span></a>
                  <code title={input.sha256}>SHA-256 {input.sha256.slice(0, 12)}…</code>
                </li>
              );
            })}
          </ul>
          <p>{data.provenance.rightsNote} La serie completa 2000-2023 è interrogabile tramite API e MCP; il pro capite resta limitato al 2023, l’anno con denominatore demografico verificato.</p>
        </div>
      </section>
    </main>
  );
}
