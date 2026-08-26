import type { Metadata } from "next";
import Link from "next/link";
import { CohesionHistoryChart } from "@/components/charts/cohesion-history-chart";
import { compactEuro, exactEuro, integer, longDate, percent } from "@/lib/format";
import {
  deriveOpenCoesioneDimension,
  openCoesionePaymentCostRatio,
  openCoesioneSnapshot as snapshot,
  type OpenCoesioneDimensionMetrics,
} from "@/lib/opencoesione-snapshot";
import { pnrrChildcareMeta } from "@/lib/pnrr-childcare-snapshot";
import styles from "./coesione.module.css";

export const metadata: Metadata = {
  title: "Fondi e progetti",
  description:
    "Costo previsto, pagamenti e progetti delle politiche di coesione in Italia, per tema, natura e stato, con la serie storica OpenCoesione.",
};

/** The snapshot keeps money in cents; every figure on the page starts here. */
function euros(cents: number): number {
  return cents / 100;
}

function share(paid: number, cost: number): number {
  return cost > 0 ? (paid / cost) * 100 : 0;
}

function DimensionTable({
  items,
  label,
}: {
  items: OpenCoesioneDimensionMetrics[];
  label: "tema" | "natura";
}) {
  const heading = label === "tema" ? "Tema" : "Natura della spesa";
  return (
    <div
      className="table-scroll"
      role="region"
      aria-label={`Costo pubblico dei progetti OpenCoesione per ${label}`}
      tabIndex={0}
    >
      <table className="table">
        <thead>
          <tr>
            <th scope="col">{heading}</th>
            <th scope="col" className="num">Costo pubblico</th>
            <th scope="col" className="num">Quota totale</th>
            <th scope="col" className="num">Pagamenti</th>
            <th scope="col" className="num">Pagato/costo</th>
            <th scope="col" className="num">Media/progetto</th>
            <th scope="col" className="num">Progetti</th>
            <th scope="col">Fonte</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.slug}>
              <th scope="row">{item.label}</th>
              <td className="num">{compactEuro(euros(item.publicCostCents))}</td>
              <td className="num">{percent(item.publicCostShare * 100)}</td>
              <td className="num">{compactEuro(euros(item.paymentsCents))}</td>
              <td className="num">{percent(item.paymentCostRatio * 100)}</td>
              <td className="num">
                {item.averagePublicCostCents === null
                  ? "n.d."
                  : compactEuro(euros(item.averagePublicCostCents))}
              </td>
              <td className="num">{integer(item.projects)}</td>
              <td>
                {item.sourceUrl ? (
                  <a
                    href={item.sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={`Dettaglio OpenCoesione per ${item.label}, si apre in una nuova scheda`}
                  >
                    Dettaglio ↗
                  </a>
                ) : (
                  "n.d."
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** A signed euro delta, so "we reconciled and it matched" is visible as 0 €. */
function reconciliationLabel(cents: number): string {
  if (cents === 0) return "0 €";
  return `${cents > 0 ? "+" : "−"}${exactEuro(Math.abs(euros(cents)))}`;
}

export default function CohesionPage() {
  const ratio = openCoesionePaymentCostRatio * 100;

  const themes = snapshot.themes
    .map((item) => deriveOpenCoesioneDimension(item, snapshot.totals.publicCostCents))
    .sort((left, right) => right.publicCostCents - left.publicCostCents);
  const natures = snapshot.natures
    .map((item) => deriveOpenCoesioneDimension(item, snapshot.totals.publicCostCents))
    .sort((left, right) => right.publicCostCents - left.publicCostCents);
  const statuses = snapshot.statuses
    .map((item) => deriveOpenCoesioneDimension(item, snapshot.totals.publicCostCents))
    .sort((left, right) => right.projects - left.projects);
  const maxStatusProjects = Math.max(...statuses.map((status) => status.projects), 0);

  const themesByShare = [...themes]
    .map((theme) => ({
      ...theme,
      paidShare: share(theme.paymentsCents, theme.publicCostCents),
    }))
    .sort((left, right) => right.paidShare - left.paidShare);

  /* The full series starts in 1990; the table only shows the recent years,
     where the numbers actually move. */
  const recentYears = snapshot.annualSeries.slice(-5);

  return (
    <main className="shell page">
      <div className="page-intro">
        <h1>Fondi e progetti finanziati</h1>
        <p>
          {integer(snapshot.totals.projects)} progetti seguiti da OpenCoesione dal 1990 a oggi.
          Dati al {longDate(`${snapshot.referenceDate}T00:00:00Z`)}, controllati il{" "}
          {longDate(snapshot.source.observedAt)}.
        </p>
      </div>

      <div className="stat-strip">
        <div>
          <span className="stat-label">Impegni registrati</span>
          <span className="stat-value">{compactEuro(euros(snapshot.totals.publicCostCents))}</span>
          <span className="stat-note">
            di cui {compactEuro(euros(snapshot.totals.cohesionPublicCostCents))} da fondi di
            coesione
          </span>
        </div>
        <div>
          <span className="stat-label">Pagamenti registrati</span>
          <span className="stat-value">{compactEuro(euros(snapshot.totals.paymentsCents))}</span>
          <span className="stat-note">
            di cui {compactEuro(euros(snapshot.totals.cohesionPaymentsCents))} da fondi di coesione
          </span>
        </div>
        <div>
          <span className="stat-label">Pagato sul costo previsto</span>
          <span className="stat-value">{percent(ratio)}</span>
          <span className="stat-note">rapporto tra importi</span>
        </div>
        <div>
          <span className="stat-label">Progetti seguiti</span>
          <span className="stat-value">{integer(snapshot.totals.projects)}</span>
          <span className="stat-note">dal 1990 a oggi</span>
        </div>
      </div>

      <div className="notice">
        <strong>Come leggere questi numeri</strong>
        <p>
          La quota confronta ogni tema con il costo pubblico nazionale. “Pagato sul costo” è soldi
          usciti diviso costo previsto.
        </p>
      </div>

      <section className={styles.tracePanel}>
        <div>
          <span>Nuovo · traccia PNRR</span>
          <h2>Il totale non basta. Segui un progetto fino alla gara.</h2>
          <p>
            {integer(pnrrChildcareMeta.coverage.uniqueProjects)} CUP per asili e prima infanzia,
            con localizzazioni, finanziamenti, {integer(pnrrChildcareMeta.coverage.tenderRows)} gare
            e aggiudicatari collegati senza confondere importi e pagamenti.
          </p>
        </div>
        <div className={styles.traceAction}>
          <strong>{compactEuro(pnrrChildcareMeta.totals.pnrrFundingCents / 100)}</strong>
          <span>finanziamento PNRR registrato</span>
          <Link className="btn btn-primary" href="/coesione/asili">Apri Traccia PNRR →</Link>
        </div>
      </section>

      <div className={styles.tables}>
        <section className="panel">
          <h2 className="panel-title">Dove vanno questi soldi · per tema</h2>
          <DimensionTable items={themes} label="tema" />
        </section>

        <section className="panel">
          <h2 className="panel-title">Come vengono spesi · per natura</h2>
          <DimensionTable items={natures} label="natura" />
        </section>
      </div>

      <section className="panel">
        <h2 className="panel-title">A che punto sono i progetti</h2>
        <ul className={styles.statusList}>
          {statuses.map((status) => (
            <li key={status.slug}>
              <span>{status.label}</span>
              <i aria-hidden="true">
                <b
                  style={{
                    width:
                      maxStatusProjects > 0
                        ? `${(status.projects / maxStatusProjects) * 100}%`
                        : "0%",
                  }}
                />
              </i>
              <b>
                {integer(status.projects)} · {compactEuro(euros(status.publicCostCents))} ·{" "}
                {percent(status.paymentCostRatio * 100)} pagato/costo
              </b>
            </li>
          ))}
        </ul>
        <p className={styles.note}>
          Le barre confrontano il numero di progetti; gli importi sono il costo pubblico previsto.
        </p>
      </section>

      <div className={styles.tables}>
        <section className="panel">
          <h2 className="panel-title">La serie storica · cumulata</h2>
          <CohesionHistoryChart data={snapshot.annualSeries} />
          <div className="table-scroll" role="region" aria-label="Serie annuale OpenCoesione" tabIndex={0}>
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Anno</th>
                  <th scope="col" className="num">Impegni</th>
                  <th scope="col" className="num">Pagamenti</th>
                  <th scope="col" className="num">Pagato</th>
                </tr>
              </thead>
              <tbody>
                {recentYears.map((point) => (
                  <tr key={point.year}>
                    <th scope="row">{point.year}</th>
                    <td className="num">{compactEuro(euros(point.commitmentsCents))}</td>
                    <td className="num">{compactEuro(euros(point.paymentsCents))}</td>
                    <td className="num">
                      {percent(share(point.paymentsCents, point.commitmentsCents))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className={styles.note}>
            La serie cresce nel tempo perché è cumulata dal 1990: ogni punto somma i totali fino a
            quell&apos;anno.
          </p>
        </section>

        <section className="panel">
          <h2 className="panel-title">Quanto è già stato pagato · per tema</h2>
          <ul className={styles.shareList}>
            {themesByShare.map((theme) => (
              <li key={theme.slug}>
                <span>{theme.label}</span>
                <i aria-hidden="true">
                  <b style={{ width: `${Math.min(theme.paidShare, 100)}%` }} />
                </i>
                <b>{percent(theme.paidShare)}</b>
              </li>
            ))}
          </ul>
          <p className={styles.note}>
            I rapporti finanziari differiscono fra categorie e richiedono contesto progettuale.
          </p>
        </section>
      </div>

      <div className="notice">
        <strong>Come leggere «pagato»</strong>
        <p>
          “Pagato” significa che i soldi sono usciti. {snapshot.methodology.territorialWarning}
        </p>
      </div>

      <section className="panel">
        <h2 className="panel-title">Fonte e verifica</h2>
        <dl className={styles.sourceGrid}>
          <div>
            <dt>Fonte</dt>
            <dd>{snapshot.source.owner}</dd>
          </div>
          <div>
            <dt>Dataset</dt>
            <dd>{snapshot.source.dataset}</dd>
          </div>
          <div>
            <dt>Licenza</dt>
            <dd>{snapshot.source.license}</dd>
          </div>
          <div>
            <dt>Cadenza dichiarata</dt>
            <dd>{snapshot.source.declaredCadence}</dd>
          </div>
          <div>
            <dt>Controllo automatico</dt>
            <dd>{snapshot.source.platformCheckCadence}</dd>
          </div>
          <div>
            <dt>Ultimo controllo</dt>
            <dd>{longDate(snapshot.source.observedAt)}</dd>
          </div>
        </dl>
        <p className={styles.note}>
          Ricontiamo ogni raggruppamento contro il totale nazionale: differenza sugli stati{" "}
          {reconciliationLabel(snapshot.reconciliation.statuses.publicCostDeltaCents)}, sui temi{" "}
          {reconciliationLabel(snapshot.reconciliation.themes.publicCostDeltaCents)}, sulle nature{" "}
          {reconciliationLabel(snapshot.reconciliation.natures.publicCostDeltaCents)}. La fonte
          arrotonda all&apos;euro: accettiamo al massimo due euro di scarto e nessuna differenza nel
          numero dei progetti.
        </p>
        <div className={styles.actions}>
          <a
            className="btn btn-secondary"
            href={snapshot.source.endpoint}
            target="_blank"
            rel="noreferrer"
          >
            API OpenCoesione ↗
          </a>
          <Link className="btn btn-secondary" href="/api/coesione">
            Dati pronti per altre applicazioni
          </Link>
          <Link className="btn btn-secondary" href="/fonti">
            Registro delle fonti
          </Link>
          <Link className="btn btn-secondary" href="/metodologia">
            Metodologia
          </Link>
        </div>
      </section>
    </main>
  );
}
