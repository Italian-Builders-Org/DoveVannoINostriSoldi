import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache, Suspense } from "react";
import {
  MopCostPanel,
  optionalMopLookup,
} from "@/components/mop/mop-cost-panel";
import { OPENCUP_PRODUCT_INTEGRATION } from "@/lib/data/source-policy";
import { compactEuro, exactEuro, integer, longDate, shortDate } from "@/lib/format";
import {
  IntegratedQueryError,
  normalizeOpenCupCup,
  selectOpenCupProjects,
  type OpenCupProjectSelection,
} from "@/lib/integrated-public-view";
import { OpenCupUnavailableError } from "@/lib/opencup-projects-index";
import {
  PnrrChildcareQueryError,
  awardeesForTender,
  getPnrrChildcareProject,
  pnrrChildcareMeta,
} from "@/lib/pnrr-childcare-snapshot";
import type { PnrrChildcareProject } from "@/lib/data/pnrr-childcare-contract";
import { OpenCupProjectPanel } from "./opencup-project-panel";
import styles from "./project.module.css";


type RouteParams = Promise<{ cup: string }>;
type RouteSearchParams = Promise<{ fonte?: string | string[] }>;

type ProjectLookup = {
  cup: string | null;
  openCup: OpenCupProjectSelection | null;
  openCupUnavailable: boolean;
  pnrr: PnrrChildcareProject | null;
};

function firstSearchValue(value: string | string[] | undefined): string | null {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && typeof value[0] === "string") return value[0];
  return null;
}

function wantsMopOnlyShell(fonte: string | null): boolean {
  return fonte === "mop";
}

const loadProject = cache(async (rawCup: string): Promise<ProjectLookup> => {
  let cup: string;
  try {
    cup = normalizeOpenCupCup(rawCup);
  } catch (error) {
    if (error instanceof IntegratedQueryError) {
      return { cup: null, openCup: null, openCupUnavailable: false, pnrr: null };
    }
    throw error;
  }

  let pnrr: PnrrChildcareProject | null;
  try {
    pnrr = getPnrrChildcareProject(cup);
  } catch (error) {
    if (error instanceof PnrrChildcareQueryError) {
      return { cup: null, openCup: null, openCupUnavailable: false, pnrr: null };
    }
    throw error;
  }

  try {
    if (OPENCUP_PRODUCT_INTEGRATION !== "active") {
      return { cup, openCup: null, openCupUnavailable: false, pnrr };
    }
    const openCup = await selectOpenCupProjects({ cup, limit: 20 });
    return { cup, openCup, openCupUnavailable: false, pnrr };
  } catch (error) {
    if (error instanceof OpenCupUnavailableError) {
      return { cup, openCup: null, openCupUnavailable: true, pnrr };
    }
    throw error;
  }
});

export async function generateMetadata({
  params,
  searchParams,
}: {
  params: RouteParams;
  searchParams: RouteSearchParams;
}): Promise<Metadata> {
  const { cup: rawCup } = await params;
  const query = await searchParams;
  const mopOnly = wantsMopOnlyShell(firstSearchValue(query.fonte));
  const lookup = await loadProject(rawCup);
  if (!lookup.cup) notFound();

  if (lookup.pnrr || lookup.openCup || lookup.openCupUnavailable) {
    if (!lookup.pnrr && lookup.openCup?.matchedRows === 0 && !mopOnly) notFound();
    const title = lookup.pnrr?.title
      ?? lookup.openCup?.rows[0]?.cells.DESCRIZIONE_SINTETICA_CUP
      ?? `Progetto CUP ${lookup.cup}`;
    return {
      title: `${lookup.cup} · ${title}`,
      description: `Traccia documentale del progetto ${lookup.cup} nei rilasci pubblici consultati.`,
    };
  }

  if (!mopOnly) notFound();
  return {
    title: `${lookup.cup} · OpenBDAP MOP`,
    description: `Confronto costi previsti ed effettivi OpenBDAP MOP per il CUP ${lookup.cup}.`,
    robots: { index: false, follow: false },
  };
}

function money(value: number | null): string {
  return value === null ? "non disponibile" : exactEuro(value / 100);
}

function Evidence({ kind }: { kind: "osservato" | "collegato" | "derivato" | "mancante" }) {
  return <span className={`${styles.evidence} ${styles[kind]}`}>{kind}</span>;
}

function timelineRows(project: PnrrChildcareProject) {
  return [
    ["Inizio previsto", project.timeline.plannedStart, "osservato"],
    ["Inizio effettivo", project.timeline.actualStart, project.timeline.actualStart ? "osservato" : "mancante"],
    ["Fine prevista", project.timeline.plannedEnd, "osservato"],
    ["Fine effettiva", project.timeline.actualEnd, project.timeline.actualEnd ? "osservato" : "mancante"],
  ] as const;
}

export default async function ProjectPage({
  params,
  searchParams,
}: {
  params: RouteParams;
  searchParams: RouteSearchParams;
}) {
  const { cup: rawCup } = await params;
  const query = await searchParams;
  const mopOnly = wantsMopOnlyShell(firstSearchValue(query.fonte));
  const lookup = await loadProject(rawCup);
  if (!lookup.cup) notFound();

  const hasPrimaryTrace =
    Boolean(lookup.pnrr) ||
    Boolean(lookup.openCupUnavailable) ||
    (lookup.openCup !== null && lookup.openCup.matchedRows > 0);

  if (!hasPrimaryTrace && !mopOnly) notFound();
  if (!hasPrimaryTrace && mopOnly) {
    const mop = await optionalMopLookup(lookup.cup);
    if (!mop || mop.count === 0) notFound();
    const primary = mop.works[0];
    return (
      <main className="shell page">
        <nav className={styles.breadcrumb} aria-label="Percorso">
          <Link href="/coesione">Fondi e progetti</Link><span>/</span>
          <strong>{lookup.cup}</strong>
        </nav>

        <header className={styles.hero}>
          <div>
            <div className={styles.heroMeta}>
              <span>CUP {lookup.cup}</span>
              <Evidence kind="collegato" />
              <span>{primary.status}</span>
            </div>
            <h1>{primary.description || `Opera MOP ${lookup.cup}`}</h1>
            <p>
              Scheda di anteprima OpenBDAP MOP: il CUP non è nello snapshot PNRR
              asili e OpenCUP prodotto non è attivo. Solo costi MOP previsto /
              effettivo.
            </p>
          </div>
        </header>

        <div className={`notice ${styles.mopOnlyNotice}`}>
          <strong>Anteprima locale · ?fonte=mop</strong>
          <p>
            Non è una scheda PNRR/OpenCUP. Serve a verificare il confronto costi
            sulla fonte MOP senza inventare finanziamenti o gare.
          </p>
        </div>

        <section className={`panel ${styles.mopPanel}`}>
          <div className={styles.sectionHeading}>
            <h2>Monitoraggio Opere Pubbliche · previsto e effettivo</h2>
          </div>
          <MopCostPanel cup={lookup.cup} initial={mop} />
        </section>
      </main>
    );
  }

  const cup = lookup.cup;
  const project = lookup.pnrr;
  const tenderTotal = project?.tenders.reduce((sum, tender) => sum + (tender.amountCents ?? 0), 0) ?? 0;
  const awardTotal = project?.tenders.reduce((sum, tender) => sum + (tender.awardAmountCents ?? 0), 0) ?? 0;
  const linkedAwardees = new Set(project?.tenders.flatMap((tender) => awardeesForTender(project, tender)) ?? []);
  const unmatchedAwardees = project?.awardees.filter((awardee) => !linkedAwardees.has(awardee)) ?? [];
  const primaryPlace = project?.locations[0];
  const openCupPrimary = lookup.openCup?.rows[0];
  const title = project?.title ?? openCupPrimary?.cells.DESCRIZIONE_SINTETICA_CUP ?? `Progetto CUP ${cup}`;
  const place = [primaryPlace?.municipality, primaryPlace?.province, primaryPlace?.region];

  return (
    <main className="shell page">
      <nav className={styles.breadcrumb} aria-label="Percorso">
        <Link href="/coesione">Fondi e progetti</Link><span>/</span>
        {project ? <><Link href="/coesione/asili">PNRR asili</Link><span>/</span></> : null}<strong>{cup}</strong>
      </nav>

      <header className={styles.hero}>
        <div>
          <div className={styles.heroMeta}>
            <span>CUP {cup}</span>
            {!project && openCupPrimary?.evidenceLabel === "synthetic-fixture"
              ? <span>Fixture sintetica</span>
              : <Evidence kind="osservato" />}
            <span>{project?.status.validationOutcome ?? openCupPrimary?.cells.STATO_PROGETTO ?? "Stato non disponibile"}</span>
          </div>
          <h1>{title}</h1>
          <p>{project
            ? place.filter(Boolean).join(" · ") || "Localizzazione non disponibile"
            : "Il rilascio Progetti OpenCUP non include la localizzazione."}</p>
        </div>
      </header>

      <div className={styles.legend} aria-label="Legenda delle evidenze">
        <strong>Come leggiamo questa traccia</strong>
        <span><Evidence kind="osservato" /> presente nella fonte</span>
        <span><Evidence kind="collegato" /> unito con chiave esatta</span>
        <span><Evidence kind="derivato" /> calcolato dai valori fonte</span>
        <span><Evidence kind="mancante" /> non pubblicato o non collegabile</span>
      </div>

      {OPENCUP_PRODUCT_INTEGRATION === "active" ? (lookup.openCup ? <OpenCupProjectPanel initial={lookup.openCup} /> : (
        <section className={styles.openCupUnavailable} aria-labelledby="opencup-title">
          <div className={styles.sectionHeading}><h2 id="opencup-title">Registrazioni OpenCUP</h2></div>
          <div className="notice">
            <strong>OpenCUP temporaneamente non disponibile</strong>
            <p>{project ? "Le altre evidenze della scheda restano disponibili." : "Riprova più tardi: l’indisponibilità della fonte non dimostra che il CUP sia assente."}</p>
          </div>
        </section>
      )) : null}

      {project ? <>
      <section className={styles.flow} aria-labelledby="flow-title">
        <div className={styles.sectionHeading}><h2 id="flow-title">Finanziamenti, gare e pagamenti</h2></div>
        <div className={styles.flowGrid}>
          <div><span>Finanziamento PNRR registrato</span><strong>{money(project.funding.pnrrCents)}</strong><Evidence kind="osservato" /></div>
          <div><span>Importi di gara</span><strong>{exactEuro(tenderTotal / 100)}</strong><Evidence kind="derivato" /></div>
          <div><span>Importi di aggiudicazione</span><strong>{exactEuro(awardTotal / 100)}</strong><Evidence kind="derivato" /></div>
          <div><span>Pagamenti ReGiS</span><strong>non disponibili</strong><Evidence kind="mancante" /></div>
        </div>
        <p className={styles.caveat}>{pnrrChildcareMeta.methodology.fundingWarning}</p>
      </section>

      <div className={styles.twoColumns}>
        <section className="panel">
          <div className={styles.sectionHeading}><h2>Soggetto attuatore</h2></div>
          <dl className={styles.definitionGrid}>
            <div><dt>Amministrazione</dt><dd>{project.implementer.name ?? "non disponibile"}</dd></div>
            <div><dt>Codice fiscale</dt><dd>{project.implementer.taxCode ?? "non disponibile"}</dd></div>
            <div><dt>Codice locale progetto</dt><dd>{project.localProjectCode ?? "non disponibile"}</dd></div>
            <div><dt>Progetto in essere</dt><dd>{project.existingProject ?? "non disponibile"}</dd></div>
          </dl>
          <h3 className={styles.subheading}>{project.locations.length === 1 ? "Localizzazione" : `${integer(project.locations.length)} localizzazioni`}</h3>
          <ul className={styles.locationList}>
            {project.locations.map((location, index) => (
              <li key={`${location.municipalityCode}-${location.address}-${index}`}>
                <strong>{location.municipality ?? "Comune non disponibile"}</strong>
                <span>{[location.province, location.region].filter(Boolean).join(" · ")}</span>
                <small>{[location.address, location.postalCode].filter(Boolean).join(" · ") || "Indirizzo non disponibile"}</small>
              </li>
            ))}
          </ul>
        </section>

        <section className="panel">
          <div className={styles.sectionHeading}><h2>Tempi e validazione</h2></div>
          <dl className={styles.timeline}>
            {timelineRows(project).map(([label, value, evidence]) => (
              <div key={label}><dt>{label}</dt><dd>{shortDate(value)}</dd><Evidence kind={evidence} /></div>
            ))}
          </dl>
          <dl className={styles.definitionGrid}>
            <div><dt>Stato CUP</dt><dd>{project.status.cup ?? "non disponibile"}</dd></div>
            <div><dt>Avanzamento progetto</dt><dd>{project.status.progress ?? "non disponibile"}</dd></div>
            <div><dt>Fase iter</dt><dd>{project.status.phase ?? "non disponibile"}</dd></div>
            <div><dt>Stato fase</dt><dd>{project.status.phaseStatus ?? "non disponibile"}</dd></div>
            <div><dt>Ultima validazione</dt><dd>{longDate(project.status.validatedAt)}</dd></div>
            <div><dt>Esito fonte</dt><dd>{project.status.validationOutcome ?? "non disponibile"}</dd></div>
          </dl>
        </section>
      </div>

      <section className={styles.procurement} aria-labelledby="procurement-title">
        <div className={styles.sectionHeading}><h2 id="procurement-title">{integer(project.tenders.length)} gare, {integer(project.awardees.length)} aggiudicatari</h2></div>
        {project.tenders.length === 0 ? <div className="notice"><strong>Nessuna gara collegata nello snapshot</strong><p>Il CSV Italia Domani non collega una procedura a questo CUP nello snapshot attuale.</p></div> : null}
        <div className={styles.tenderList}>
          {project.tenders.map((tender, index) => {
            const awardees = awardeesForTender(project, tender);
            return (
              <details key={`${tender.cig}-${tender.internalProcedureCode}-${index}`}>
                <summary>
                  <span>{tender.cig ? `CIG ${tender.cig}` : "Procedura senza CIG"}</span>
                  <strong>{tender.subject ?? tender.procedure ?? "Oggetto non disponibile"}</strong>
                  <small>{tender.awardAmountCents !== null ? `${compactEuro(tender.awardAmountCents / 100)} aggiudicati` : tender.amountCents !== null ? `${compactEuro(tender.amountCents / 100)} a base gara` : "Importo non disponibile"}</small>
                </summary>
                <div className={styles.tenderBody}>
                  <dl className={styles.definitionGrid}>
                    <div><dt>Procedura</dt><dd>{tender.procedure ?? "non disponibile"}</dd></div>
                    <div><dt>Pubblicazione CIG</dt><dd>{shortDate(tender.publishedAt)}</dd></div>
                    <div><dt>Importo gara</dt><dd>{money(tender.amountCents)}</dd></div>
                    <div><dt>Importo aggiudicazione</dt><dd>{money(tender.awardAmountCents)}</dd></div>
                    <div><dt>Aggiudicazione definitiva</dt><dd>{shortDate(tender.awardedAt)}</dd></div>
                    <div><dt>Chiave collegamento</dt><dd>{[tender.cig, tender.internalProcedureCode, tender.userProcedureCode].filter(Boolean).join(" · ") || "incompleta"}</dd></div>
                  </dl>
                  <h3>Aggiudicatari collegati <Evidence kind={awardees.length ? "collegato" : "mancante"} /></h3>
                  {awardees.length ? <ul className={styles.awardeeList}>{awardees.map((awardee, awardeeIndex) => <li key={`${awardee.taxId}-${awardeeIndex}`}><strong>{awardee.name ?? "Denominazione non disponibile"}</strong><span>{[awardee.taxId, awardee.role, awardee.legalForm].filter(Boolean).join(" · ")}</span></li>)}</ul> : <p>Nessuna riga aggiudicatario con la stessa chiave CUP + CIG + procedura.</p>}
                </div>
              </details>
            );
          })}
        </div>
        {unmatchedAwardees.length ? <div className={styles.unmatched}><strong>{integer(unmatchedAwardees.length)} righe non collegate a una gara completa</strong><Evidence kind="mancante" /><p>Restano nel progetto ma non vengono attribuite a una procedura per approssimazione.</p></div> : null}
      </section>

      <div className={styles.twoColumns}>
        <section className={`panel ${styles.mopPanel}`}>
          <div className={styles.sectionHeading}>
            <h2>Monitoraggio Opere Pubbliche · previsto e effettivo</h2>
          </div>
          <Suspense fallback={<p>Controllo CUP in corso su OpenBDAP…</p>}>
            <MopCostPanel cup={project.cup} />
          </Suspense>
        </section>
        <section className="panel">
          <div className={styles.sectionHeading}><h2>Fonte e limiti</h2></div>
          <dl className={styles.definitionGrid}>
            <div><dt>Fonte primaria</dt><dd>{pnrrChildcareMeta.source.owner}</dd></div>
            <div><dt>Data di estrazione</dt><dd>{longDate(`${pnrrChildcareMeta.referenceDate}T00:00:00Z`)}</dd></div>
            <div><dt>Licenza</dt><dd>{pnrrChildcareMeta.source.license}</dd></div>
            <div><dt>Chiavi</dt><dd>CUP · CIG · PDA · procedura utente</dd></div>
          </dl>
          <p className={styles.caveat}>{pnrrChildcareMeta.methodology.territorialWarning}</p>
          <p className={styles.caveat}>
            Finanziamento PNRR e importi di gara/aggiudicazione non sono il «costo
            effettivo» MOP: restano in sezioni separate.
          </p>
          <div className={styles.actions}>
            <a className="btn btn-secondary" href={pnrrChildcareMeta.source.landingUrl} target="_blank" rel="noreferrer">Catalogo Italia Domani ↗</a>
            <a className="btn btn-secondary" href={`/api/pnrr/asili?cup=${project.cup}`}>JSON della scheda</a>
            <Link className="btn btn-secondary" href="/metodologia">Metodologia</Link>
          </div>
        </section>
      </div>
      </> : (
        <section className={`panel ${styles.mopPanel}`}>
          <div className={styles.sectionHeading}>
            <h2>Monitoraggio Opere Pubbliche · previsto e effettivo</h2>
          </div>
          <p>
            Il collegamento usa soltanto il CUP esatto. Se MOP risponde, mostriamo
            i costi previsti ed effettivi della stessa famiglia di denaro.
          </p>
          <Suspense fallback={<p>Controllo CUP in corso su OpenBDAP…</p>}>
            <MopCostPanel cup={cup} />
          </Suspense>
          <div className={styles.actions}>
            <Link className="btn btn-secondary" href="/metodologia">Metodologia</Link>
          </div>
        </section>
      )}
    </main>
  );
}
