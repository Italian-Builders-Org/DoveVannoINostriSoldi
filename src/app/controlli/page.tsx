import type { Metadata } from "next";
import Link from "next/link";
import {
  auditReviewedAt,
  auditScenarios,
  auditSignals,
  centralScenarioBreakdown,
  procurementComparison,
  type AuditSignal,
} from "@/lib/audit-data";
import styles from "./controlli.module.css";

export const metadata: Metadata = {
  title: "Cosa controllare",
  description: "Numeri e aree della spesa pubblica che meritano verifiche più approfondite, senza trasformare segnali in accuse.",
};

const number = new Intl.NumberFormat("it-IT", { maximumFractionDigits: 1 });

function formatSignal(signal: AuditSignal) {
  if (signal.unit === "percent") return `${number.format(signal.value)}%`;
  if (signal.unit === "billion-euro") return `${number.format(signal.value)} mld €`;
  if (signal.unit === "million-euro") return `${number.format(signal.value)} mln €`;
  return number.format(signal.value);
}

function date(value: string) {
  return new Intl.DateTimeFormat("it-IT", { day: "numeric", month: "long", year: "numeric" })
    .format(new Date(`${value}T00:00:00Z`));
}

export default function ControlsPage() {
  const maxScenario = Math.max(...auditScenarios.map((scenario) => scenario.annualBillion));
  const centralTotal = centralScenarioBreakdown.reduce((sum, item) => sum + item.value, 0);

  return (
    <main className={styles.page}>
      <header className={styles.intro}>
        <div>
          <h1>Dove vale la pena guardare meglio</h1>
          <p>
            Questi numeri aiutano a scegliere dove fare controlli più approfonditi.
            Non sono una classifica degli sprechi e non dimostrano illeciti.
          </p>
        </div>
        <aside>
          <strong>Dossier verificato il {date(auditReviewedAt)}</strong>
          <span>Dati con date diverse: ogni riquadro mostra il proprio periodo.</span>
        </aside>
      </header>

      <section className={styles.readingRule} aria-label="Come leggere questa pagina">
        <strong>La regola più importante</strong>
        <p>Flussi, stock, costi di una misura e scenari non si sommano. Colori e parole li tengono separati.</p>
        <div>
          <span data-tone="observed">Dato osservato</span>
          <span data-tone="attention">Da controllare</span>
          <span data-tone="policy">Scelta di policy</span>
          <span data-tone="stock">Stock accumulato</span>
        </div>
      </section>

      <section className={styles.procurement} aria-labelledby="procurement-title">
        <header>
          <div>
            <h2 id="procurement-title">Appalti: tanti affidamenti, una quota di valore più piccola</h2>
            <p>Sopra 40.000 euro, affidamenti diretti e negoziate senza bando pesano in modo molto diverso per numero e per valore.</p>
          </div>
          <a href="https://www.anticorruzione.it/" target="_blank" rel="noreferrer">Fonte ANAC ↗</a>
        </header>
        <div className={styles.comparisonRows}>
          <div>
            <span><strong>{number.format(procurementComparison.byNumber)}%</strong> delle procedure</span>
            <div aria-hidden="true"><i style={{ width: `${procurementComparison.byNumber}%` }} /></div>
            <p>Misura quante procedure usano queste modalità.</p>
          </div>
          <div>
            <span><strong>{number.format(procurementComparison.byValue)}%</strong> del valore</span>
            <div aria-hidden="true"><i style={{ width: `${procurementComparison.byValue}%` }} /></div>
            <p>Circa {number.format(procurementComparison.exposedValueBillion)} miliardi su {number.format(procurementComparison.totalValueBillion)}.</p>
          </div>
        </div>
        <footer>Minore confronto competitivo significa più bisogno di confrontare prezzi, motivazioni e rotazione. Non significa automaticamente corruzione.</footer>
      </section>

      <section className={styles.signals} aria-labelledby="signals-title">
        <header>
          <h2 id="signals-title">Sei numeri, sei significati diversi</h2>
          <p>Apri la fonte per controllare il perimetro originale.</p>
        </header>
        <div>
          {auditSignals.map((signal) => (
            <article key={signal.id} data-tone={signal.tone}>
              <div><span>{signal.area}</span><small>{signal.referenceDate}</small></div>
              <strong>{formatSignal(signal)}</strong>
              <h3>{signal.label}</h3>
              <p>{signal.plainMeaning}</p>
              <aside>{signal.caveat}</aside>
              <a href={signal.source.url} target="_blank" rel="noreferrer">
                {signal.source.institution}: apri la fonte <span>↗</span>
              </a>
            </article>
          ))}
        </div>
      </section>

      <section className={styles.scenarios} aria-labelledby="scenarios-title">
        <header>
          <div>
            <h2 id="scenarios-title">Tre ipotesi di miglioramento annuale</h2>
            <p>Sono esercizi di policy basati su percentuali dichiarate. Non sono soldi già recuperati né previsioni.</p>
          </div>
          <Link href="/metodologia">Come leggiamo gli scenari <span>→</span></Link>
        </header>
        <div className={styles.scenarioBars}>
          {auditScenarios.map((scenario) => (
            <div key={scenario.id}>
              <span>{scenario.label}</span>
              <div aria-hidden="true"><i style={{ width: `${(scenario.annualBillion / maxScenario) * 100}%` }} /></div>
              <strong>{number.format(scenario.annualBillion)} mld €/anno</strong>
            </div>
          ))}
        </div>
        <div className={styles.centralBreakdown}>
          <h3>Da cosa nasce lo scenario centrale di {number.format(centralTotal)} miliardi</h3>
          {centralScenarioBreakdown.map((item) => (
            <div key={item.label} data-tone={item.tone}>
              <span>{item.label}</span><strong>{number.format(item.value)} mld €</strong>
            </div>
          ))}
        </div>
      </section>

      <section className={styles.close}>
        <h2>Un segnale serve ad aprire una verifica, non a chiuderla.</h2>
        <p>Prima di giudicare un ente bisogna conoscere quantità, servizio, periodo, regole applicabili e fonte originale.</p>
        <Link href="/fonti">Vai alle fonti ufficiali <span>→</span></Link>
      </section>
    </main>
  );
}
