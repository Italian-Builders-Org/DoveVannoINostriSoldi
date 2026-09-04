import {
  GOVERNMENT_SCORECARD_V6_METHOD_STEPS,
  presentGovernmentScorecardV6View,
  type GovernmentScorecardV6PageView,
} from "@/lib/government-scorecard-page";
import {
  GOVERNMENT_SCORECARD_DOWNLOADS,
  GOVERNMENT_SCORECARD_DOWNLOAD_MANIFEST_FILENAME,
  GOVERNMENT_SCORECARD_DOWNLOAD_MANIFEST_HREF,
} from "@/lib/government-scorecard-download-links";

import { ContextCarousel } from "./context-carousel";
import { IndicatorCarousel } from "./indicator-carousel";
import { ArchiveComparison } from "./government-archive-and-comparison";
import styles from "../government-scorecard.module.css";

type PageSection = GovernmentScorecardV6PageView["section_order"][number];

function assertNever(value: never): never {
  throw new Error(`vista pagella v6 non gestita: ${JSON.stringify(value)}`);
}

function auditNumber(raw: number, display: number) {
  return <data value={raw}>{display}</data>;
}

function displayYear(year: number | null) {
  return year ?? "non disponibile";
}

function ScoreSummary({
  view,
  presentation,
}: {
  view: GovernmentScorecardV6PageView;
  presentation: ReturnType<typeof presentGovernmentScorecardV6View>;
}) {
  switch (view.score_state) {
    case "scored_final":
    case "scored_provisional":
      return (
        <>
          <p className={styles.metric}>{view.score.description}</p>
          <div className={styles.scoreLine}>
            <strong>{auditNumber(view.score.raw, view.score.display)}<small>/100</small></strong>
            <div>
              <b>{presentation.label}</b>
              <span>{view.score_state === "scored_final" ? "Voto indicativo · Storico" : presentation.status}</span>
              <span>Stabilità: {presentation.stability}</span>
            </div>
          </div>
        </>
      );
    case "not_scored_short":
    case "not_scored_data":
      return (
        <div className={styles.notScored}>
          <strong>{presentation.headline}</strong>
          <p>
            {view.score_state === "not_scored_short"
              ? "Mandato troppo breve per i dati annuali disponibili."
              : "Dati AMECO obbligatori incompleti per l'inizio del periodo annuale."}
          </p>
          <span>Stabilità: non disponibile · Nessun voto prodotto</span>
        </div>
      );
    default:
      return assertNever(view);
  }
}

function HeroPillars({ view }: { view: GovernmentScorecardV6PageView }) {
  switch (view.score_state) {
    case "scored_final":
    case "scored_provisional":
      return (
        <ul className={styles.heroPillars} aria-label="Sintesi dei cinque pilastri">
          {view.pillars.map((pillar) => (
            <li key={pillar.id}>
              <span>{pillar.label}</span>
              <strong>{auditNumber(pillar.score.raw, pillar.score.display)}</strong>
            </li>
          ))}
        </ul>
      );
    case "not_scored_short":
    case "not_scored_data":
      return (
        <ul className={styles.heroPillars} aria-label="Cinque pilastri senza voto">
          {view.pillars.map((pillar) => (
            <li key={pillar.id}>
              <span>{pillar.label}</span>
              <strong>n.d.</strong>
            </li>
          ))}
        </ul>
      );
    default:
      return assertNever(view);
  }
}

function PillarsDetails({ view }: { view: GovernmentScorecardV6PageView }) {
  if (view.score_state === "not_scored_short" || view.score_state === "not_scored_data") {
    return (
      <div className={styles.pillars}>
        {view.pillars.map((pillar) => (
          <article className={styles.pillar} key={pillar.id}>
            <h3>{pillar.label}</h3>
            <p>{pillar.unavailable_reason}</p>
          </article>
        ))}
      </div>
    );
  }
  return (
    <div className={styles.pillars}>
      {view.pillars.map((pillar) => (
        <article className={styles.pillar} key={pillar.id}>
          <header>
            <h3>{pillar.label}</h3>
            <strong>{auditNumber(pillar.score.raw, pillar.score.display)}/100</strong>
            <span>Contributo: {auditNumber(pillar.contribution_to_total.raw, pillar.contribution_to_total.display)}</span>
          </header>
          {pillar.members.map((member) => (
            <div className={styles.indicator} key={member.id}>
              <h4>{member.label}</h4>
              <p>{member.definition}</p>
              <dl>
                <div><dt>Unità</dt><dd>{member.unit}</dd></div>
                <div><dt>Italia all&apos;inizio ({member.italy.inputs.baseline.year})</dt><dd>{auditNumber(member.italy.inputs.baseline.value, member.italy.display.baseline)}</dd></div>
                <div><dt>Italia alla fine ({member.italy.inputs.final.year})</dt><dd>{auditNumber(member.italy.inputs.final.value, member.italy.display.final)}</dd></div>
                <div><dt>Variazione Italia</dt><dd>{auditNumber(member.italy.raw_change, member.italy.display.raw_change)}</dd></div>
                <div><dt>Mediana di Francia, Germania e Spagna</dt><dd>{auditNumber(member.peer_median_oriented_change, member.display.peer_median)}</dd></div>
                <div><dt>Contributo</dt><dd>{auditNumber(member.contribution_to_total.raw, member.contribution_to_total.display)}</dd></div>
              </dl>
            </div>
          ))}
        </article>
      ))}
    </div>
  );
}

function MethodExplainer({ view }: { view: GovernmentScorecardV6PageView }) {
  return (
    <section className={styles.methodExplainer} aria-labelledby="come-viene-calcolato">
      <div>
        <span className={styles.sectionEyebrow}>Cinque passaggi</span>
        <h3 id="come-viene-calcolato">Come viene calcolato</h3>
      </div>
      <ol>
        {GOVERNMENT_SCORECARD_V6_METHOD_STEPS.map((step, index) => (
          <li key={step}>
            <span aria-hidden="true">{index + 1}</span>
            <p>{step}</p>
          </li>
        ))}
      </ol>
      <p className={styles.methodExample}>
        Esempio: se l&apos;Italia si muove come Francia, Germania e Spagna nello stesso periodo,
        il risultato di quell&apos;indicatore resta vicino a 50.
      </p>
      <details className={styles.technicalDetails}>
        <summary>Dettagli tecnici</summary>
        <p>
          I sei indicatori che entrano nel voto usano la stessa regola per ogni governo. Per ciascuno calcoliamo
          il cambiamento dell&apos;Italia e il cambiamento mediano di Francia, Germania e Spagna negli stessi anni.
        </p>
        <p>
          Nella formula, <code>gap</code> è la differenza tra quei due cambiamenti; <code>scala</code> è una misura
          storica comune che rende confrontabili indicatori con unità diverse; <code>tanh</code> evita che valori
          estremi portino il risultato fuori dall&apos;intervallo da 0 a 100.
        </p>
        <p className={styles.formulaBlock}>
          <span>Formula</span>
          <code>{view.methodology.score_formula.expression}</code>
        </p>
        <p>
          Se la differenza è zero, anche <code>tanh</code> vale zero: il risultato è 50. I risultati dei sei indicatori
          formano cinque aree, poi le cinque aree vengono unite con lo stesso peso.
        </p>
      </details>
    </section>
  );
}

function ChartsSection({ view }: { view: GovernmentScorecardV6PageView }) {
  return (
    <section className={styles.section} id="grafici" aria-labelledby="grafici-title">
      <div className={styles.sectionHeading}>
        <div>
          <h2 id="grafici-title">Grafici nel tempo</h2>
        </div>
        <p>Italia a confronto con Francia, Germania e Spagna.</p>
      </div>
      <IndicatorCarousel charts={view.charts} />
      <details className={styles.progressiveDetails}>
        <summary>Come sono scelti i dati del voto</summary>
        <div className={styles.detailBody}>
          <p
            className={styles.timelineNote}
            title="Le date del mandato sono quelle effettive. Il voto usa osservazioni annuali associate con la stessa regola a tutti i governi e non misura variazioni giorno per giorno."
          >
            Finestra annuale: {displayYear(view.statistical_window.baseline_year)} → {displayYear(view.statistical_window.end_year)}
          </p>
          <p>
            Il voto usa soltanto sei serie annuali AMECO osservate e complete per i quattro paesi fino al {view.statistical_window.observed_through}.
            I grafici mensili, trimestrali e gli altri dati di contesto servono a leggere il periodo, ma non cambiano il voto.
          </p>
        </div>
      </details>
    </section>
  );
}

function MethodSection({ view }: { view: GovernmentScorecardV6PageView }) {
  return (
    <section className={styles.section} id="metodo">
      <MethodExplainer view={view} />
      <details className={styles.progressiveDetails}>
        <summary>Apri il dettaglio delle cinque aree</summary>
        <div className={styles.detailBody}><PillarsDetails view={view} /></div>
      </details>
    </section>
  );
}

function DownloadsPanel() {
  const dataDownloads = GOVERNMENT_SCORECARD_DOWNLOADS.filter((download) => download.category === "data");
  const verificationDownloads = GOVERNMENT_SCORECARD_DOWNLOADS.filter(
    (download) => download.category !== "data",
  );

  return (
    <section className={styles.downloadPanel} id="dati-e-fonti" aria-labelledby="download-title">
      <h3 id="download-title">Scarica i dati</h3>
      <p>Scegli i dati del voto oppure quelli usati nei grafici e nel contesto.</p>
      <ul className={styles.downloadList}>
        {dataDownloads.map((download) => (
          <li key={download.id}>
            <a
              className={styles.downloadLink}
              href={download.href}
              download={download.filename}
            >
              {download.label}
            </a>
            <span>{download.description}</span>
          </li>
        ))}
      </ul>
      <details className={styles.downloadTechnical}>
        <summary>File tecnici per verificare i dati</summary>
        <ul className={styles.downloadList}>
          {verificationDownloads.map((download) => (
            <li key={download.id}>
              <a
                className={styles.downloadLink}
                href={download.href}
                download={download.filename}
              >
                {download.label}
              </a>
              <span>{download.description}</span>
            </li>
          ))}
        </ul>
        <p className={styles.downloadManifest}>
          Per controllare dimensioni e SHA-256 usa l&apos;
          <a
            href={GOVERNMENT_SCORECARD_DOWNLOAD_MANIFEST_HREF}
            download={GOVERNMENT_SCORECARD_DOWNLOAD_MANIFEST_FILENAME}
          >
            Indice tecnico dei download
          </a>.
        </p>
      </details>
    </section>
  );
}

function SourcesDetails({ view }: { view: GovernmentScorecardV6PageView }) {
  return (
    <div className={styles.detailBody}>
      <h3>Dati e fonti</h3>
      <p>
        Il voto usa la pubblicazione {view.source.dataset_code} della {view.source.source_owner};
        i grafici di contesto indicano accanto a ogni serie la propria fonte e data di aggiornamento.
      </p>
      <ul>
        {view.sources.map((source) => <li key={source.id}><a href={source.url}>{source.label}</a></li>)}
        <li><a href={view.source.reuse_url}>Condizioni di riuso</a></li>
      </ul>
      <dl className={styles.metaList}>
        <div><dt>Date del mandato</dt><dd>Fonte istituzionale indicata nella cronologia</dd></div>
        <div><dt>Dati del voto acquisiti il</dt><dd>{view.source.retrieved_at}</dd></div>
        <div><dt>Licenza</dt><dd>{view.source.license}</dd></div>
      </dl>
    </div>
  );
}

function ContextSection({ view }: { view: GovernmentScorecardV6PageView }) {
  return (
    <section className={styles.section} id="contesto">
      <ContextCarousel
        slides={view.context.slides}
        mandate={{
          startDate: view.institutional_period.start_date,
          endDate: view.institutional_period.end_exclusive ?? view.institutional_period.as_of_date,
        }}
      />
    </section>
  );
}

function CompareSection({ view }: { view: GovernmentScorecardV6PageView }) {
  return (
    <section className={styles.section} id="confronta">
      <ArchiveComparison compare={view.compare} />
      <DownloadsPanel />
      <details className={styles.progressiveDetails}>
        <summary>Dati, fonti e verifiche</summary>
        <SourcesDetails view={view} />
      </details>
    </section>
  );
}

function PageSectionView({ section, view }: { section: PageSection; view: GovernmentScorecardV6PageView }) {
  switch (section) {
    case "charts":
      return <ChartsSection view={view} />;
    case "context":
      return <ContextSection view={view} />;
    case "compare":
      return <CompareSection view={view} />;
    case "methodology":
      return <MethodSection view={view} />;
    default:
      return assertNever(section);
  }
}

export function GovernmentScorecardPage({ view }: { view: GovernmentScorecardV6PageView }) {
  const presentation = presentGovernmentScorecardV6View(view);
  return (
    <main className={styles.page} id="contenuto-principale">
      <header className={styles.hero}>
        <span className={styles.kicker}>Pagella politico-economica</span>
        <h1>{view.government.name}</h1>
        <ScoreSummary view={view} presentation={presentation} />
        <div className={styles.periodLine}>
          <span>
            Mandato: <time dateTime={view.institutional_period.start_date}>{view.institutional_period.start_date}</time>
            {view.institutional_period.end_exclusive ? (
              <> → <time dateTime={view.institutional_period.end_exclusive}>{view.institutional_period.end_exclusive}</time></>
            ) : (
              <> → in corso</>
            )}
          </span>
          <span>Calcolo: {displayYear(view.statistical_window.baseline_year)} → {displayYear(view.statistical_window.end_year)}</span>
        </div>
        <HeroPillars view={view} />
        <nav aria-label="Approfondimenti della pagella">
          <a href="#grafici">Grafici</a>
          <a href="#contesto">Contesto</a>
          <a href="#metodo">Come viene calcolato</a>
          <a href="#dati-e-fonti">Scarica i dati</a>
        </nav>
      </header>

      <p className={styles.disclaimer}>{view.causal_disclaimer}</p>

      {view.section_order.map((section) => (
        <PageSectionView key={section} section={section} view={view} />
      ))}
    </main>
  );
}
