import type { Metadata } from "next";
import Link from "next/link";
import { compactEuro, exactEuro, integer, longDate, percent } from "@/lib/format";
import { consulentiSnapshot as snapshot } from "@/lib/consulenti-snapshot";
import styles from "./incarichi.module.css";
import { assertIncarichiOverviewScope } from "./overview";

export const metadata: Metadata = {
  title: "Incarichi pubblici",
  description:
    "Quadro nazionale annuale degli incarichi esterni e degli incarichi ai dipendenti pubblici, con fonte e limiti espliciti.",
};

function euros(paidCents: number): number {
  return paidCents / 100;
}

function validShare(part: number, denominator: number): number | null {
  if (denominator <= 0 || part < 0 || part > denominator) return null;
  return (part / denominator) * 100;
}

function shareLabel(part: number, denominator: number): string {
  const share = validShare(part, denominator);
  return share === null ? "non disponibile" : percent(share);
}

const scopedSnapshot = assertIncarichiOverviewScope(snapshot);
const firstYear = scopedSnapshot.externalAppointments[0].year;
const yearRange = `${firstYear}-${scopedSnapshot.latestYear}`;
const latestExternal = scopedSnapshot.externalAppointments.at(-1)!;
const latestEmployee = scopedSnapshot.employeeAppointments.at(-1)!;
const latestRecipientDenominator =
  latestExternal.individualRecipients + latestExternal.organizationRecipients;
const maxAssignments = Math.max(
  ...scopedSnapshot.externalAppointments.map((item) => item.assignments),
  ...scopedSnapshot.employeeAppointments.map((item) => item.assignments),
);

export default function IncarichiPage() {
  return (
    <main className="shell page">
      <nav className={styles.breadcrumb} aria-label="Percorso">
        <Link href="/">Home</Link>
        <span aria-hidden="true">/</span>
        <Link href="/enti">Enti e società</Link>
        <span aria-hidden="true">/</span>
        <span aria-current="page">Incarichi pubblici</span>
      </nav>

      <div className="page-intro">
        <h1>Incarichi pubblici</h1>
        <p>
          Quadro nazionale annuale degli incarichi comunicati dalle amministrazioni. La serie copre
          il periodo {yearRange}; gli importi mostrano quanto risulta pagato, non compensi lordi
          previsti.
        </p>
      </div>

      <div className={styles.scopeBand} role="group" aria-label="Perimetro della vista">
        <div>
          <span>Periodo</span>
          <strong>{yearRange}</strong>
        </div>
        <div>
          <span>Ambito</span>
          <strong>Italia · aggregato nazionale</strong>
        </div>
        <div>
          <span>Unità monetaria</span>
          <strong>Quanto risulta pagato · euro</strong>
        </div>
        <div>
          <span>Ultimo dato</span>
          <strong>{scopedSnapshot.latestYear} · parziale</strong>
        </div>
      </div>

      <div className="notice warning-notice">
        <strong>2026 è un anno parziale</strong>
        <p>
          I dati più recenti possono crescere o cambiare con nuove comunicazioni. Per questo non
          usiamo il 2026 come confronto definitivo con gli anni chiusi e non sommiamo le due serie.
        </p>
      </div>

      <section className={styles.latestGrid} aria-labelledby="latest-title">
        <h2 id="latest-title" className={styles.visuallyHidden}>
          Ultimo anno osservato
        </h2>
        <article className="panel">
          <div className={styles.sectionHead}>
            <h2 className="panel-title">Incarichi esterni</h2>
            <span>{latestExternal.year} · parziale</span>
          </div>
          <dl className={styles.metricList}>
            <div>
              <dt>Incarichi</dt>
              <dd>{integer(latestExternal.assignments)}</dd>
            </div>
            <div>
              <dt>Conclusi</dt>
              <dd>{integer(latestExternal.completedAssignments)}</dd>
            </div>
            <div>
              <dt>Quanto risulta pagato</dt>
              <dd>
                <strong>{compactEuro(euros(latestExternal.paidCents))}</strong>
                <small>{exactEuro(euros(latestExternal.paidCents))}</small>
              </dd>
            </div>
          </dl>
          <p className={styles.note}>
            La serie riguarda incarichi affidati a soggetti esterni; non include gli incarichi ai
            dipendenti.
          </p>
        </article>

        <article className="panel">
          <div className={styles.sectionHead}>
            <h2 className="panel-title">Incarichi ai dipendenti</h2>
            <span>{latestEmployee.year} · parziale</span>
          </div>
          <dl className={styles.metricList}>
            <div>
              <dt>Incarichi</dt>
              <dd>{integer(latestEmployee.assignments)}</dd>
            </div>
            <div>
              <dt>Conclusi</dt>
              <dd>{integer(latestEmployee.completedAssignments)}</dd>
            </div>
            <div>
              <dt>Quanto risulta pagato</dt>
              <dd>
                <strong>{compactEuro(euros(latestEmployee.paidCents))}</strong>
                <small>{exactEuro(euros(latestEmployee.paidCents))}</small>
              </dd>
            </div>
          </dl>
          <p className={styles.note}>
            La serie riguarda incarichi a personale dipendente; non è la stessa popolazione degli
            incarichi esterni.
          </p>
        </article>
      </section>

      <section className="panel" aria-labelledby="trend-title">
        <div className={styles.sectionHead}>
          <h2 id="trend-title" className="panel-title">
            Trend degli incarichi
          </h2>
          <span>scala comune · le serie non si sommano</span>
        </div>
        <figure className={styles.trend}>
          <figcaption>
            Barre proporzionali al numero di incarichi più alto tra le due serie nel periodo. I
            valori numerici restano il riferimento esatto.
          </figcaption>
          <div className={styles.trendRows}>
            {scopedSnapshot.externalAppointments.map((external, index) => {
              const employee = scopedSnapshot.employeeAppointments[index];
              const externalWidth = (external.assignments / maxAssignments) * 100;
              const employeeWidth = (employee.assignments / maxAssignments) * 100;
              return (
                <div className={styles.trendYear} key={external.year}>
                  <strong>{external.year}</strong>
                  <div className={styles.trendLine}>
                    <span className={styles.trendLabel}>Esterni</span>
                    <span className={styles.track} aria-hidden="true">
                      <i className={styles.externalBar} style={{ width: `${externalWidth}%` }} />
                    </span>
                    <span className={styles.trendValue}>{integer(external.assignments)}</span>
                  </div>
                  <div className={styles.trendLine}>
                    <span className={styles.trendLabel}>Dipendenti</span>
                    <span className={styles.track} aria-hidden="true">
                      <i className={styles.employeeBar} style={{ width: `${employeeWidth}%` }} />
                    </span>
                    <span className={styles.trendValue}>{integer(employee.assignments)}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </figure>
        <p className={styles.note}>
          Il 2026 è evidenziato nel testo come parziale: le barre servono a orientarsi nella serie,
          non a stabilire una graduatoria o una valutazione.
        </p>
      </section>

      <section className={styles.comparisonGrid} aria-labelledby="composition-title">
        <h2 id="composition-title" className={styles.visuallyHidden}>
          Composizioni nell&apos;ultimo anno
        </h2>
        <section className="panel">
          <h2 className="panel-title">Destinatari degli incarichi esterni</h2>
          <p className={styles.noteIntro}>
            Percentuali calcolate sul denominatore esplicito: destinatari individuali + organizzazioni
            censite ({integer(latestRecipientDenominator)}).
          </p>
          <div className={styles.composition}>
            <div className={styles.compositionRow}>
              <div className={styles.compositionLabel}>
                <span>Individuali</span>
                <strong>{shareLabel(latestExternal.individualRecipients, latestRecipientDenominator)}</strong>
              </div>
              <div className={styles.compositionTrack} aria-hidden="true">
                <i
                  className={styles.externalBar}
                  style={{ width: `${validShare(latestExternal.individualRecipients, latestRecipientDenominator) ?? 0}%` }}
                />
              </div>
              <small>{integer(latestExternal.individualRecipients)} destinatari censiti</small>
            </div>
            <div className={styles.compositionRow}>
              <div className={styles.compositionLabel}>
                <span>Organizzazioni</span>
                <strong>{shareLabel(latestExternal.organizationRecipients, latestRecipientDenominator)}</strong>
              </div>
              <div className={styles.compositionTrack} aria-hidden="true">
                <i
                  className={styles.employeeBar}
                  style={{ width: `${validShare(latestExternal.organizationRecipients, latestRecipientDenominator) ?? 0}%` }}
                />
              </div>
              <small>{integer(latestExternal.organizationRecipients)} destinatari censiti</small>
            </div>
          </div>
          <p className={styles.note}>
            Il denominatore non è il numero totale degli incarichi: le due grandezze rispondono a
            domande diverse.
          </p>
        </section>

        <section className="panel">
          <h2 className="panel-title">Ruoli negli incarichi ai dipendenti</h2>
          <p className={styles.noteIntro}>
            Percentuali calcolate sul denominatore esplicito: totale incarichi ai dipendenti ({integer(
              latestEmployee.assignments,
            )}).
          </p>
          <div className={styles.composition}>
            <div className={styles.compositionRow}>
              <div className={styles.compositionLabel}>
                <span>Dirigenti</span>
                <strong>{shareLabel(latestEmployee.managerAssignments, latestEmployee.assignments)}</strong>
              </div>
              <div className={styles.compositionTrack} aria-hidden="true">
                <i
                  className={styles.externalBar}
                  style={{ width: `${validShare(latestEmployee.managerAssignments, latestEmployee.assignments) ?? 0}%` }}
                />
              </div>
              <small>{integer(latestEmployee.managerAssignments)} incarichi</small>
            </div>
            <div className={styles.compositionRow}>
              <div className={styles.compositionLabel}>
                <span>Non dirigenti</span>
                <strong>{shareLabel(latestEmployee.nonManagerAssignments, latestEmployee.assignments)}</strong>
              </div>
              <div className={styles.compositionTrack} aria-hidden="true">
                <i
                  className={styles.employeeBar}
                  style={{ width: `${validShare(latestEmployee.nonManagerAssignments, latestEmployee.assignments) ?? 0}%` }}
                />
              </div>
              <small>{integer(latestEmployee.nonManagerAssignments)} incarichi</small>
            </div>
          </div>
          <p className={styles.note}>
            Qui il denominatore coincide con gli incarichi della serie: le due categorie riconciliano
            con il totale.
          </p>
        </section>
      </section>

      <section className="panel" aria-labelledby="external-series-title">
        <div className={styles.sectionHead}>
          <h2 id="external-series-title" className="panel-title">
            Serie annuale · incarichi esterni
          </h2>
          <span>ammontare erogato comunicato dalla fonte</span>
        </div>
        <p className={styles.tableHint}>Scorri la tabella →</p>
        <div className="table-scroll" role="region" aria-label="Serie annuale degli incarichi esterni" tabIndex={0}>
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Anno</th>
                <th scope="col" className="num">Incarichi</th>
                <th scope="col" className="num">Conclusi</th>
                <th scope="col" className="num">Quanto risulta pagato</th>
                <th scope="col" className="num">Individuali</th>
                <th scope="col" className="num">Organizzazioni</th>
              </tr>
            </thead>
            <tbody>
              {scopedSnapshot.externalAppointments.map((item) => (
                <tr key={item.year}>
                  <th scope="row">
                    {item.year}
                    {item.year === scopedSnapshot.latestYear ? <small>parziale</small> : null}
                  </th>
                  <td className="num">{integer(item.assignments)}</td>
                  <td className="num">{integer(item.completedAssignments)}</td>
                  <td className={`num ${styles.moneyCell}`}>
                    <strong>{compactEuro(euros(item.paidCents))}</strong>
                    <small>{exactEuro(euros(item.paidCents))}</small>
                  </td>
                  <td className="num">{integer(item.individualRecipients)}</td>
                  <td className="num">{integer(item.organizationRecipients)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className={styles.note}>
          L&apos;importo è quanto risulta pagato alla fonte, non il compenso lordo previsto. I
          destinatari non sono usati come denominatore degli incarichi.
        </p>
      </section>

      <section className="panel" aria-labelledby="employee-series-title">
        <div className={styles.sectionHead}>
          <h2 id="employee-series-title" className="panel-title">
            Serie annuale · incarichi ai dipendenti
          </h2>
          <span>conteggi della serie dipendenti</span>
        </div>
        <p className={styles.tableHint}>Scorri la tabella →</p>
        <div className="table-scroll" role="region" aria-label="Serie annuale degli incarichi ai dipendenti" tabIndex={0}>
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Anno</th>
                <th scope="col" className="num">Incarichi</th>
                <th scope="col" className="num">Conclusi</th>
                <th scope="col" className="num">Quanto risulta pagato</th>
                <th scope="col" className="num">Dirigenti</th>
                <th scope="col" className="num">Non dirigenti</th>
                <th scope="col" className="num">Record PA conferente</th>
              </tr>
            </thead>
            <tbody>
              {scopedSnapshot.employeeAppointments.map((item) => (
                <tr key={item.year}>
                  <th scope="row">
                    {item.year}
                    {item.year === scopedSnapshot.latestYear ? <small>parziale</small> : null}
                  </th>
                  <td className="num">{integer(item.assignments)}</td>
                  <td className="num">{integer(item.completedAssignments)}</td>
                  <td className={`num ${styles.moneyCell}`}>
                    <strong>{compactEuro(euros(item.paidCents))}</strong>
                    <small>{exactEuro(euros(item.paidCents))}</small>
                  </td>
                  <td className="num">{integer(item.managerAssignments)}</td>
                  <td className="num">{integer(item.nonManagerAssignments)}</td>
                  <td className="num">{integer(item.publicAdministrationGrantorRecords)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className={styles.note}>
          “Record PA conferente” conserva il conteggio della fonte: non equivale al numero di
          amministrazioni distinte.
        </p>
      </section>

      <section className="panel" id="metodo" aria-labelledby="method-title">
        <h2 id="method-title" className="panel-title">
          Fonte, metodo e limiti
        </h2>
        <dl className={styles.sourceGrid}>
          <div>
            <dt>Titolare</dt>
            <dd>{scopedSnapshot.source.owner}</dd>
          </div>
          <div>
            <dt>Dataset</dt>
            <dd>{scopedSnapshot.source.dataset}</dd>
          </div>
          <div>
            <dt>Osservato</dt>
            <dd>{longDate(scopedSnapshot.source.observedAt)}</dd>
          </div>
          <div>
            <dt>Cadenza dichiarata</dt>
            <dd>{scopedSnapshot.source.declaredCadence}</dd>
          </div>
          <div>
            <dt>Controllo piattaforma</dt>
            <dd>{scopedSnapshot.source.platformCheckCadence}</dd>
          </div>
          <div>
            <dt>Licenza e riuso</dt>
            <dd>{scopedSnapshot.source.reuseTerms}</dd>
          </div>
        </dl>
        <div className={styles.methodNotes}>
          <p>
            <strong>Che cosa misura “pagato”.</strong> {scopedSnapshot.methodology.amountMeaning}
          </p>
          <p>
            <strong>Copertura.</strong> Aggregato nazionale annuale, senza nomi individuali,
            curriculum o graduatorie; la serie comprende solo {yearRange} nello snapshot verificato.
            Questa serie DFP non equivale alle categorie contabili della Ragioneria generale dello
            Stato.
          </p>
          <p>
            <strong>Responsabilità.</strong> {scopedSnapshot.methodology.responsibilityWarning}
          </p>
          <p>
            <strong>Conteggio PA conferente.</strong>{" "}
            {scopedSnapshot.methodology.publicAdministrationGrantorMeaning}
          </p>
        </div>
        <div className={styles.actions}>
          <a className="btn btn-secondary" href={scopedSnapshot.source.landingUrl} target="_blank" rel="noreferrer">
            Apri il progetto Consulenti Pubblici ↗
          </a>
          <a className="btn btn-secondary" href={scopedSnapshot.source.endpoint} target="_blank" rel="noreferrer">
            Apri l&apos;endpoint ufficiale ↗
          </a>
          <a className="btn btn-secondary" href={scopedSnapshot.source.licenseUrl} target="_blank" rel="noreferrer">
            Note legali e licenza ↗
          </a>
        </div>
        <p className={styles.note}>
          {scopedSnapshot.methodology.currentYearWarning} Le due serie restano separate perché hanno
          significati e popolazioni diverse; questo quadro non è una valutazione di legittimità,
          qualità o opportunità degli incarichi.
        </p>
      </section>

      <p className={styles.backLink}>
        <Link href="/enti">← Torna a enti e società</Link>
      </p>
    </main>
  );
}
