import type { Metadata } from "next";
import Link from "next/link";

import { getDeputiesVsWagesComparison } from "@/lib/deputati-indennita-salari";

import { IndemnityWagesChart } from "./indemnity-wages-chart";
import styles from "./indennita.module.css";

export const metadata: Metadata = {
  title: "Indennità dei deputati e salari degli italiani dal 2005",
  description:
    "Indennità lorda dei deputati e retribuzioni contrattuali ISTAT dal 2005 a oggi, in valori nominali e al netto dei prezzi, con i gradini decisi dalla Camera e le fonti.",
};

// Built once from versioned snapshots: no per-request work.
export const dynamic = "force-static";

const euro = new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR", minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: "always" });
const euroRound = new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR", maximumFractionDigits: 0, useGrouping: "always" });
const oneDecimal = new Intl.NumberFormat("it-IT", { maximumFractionDigits: 1, minimumFractionDigits: 1 });

function signedPct(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  if (rounded === 0) return "0,0%";
  return `${rounded > 0 ? "+" : "−"}${oneDecimal.format(Math.abs(rounded))}%`;
}

const FREQUENCY = { monthly: "mensile", quarterly: "trimestrale", annual: "annuo" } as const;
const NATURE = {
  gross: "Lordo",
  "net-before-local-surtaxes": "Netto prima delle addizionali",
  allowance: "Rimborso",
  withholding: "Trattenuta",
} as const;

function stepStart(step: { fromYear: number | null; fromDate: string | null }): string {
  if (step.fromDate) {
    const [year, month, day] = step.fromDate.split("-");
    return `${day}/${month}/${year}`;
  }
  return step.fromYear === null ? "prima della riduzione" : String(step.fromYear);
}

export default function DeputiesIndemnityPage() {
  const data = getDeputiesVsWagesComparison();
  const { headline, baseYear, lastYear } = data;
  const chartRows = data.rows.map((row) => ({
    year: row.year,
    indemnityNominal: row.indemnityNominal,
    contractualNominal: row.contractualNominal,
    prices: row.prices,
    indemnityReal: row.indemnityReal,
    contractualReal: row.contractualReal,
  }));

  return (
    <main className="shell page">
      <div className="page-intro">
        <h1>Indennità dei deputati e salari degli italiani, dal {baseYear} al {lastYear}</h1>
        <p>
          Dal {baseYear} l&apos;indennità lorda di un deputato è scesa da {euro.format(headline.indemnityFirstCents / 100)} a{" "}
          {euro.format(headline.indemnityLastCents / 100)} al mese ed è ferma dal 2012. Nello stesso periodo le retribuzioni
          fissate dai contratti collettivi sono salite del {oneDecimal.format(headline.contractualNominalPct)}%, quasi quanto i
          prezzi. Qui mettiamo a confronto le due serie, in valori nominali e al netto dell&apos;inflazione.
        </p>
      </div>

      <dl className="stat-strip">
        <div>
          <dt>Indennità lorda oggi</dt>
          <dd>{euroRound.format(headline.indemnityLastCents / 100)}</dd>
          <span className="stat-note">al mese, adeguamenti sospesi dal {data.freeze.adjustmentsSuspendedFromYear}</span>
        </div>
        <div>
          <dt>Indennità {baseYear}-{lastYear}</dt>
          <dd>{signedPct(headline.indemnityNominalPct)}</dd>
          <span className="stat-note">al netto dei prezzi {signedPct(headline.indemnityRealPct)}</span>
        </div>
        <div>
          <dt>Retribuzioni contrattuali {baseYear}-{lastYear}</dt>
          <dd>{signedPct(headline.contractualNominalPct)}</dd>
          <span className="stat-note">al netto dei prezzi {signedPct(headline.contractualRealPct)}</span>
        </div>
        <div>
          <dt>Prezzi al consumo {baseYear}-{lastYear}</dt>
          <dd>{signedPct(headline.pricesPct)}</dd>
          <span className="stat-note">indice FOI, lo stesso usato dalla Camera</span>
        </div>
      </dl>

      <div className={styles.sections}>
        <section className="panel" aria-labelledby="confronto">
          <h2 id="confronto" className="panel-title">Il confronto anno per anno</h2>
          <p className={styles.lede}>
            Entrambe le serie partono da 100 nel {baseYear}. L&apos;indennità segue i gradini decisi dalla Camera; le
            retribuzioni contrattuali sono l&apos;indice ISTAT per dipendente di tutta l&apos;economia, dirigenti esclusi.
          </p>
          <IndemnityWagesChart rows={chartRows} baseYear={baseYear} />
        </section>

        <section className="panel" aria-labelledby="come-leggere">
          <h2 id="come-leggere" className="panel-title">Come leggere il confronto</h2>
          <ul className={styles.points}>
            <li>
              L&apos;indennità è la tariffa istituzionale uguale per tutti i deputati: non è la busta paga della singola
              persona, che cambia con riduzioni, assenze e indennità di carica.
            </li>
            <li>
              Le retribuzioni contrattuali misurano quanto stabiliscono i contratti collettivi, non quanto viene
              effettivamente pagato: straordinari, premi e cambi di qualifica restano fuori.
            </li>
            <li>
              Confrontiamo andamenti, non livelli: un indice a 100 nel {baseYear} non dice che un deputato e un dipendente
              guadagnassero la stessa cifra.
            </li>
            <li>
              Con l&apos;indice europeo HICP al posto del FOI il risultato cambia poco: al netto dei prezzi l&apos;indennità
              fa {signedPct(headline.indemnityRealHicpPct)} e le retribuzioni contrattuali {signedPct(headline.contractualRealHicpPct)}.
            </li>
            <li>
              Diaria e rimborsi non sono reddito ma sono denaro pubblico: li mostriamo sotto, separati dall&apos;indennità.
              Il costo complessivo della Camera è nella pagina <Link href="/parlamento">Spese di Camera, Senato e Quirinale</Link>.
            </li>
          </ul>
        </section>

        <section className="panel" aria-labelledby="gradini">
          <h2 id="gradini" className="panel-title">I gradini decisi dalla Camera</h2>
          <p className={styles.lede}>
            Ogni riga riporta la frase della pagina ufficiale da cui viene l&apos;importo. Dal {data.freeze.adjustmentsSuspendedFromYear} gli
            adeguamenti automatici sono sospesi, con proroghe fino al {data.freeze.confirmedThroughYear}.
          </p>
          <div className="table-scroll" role="region" aria-labelledby="gradini-tabella" tabIndex={0}>
            <table className="table">
              <caption id="gradini-tabella" className="table-caption">Importi per voce e anno di inizio</caption>
              <thead>
                <tr>
                  <th scope="col">Voce</th>
                  <th scope="col">Dal</th>
                  <th scope="col" className="num">Importo</th>
                </tr>
              </thead>
              <tbody>
                {data.steps.map((step, index) => (
                  <tr key={`${step.componentId}-${step.fromYear ?? "inizio"}-${step.amountCents}`} data-step={step.componentId}>
                    <th scope="row">
                      {step.label}
                      {/* The same sentence often sets two steps: quote it once. */}
                      {index > 0 && data.steps[index - 1]!.evidence === step.evidence
                        ? <span className={styles.evidence}>Stessa frase della riga precedente.</span>
                        : <span className={styles.evidence}>«{step.evidence}»</span>}
                    </th>
                    <td>
                      {stepStart(step)}
                      {step.derived ? <> <span className={styles.badge}>ricavato</span></> : null}
                    </td>
                    <td className="num">{euro.format(step.amountCents / 100)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className={styles.lede}>
            «Ricavato» indica un importo calcolato dalla riduzione dichiarata dalla Camera, non citato come cifra.
          </p>
        </section>

        <section className="panel" aria-labelledby="in-vigore">
          <h2 id="in-vigore" className="panel-title">Il trattamento in vigore</h2>
          <p className={styles.lede}>
            Le trattenute escono dall&apos;indennità lorda: non sono somme in più. I rimborsi coprono spese del mandato e non
            entrano nel confronto con i salari.
          </p>
          <div className="table-scroll" role="region" aria-labelledby="in-vigore-tabella" tabIndex={0}>
            <table className="table">
              <caption id="in-vigore-tabella" className="table-caption">Voci pubblicate dalla Camera</caption>
              <thead>
                <tr>
                  <th scope="col">Voce</th>
                  <th scope="col">Natura</th>
                  <th scope="col">Periodicità</th>
                  <th scope="col" className="num">Importo</th>
                </tr>
              </thead>
              <tbody>
                {data.components.map((component) => (
                  <tr key={component.id} data-component={component.id}>
                    <th scope="row">{component.label}</th>
                    <td><span className={styles.badge}>{NATURE[component.grossNet]}</span></td>
                    <td>{FREQUENCY[component.frequency]}</td>
                    <td className="num">{euro.format(component.amountCents / 100)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="panel" aria-labelledby="fonti">
          <h2 id="fonti" className="panel-title">Fonti</h2>
          <ul className={styles.sources}>
            {data.sources.map((source) => (
              <li key={source.id} data-source={source.id}>
                <a href={source.url} target="_blank" rel="noreferrer" aria-label={`${source.owner}: ${source.title}, in una nuova scheda`}>
                  {source.owner}: {source.title} ↗
                </a>
                <small>
                  Periodo {source.period} · acquisita il {source.acquiredOn.split("-").reverse().join("/")} · licenza:{" "}
                  {source.license === "not-declared" ? "non dichiarata dalla fonte" : source.license}
                </small>
              </li>
            ))}
          </ul>
        </section>

        <section className="panel" aria-labelledby="non-ancora">
          <h2 id="non-ancora" className="panel-title">Cosa non c&apos;è ancora</h2>
          <ul className={styles.points}>
            <li>
              Senato: la pagina del trattamento economico blocca le richieste automatiche, quindi non pubblichiamo importi
              finché non si possono fissare testo e hash della fonte.
            </li>
            <li>
              Ministri, sottosegretari e vertici della pubblica amministrazione: le serie sono in lavorazione e non
              usiamo cifre da fonti non acquisite.
            </li>
            <li>
              L&apos;indennità parte dal 2005 perché la pagina della Camera parte da lì.
            </li>
          </ul>
          <div className={styles.links}>
            <Link href="/parlamento">Spese di Camera, Senato e Quirinale</Link>
            <a href="https://github.com/Italian-Builders-Org/DoveVannoINostriSoldi/issues/825" target="_blank" rel="noreferrer">
              Lavori in corso su questi dati ↗
            </a>
          </div>
        </section>
      </div>
    </main>
  );
}
