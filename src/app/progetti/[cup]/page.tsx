import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { getPublicWorksByCup } from "@/lib/bdap-public-works";
import { compactEuro, exactEuro, integer, longDate, shortDate } from "@/lib/format";
import {
  PnrrChildcareQueryError,
  awardeesForTender,
  getPnrrChildcareProject,
  pnrrChildcareMeta,
} from "@/lib/pnrr-childcare-snapshot";
import type { PnrrChildcareProject } from "@/lib/data/pnrr-childcare-contract";
import styles from "./project.module.css";

type RouteParams = Promise<{ cup: string }>;
type MopLookup = Awaited<ReturnType<typeof getPublicWorksByCup>>;

function projectFrom(rawCup: string): PnrrChildcareProject {
  try {
    return getPnrrChildcareProject(rawCup) ?? notFound();
  } catch (error) {
    if (error instanceof PnrrChildcareQueryError) notFound();
    throw error;
  }
}

export async function generateMetadata({ params }: { params: RouteParams }): Promise<Metadata> {
  const { cup } = await params;
  const project = projectFrom(cup);
  return {
    title: `${project.cup} · ${project.title}`,
    description: `Traccia documentale del progetto PNRR ${project.cup}: finanziamento, localizzazione, gare e aggiudicatari.`,
  };
}

async function optionalMop(cup: string): Promise<MopLookup | null> {
  return getPublicWorksByCup(cup, {
    signal: AbortSignal.timeout(3_500),
  }).catch(() => null);
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

async function MopEvidence({ cup }: { cup: string }) {
  const mop = await optionalMop(cup);
  if (!mop) {
    return <p><Evidence kind="mancante" /> Il controllo live non ha risposto entro 3,5 secondi. La scheda Italia Domani resta disponibile e verificabile.</p>;
  }
  return (
    <>
      <p><strong>{integer(mop.count)} opere trovate per lo stesso CUP.</strong> Il collegamento è esatto, ma la classificazione MOP può avere un perimetro diverso.</p>
      <ul className={styles.mopList}>{mop.works.map((work) => <li key={work.localCode}><strong>{work.status}</strong><span>{work.description}</span><small>{work.holder.name}</small></li>)}</ul>
    </>
  );
}

export default async function ProjectPage({ params }: { params: RouteParams }) {
  const { cup } = await params;
  const project = projectFrom(cup);
  const tenderTotal = project.tenders.reduce((sum, tender) => sum + (tender.amountCents ?? 0), 0);
  const awardTotal = project.tenders.reduce((sum, tender) => sum + (tender.awardAmountCents ?? 0), 0);
  const linkedAwardees = new Set(project.tenders.flatMap((tender) => awardeesForTender(project, tender)));
  const unmatchedAwardees = project.awardees.filter((awardee) => !linkedAwardees.has(awardee));
  const primaryPlace = project.locations[0];

  return (
    <main className="shell page">
      <nav className={styles.breadcrumb} aria-label="Percorso">
        <Link href="/coesione">Fondi e progetti</Link><span>/</span>
        <Link href="/coesione/asili">PNRR asili</Link><span>/</span><strong>{project.cup}</strong>
      </nav>

      <header className={styles.hero}>
        <div>
          <div className={styles.heroMeta}>
            <span>CUP {project.cup}</span>
            <Evidence kind="osservato" />
            <span>{project.status.validationOutcome ?? "Esito non disponibile"}</span>
          </div>
          <h1>{project.title}</h1>
          <p>{[primaryPlace?.municipality, primaryPlace?.province, primaryPlace?.region].filter(Boolean).join(" · ")}</p>
        </div>
      </header>

      <div className={styles.legend} aria-label="Legenda delle evidenze">
        <strong>Come leggiamo questa traccia</strong>
        <span><Evidence kind="osservato" /> presente nella fonte</span>
        <span><Evidence kind="collegato" /> unito con chiave esatta</span>
        <span><Evidence kind="derivato" /> calcolato dai valori fonte</span>
        <span><Evidence kind="mancante" /> non pubblicato o non collegabile</span>
      </div>

      <section className={styles.flow} aria-labelledby="flow-title">
        <div className={styles.sectionHeading}><h2 id="flow-title">Quattro livelli, senza scorciatoie</h2></div>
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
        <section className="panel">
          <div className={styles.sectionHeading}><h2>OpenBDAP MOP</h2></div>
          <Suspense fallback={<p>Controllo CUP in corso su OpenBDAP…</p>}>
            <MopEvidence cup={project.cup} />
          </Suspense>
          <a className="btn btn-secondary" href={`/api/opere?cup=${project.cup}`}>Apri il dato OpenBDAP</a>
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
          <div className={styles.actions}>
            <a className="btn btn-secondary" href={pnrrChildcareMeta.source.landingUrl} target="_blank" rel="noreferrer">Catalogo Italia Domani ↗</a>
            <a className="btn btn-secondary" href={`/api/pnrr/asili?cup=${project.cup}`}>JSON della scheda</a>
            <Link className="btn btn-secondary" href="/metodologia">Metodologia</Link>
          </div>
        </section>
      </div>
    </main>
  );
}
