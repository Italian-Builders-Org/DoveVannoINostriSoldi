import { MopCostComparisonChart } from "@/components/charts/mop-cost-comparison-chart";
import { getPublicWorksByCup, type PublicWorksLookup } from "@/lib/bdap-public-works";
import type { PublicWork } from "@/lib/data/bdap-public-works-contract";
import { exactEuro, integer, longDate, percent } from "@/lib/format";
import styles from "./mop-cost-panel.module.css";

/** Live MOP lookup budget: discovery + filtered rows against OpenBDAP. */
export const MOP_LOOKUP_TIMEOUT_MS = 8_000;

export type MopLookup = PublicWorksLookup;

export async function optionalMopLookup(cup: string): Promise<MopLookup | null> {
  return getPublicWorksByCup(cup, {
    signal: AbortSignal.timeout(MOP_LOOKUP_TIMEOUT_MS),
  }).catch(() => null);
}

function centsToEuro(cents: number): number {
  return cents / 100;
}

function mopCostPoints(work: PublicWork) {
  return [
    {
      label: "Totale MOP",
      plannedEuro: centsToEuro(work.costs.plannedTotalCents),
      actualEuro: centsToEuro(work.costs.actualTotalCents),
    },
    {
      label: "Lavori",
      plannedEuro: centsToEuro(work.costs.plannedWorksCents),
      actualEuro: centsToEuro(work.costs.actualWorksCents),
    },
    {
      label: "Somme a disposizione",
      plannedEuro: centsToEuro(work.costs.plannedAvailableSumsCents),
      actualEuro: centsToEuro(work.costs.actualAvailableSumsCents),
    },
    {
      label: "Oneri di investimento",
      plannedEuro: centsToEuro(work.costs.plannedInvestmentChargesCents),
      actualEuro: centsToEuro(work.costs.actualInvestmentChargesCents),
    },
  ] as const;
}

function mopDeltaLabel(changeBasisPoints: number | null): string {
  if (changeBasisPoints === null) {
    return "Confronto non disponibile (manca previsto o effettivo totale)";
  }
  const share = changeBasisPoints / 100;
  if (share === 0) return "Effettivo uguale al previsto";
  if (share > 0) return `Effettivo superiore del ${percent(share)}`;
  return `Effettivo inferiore del ${percent(Math.abs(share))}`;
}

function Evidence({ kind }: { kind: "osservato" | "collegato" | "derivato" | "mancante" }) {
  return <span className={`${styles.evidence} ${styles[kind]}`}>{kind}</span>;
}

function MopWorkCostCard({ work }: { work: PublicWork }) {
  const points = mopCostPoints(work);
  const comparable =
    work.costs.plannedTotalCents > 0 && work.costs.actualTotalCents > 0;

  return (
    <article className={styles.work}>
      <header className={styles.workHead}>
        <strong>{work.status}</strong>
        <span>{work.description}</span>
        <small>{work.holder.name}</small>
      </header>

      <dl className={styles.costFacts}>
        <div>
          <dt>Costo previsto (totale MOP)</dt>
          <dd>{exactEuro(centsToEuro(work.costs.plannedTotalCents))}</dd>
        </div>
        <div>
          <dt>Costo effettivo (totale MOP)</dt>
          <dd>{exactEuro(centsToEuro(work.costs.actualTotalCents))}</dd>
        </div>
        <div>
          <dt>Differenza</dt>
          <dd>
            {comparable && work.costs.changeBasisPoints !== null
              ? `${work.costs.changeBasisPoints >= 0 ? "+" : ""}${exactEuro(
                  centsToEuro(work.costs.actualTotalCents - work.costs.plannedTotalCents),
                )}`
              : "non confrontabile"}
            <small>{mopDeltaLabel(work.costs.changeBasisPoints)}</small>
          </dd>
        </div>
      </dl>

      <MopCostComparisonChart
        points={[...points]}
        ariaLabel={`Confronto costi MOP previsti e effettivi per ${work.localCode}`}
      />
      <p className={styles.note}>
        Totale MOP = lavori + somme a disposizione + oneri di investimento. Zero e
        valore mancante non sono la stessa cosa: se manca un totale, non calcoliamo
        il delta.
      </p>
    </article>
  );
}

/** Renders live OpenBDAP MOP planned vs actual costs for an exact CUP. */
export async function MopCostPanel({
  cup,
  initial,
}: {
  cup: string;
  initial?: MopLookup | null;
}) {
  const mop = initial === undefined ? await optionalMopLookup(cup) : initial;
  if (!mop) {
    return (
      <div className={styles.missing}>
        <p>
          <Evidence kind="mancante" /> Il controllo live OpenBDAP non ha risposto entro{" "}
          {(MOP_LOOKUP_TIMEOUT_MS / 1000).toLocaleString("it-IT", {
            maximumFractionDigits: 1,
          })}{" "}
          secondi. Riprova dall’API o dalla landing ufficiale.
        </p>
        <div className={styles.actions}>
          <a className="btn btn-secondary" href={`/api/opere?cup=${cup}`}>
            Riprova via API
          </a>
          <a
            className="btn btn-secondary"
            href="https://bdap-opendata.rgs.mef.gov.it/content/progetti-opere-pubbliche-mop-totale"
            target="_blank"
            rel="noreferrer"
          >
            Landing OpenBDAP MOP ↗
          </a>
        </div>
      </div>
    );
  }

  if (mop.count === 0) {
    return (
      <div className={styles.missing}>
        <p>
          <Evidence kind="mancante" /> Nessuna opera MOP con questo CUP esatto nella
          risposta live. Non inventiamo costi previsti o effettivi.
        </p>
        <p className={styles.provenance}>
          Fonte: {mop.source.owner} · {mop.source.dataset} · aggiornamento dichiarato{" "}
          {mop.source.sourceLastUpdate} · licenza {mop.source.license}
        </p>
        <div className={styles.actions}>
          <a className="btn btn-secondary" href={mop.source.landingUrl} target="_blank" rel="noreferrer">
            Landing ufficiale ↗
          </a>
          <a className="btn btn-secondary" href={`/api/opere?cup=${cup}`}>
            JSON live
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.panel}>
      <p>
        <Evidence kind="collegato" />{" "}
        <strong>{integer(mop.count)} opere per lo stesso CUP.</strong> Il
        collegamento è esatto. I costi sotto vengono solo dal Monitoraggio Opere
        Pubbliche (OpenBDAP): non sono finanziamento PNRR né importi di
        gara/aggiudicazione ANAC.
      </p>

      <div className={styles.works}>
        {mop.works.map((work) => (
          <MopWorkCostCard key={work.localCode} work={work} />
        ))}
      </div>

      <dl className={styles.provenanceGrid}>
        <div>
          <dt>Fonte</dt>
          <dd>{mop.source.owner}</dd>
        </div>
        <div>
          <dt>Dataset</dt>
          <dd>{mop.source.dataset}</dd>
        </div>
        <div>
          <dt>Aggiornamento dichiarato</dt>
          <dd>{mop.source.sourceLastUpdate}</dd>
        </div>
        <div>
          <dt>Riferimento</dt>
          <dd>{longDate(`${mop.source.referenceDate}T00:00:00Z`)}</dd>
        </div>
        <div>
          <dt>Licenza</dt>
          <dd>{mop.source.license}</dd>
        </div>
        <div>
          <dt>Consultato</dt>
          <dd>{longDate(mop.observedAt)}</dd>
        </div>
      </dl>

      <div className={styles.actions}>
        <a className="btn btn-secondary" href={mop.source.landingUrl} target="_blank" rel="noreferrer">
          Landing ufficiale ↗
        </a>
        <a className="btn btn-secondary" href={`/api/opere?cup=${cup}`}>
          JSON live
        </a>
      </div>
    </div>
  );
}
