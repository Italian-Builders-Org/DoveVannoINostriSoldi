import type { Metadata } from "next";
import Link from "next/link";
import { ThemeToggle } from "@/components/theme-toggle";
import { getParlamentoGiudiziario, documentedConvictions, graphPeopleWithDocumentedCases, judicialCoverageNote } from "@/lib/parlamento-giudiziario";
import { getRepubblicaGraph, getRepubblicaMap } from "@/lib/politici-repubblica";
import { PUBLIC_SITE_URL } from "@/lib/site";
import { readAtlasState, longDate } from "./atlas-model";
import { RepubblicaGraph } from "./repubblica-graph";
import styles from "./politici.module.css";

export const metadata: Metadata = {
  title: "Atlante della politica italiana",
  description: "Esplora Camera, Senato, Governo, Repubblica, Grafo Istituzionale e Condanne documentate: emicicli interattivi, persone, incarichi, gruppi e fonti ufficiali.",
};

type PoliticiPageProps = { searchParams: Promise<Record<string, string | string[] | undefined>>; };

export default async function PoliticiPage({ searchParams }: PoliticiPageProps) {
  const graph = getRepubblicaGraph();
  const map = getRepubblicaMap();
  const judicial = getParlamentoGiudiziario();
  const judicialPersonIds = graphPeopleWithDocumentedCases();
  const convictions = documentedConvictions();
  const convictionsNote = judicialCoverageNote();
  const params = await searchParams;
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    const first = Array.isArray(value) ? value[0] : value;
    if (first !== undefined) query.set(key, first);
  }
  const parsed = readAtlasState(query, map);
  return <main className={styles.immersivePage}>
    <a className={styles.skipLink} href="#atlante-politica">Vai all’atlante</a>
    <header className={styles.immersiveChrome}>
      <div className={styles.brandLockup}>
        <Link className={styles.immersiveBrand} href={PUBLIC_SITE_URL} aria-label="DoveVannoINostriSoldi, pagina iniziale">
          DVNS
        </Link>
        <h1 className={styles.srOnly}>Atlante della politica italiana</h1>
      </div>
      <div className={styles.immersiveActions}>
        <details className={styles.sourcesDisclosure}>
          <summary>Fonti e limiti</summary>
          <div className={styles.sourcesPanel}>
            <h2>Da dove arrivano i dati</h2>
            <p>Le rilevazioni non sono simultanee. La data dell’ultimo aggiornamento di una fonte non rende attuali tutte le altre.</p>
            <ul>
              {graph.sources.map((source, index) => <li key={`${source.url}#${index}`}>
                <a href={source.url} target="_blank" rel="noopener noreferrer">
                  {source.label}
                  <span className={styles.srOnly}> (nuova scheda)</span>
                </a>
                <p>{source.license} · osservata il {longDate(source.observedDate)}.</p>
                {source.gap ? <p>
                  {source.gap}
                </p> : null}
              </li>)}
              <li>
                Procedimenti giudiziari: raccolta curata su {judicial.coverage.membersExamined} parlamentari, verificata al{" "}
                {judicial.coverage.checkedAt}. Ogni caso ha un atto pubblicato dell&apos;autorità competente oppure almeno due
                editori indipendenti. {judicial.caveats[0]} {judicial.caveats[2]}
              </li>
            </ul>
            <h3>Metodo e limiti</h3>
            <ul>
              {graph.caveats.map((caveat) => <li key={caveat}>
                {caveat}
              </li>)}
            </ul>
            <p>Gli emicicli sono rappresentazioni stilizzate: i gruppi sono disposti in ordine alfabetico, non secondo i posti reali o una misura di orientamento politico. Le co-citazioni nelle notizie non dimostrano relazioni personali.</p>
            <nav aria-label="Altri approfondimenti">
              <Link href={`${PUBLIC_SITE_URL}/parlamento`}>Parlamento</Link>
              <Link href={`${PUBLIC_SITE_URL}/governi`}>Governi</Link>
            </nav>
          </div>
        </details>
        <Link className={styles.immersiveHomeLink} href={PUBLIC_SITE_URL}>Torna al sito <span aria-hidden="true">↗</span></Link>
        <ThemeToggle />
      </div>
    </header>
    <div id="atlante-politica" className={styles.atlasMount} tabIndex={-1}>
      <RepubblicaGraph
        map={map}
        initialState={parsed.state}
        invalidSelection={parsed.invalidSelection}
        initialDetailsOpen={!parsed.invalidSelection && ["person", "group", "deputy"].some((key) => query.has(key))}
        judicialPersonIds={judicialPersonIds}
        convictions={convictions}
        convictionsNote={convictionsNote} />
    </div>
    <noscript>
      <p className={styles.noScript}>Per esplorare persone e gruppi serve JavaScript. Le fonti ufficiali restano disponibili in «Fonti e limiti».</p>
    </noscript>
  </main>;
}
