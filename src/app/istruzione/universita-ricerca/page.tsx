import type { Metadata } from "next";
import Link from "next/link";
import { ChartDataTable } from "@/components/charts/chart-data-table";
import { compactEuro, exactEuro, longDate } from "@/lib/format";
import { getUniversityResearchView } from "@/lib/university-research";
import styles from "./universita-ricerca.module.css";

export const metadata: Metadata = {
  title: "Università e Ricerca: stanziamenti dello Stato",
  description: "Dieci anni di stanziamenti di competenza per Università e Ricerca: due missioni RGS distinte, con serie annuali, fonti e valori in euro.",
};

export default function UniversityResearchPage() {
  const view = getUniversityResearchView();
  const lastYear = view.years.at(-1)!;
  const scale = Math.max(...view.missions.flatMap((mission) =>
    mission.allocations.map((point) => point.amountEur)), 1);

  return (
    <main className={`shell page ${styles.page}`}>
      <header className="page-intro">
        <p className="eyebrow">Istruzione · Bilancio dello Stato</p>
        <h1>Università e Ricerca</h1>
        <p>
          Quanto viene stanziato ogni anno? Le Leggi di Bilancio dal {view.years[0]} al {lastYear}
          {" "}mostrano due missioni distinte: formazione universitaria e ricerca.
          Gli importi sono autorizzazioni di spesa, non pagamenti effettuati.
        </p>
        <p className={styles.links}>
          <Link href="/istruzione">Atlante della scuola →</Link>
          <Link href="/spese/legge-di-bilancio">Tutte le missioni di bilancio →</Link>
          <a href="#fonti">Dati e fonti ↓</a>
        </p>
      </header>

      <dl className="stat-strip">
        {view.missions.map((mission) => (
          <div key={mission.code}>
            <dt>{mission.title} · {lastYear}</dt>
            <dd>{compactEuro(mission.allocations.at(-1)!.amountEur)}</dd>
            <span className="stat-note">Stanziamento di competenza · missione {mission.code}</span>
          </div>
        ))}
      </dl>

      <div className="notice">
        <strong>Come leggere il confronto</strong>
        <p>
          Valori in euro correnti, non corretti per l’inflazione. La ricerca comprende anche
          enti non universitari. Le due missioni restano separate: non rappresentano il totale
          dei bilanci degli atenei né tutta la spesa italiana per ricerca.
        </p>
      </div>

      <div className={styles.series}>
        {view.missions.map((mission) => (
          <section className={`panel ${styles.section}`} key={mission.code} aria-labelledby={`mission-${mission.code}`}>
            <h2 id={`mission-${mission.code}`} className="panel-title">{mission.title}</h2>
            <p className={styles.description}>{mission.label} · missione {mission.code}</p>
            <p>{mission.note}</p>
            <figure className={styles.chart}>
              <figcaption>Stanziamenti annuali · stessa scala per le due missioni, da zero a {compactEuro(scale)}</figcaption>
              <ol className={styles.bars}>
                {mission.allocations.map((point) => (
                  <li key={point.year}>
                    <div className={styles.barLabel}><span>{point.year}</span><span>{compactEuro(point.amountEur)}</span></div>
                    <div className={styles.track} aria-hidden="true">
                      <span style={{ width: `${point.amountEur / scale * 100}%` }} />
                    </div>
                  </li>
                ))}
              </ol>
            </figure>
          </section>
        ))}
      </div>

      <section className="panel" aria-labelledby="annual-values">
        <h2 id="annual-values" className="panel-title">Valori annuali in euro</h2>
        <p>Stanziamenti di competenza del primo anno di ciascuna Legge di Bilancio (CP A1).</p>
        <ChartDataTable
          label="Stanziamenti annuali per Università e Ricerca, in euro correnti"
          columns={view.missions.map((mission) => `${mission.title} (${mission.code})`)}
          rows={view.years.map((year, index) => ({
            label: String(year),
            values: view.missions.map((mission) => exactEuro(mission.allocations[index].amountEur)),
          }))}
        />
      </section>

      <section className="panel" id="fonti" aria-labelledby="sources-title">
        <h2 id="sources-title" className="panel-title">Dati e fonti</h2>
        <p>
          Fonte: RGS / OpenBDAP, <a href={view.dataset.apiUrl}>{view.dataset.title}</a>.
          {" "}<a href={view.dataset.csvUrl}>Scarica il CSV ufficiale</a>.
        </p>
        <dl className={styles.metadata}>
          <div><dt>Periodo di riferimento</dt><dd>{view.years[0]}-{lastYear}</dd></div>
          <div><dt>Snapshot acquisito</dt><dd>{longDate(view.observedAt)}</dd></div>
          <div><dt>Metadati aggiornati dalla fonte</dt><dd>{longDate(view.dataset.metadataModified)}</dd></div>
          <div><dt>Licenza dichiarata</dt><dd><a href={view.dataset.licenseUrl}>{view.dataset.license}</a></dd></div>
        </dl>
        <p>
          Usiamo lo snapshot verificato, con una classificazione stabile delle missioni dal 2017.
          Sommiamo le voci della stessa missione fra le amministrazioni, senza limitarci al ministero
          competente: la separazione fra MIUR, MI e MUR non cambia il filtro.
        </p>
        <details className={styles.limits}>
          <summary>Che cosa non dimostra da solo</summary>
          <p>
            Questi stanziamenti non misurano pagamenti, qualità didattica, risultati scientifici
            o efficienza. Non isolano il riparto FFO, i bilanci dei singoli atenei, PRIN o progetti PNRR:
            queste analisi richiedono fonti e perimetri propri. Non sommare la serie ai pagamenti
            OpenBDAP o SIOPE.
          </p>
        </details>
        <p><Link href="/mcp">Interroga i dati via MCP</Link> · <Link href="/metodologia">Metodo e definizioni</Link></p>
      </section>
    </main>
  );
}
