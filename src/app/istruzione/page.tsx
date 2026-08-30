import type { Metadata } from "next";
import Link from "next/link";
import { CompanyAtlasMap } from "@/components/company-atlas-map";
import { EducationAtlasFilters } from "@/components/education-atlas-filters";
import { EducationTrendChart } from "./education-trend-chart";
import { integer, longDate, percent } from "@/lib/format";
import {
  EDUCATION_ATLAS_ALL,
  educationAtlasPathwayOptions,
  educationAtlasPeriodOptions,
  educationAtlasRegionOptions,
  educationAtlasSchoolTypeOptions,
  getEducationAtlasView,
} from "@/lib/education-atlas";
import styles from "./istruzione.module.css";

export const metadata: Metadata = {
  title: "Atlante Istruzione",
  description:
    "Studenti, percorsi e indirizzi della scuola secondaria di II grado: dati aggregati MIM, mappe regionali e trend osservati.",
};

type SearchParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function compactStudents(value: number | null): string {
  if (value === null) return "n.d.";
  if (Math.abs(value) >= 1_000_000) {
    return `${(value / 1_000_000).toLocaleString("it-IT", { maximumFractionDigits: 1 })} mln`;
  }
  if (Math.abs(value) >= 1_000) {
    return `${(value / 1_000).toLocaleString("it-IT", { maximumFractionDigits: 1 })} mila`;
  }
  return integer(value);
}

function signedPercent(current: number | null, previous: number | null): string {
  if (current === null || previous === null || previous === 0) return "n.d.";
  const change = ((current - previous) / previous) * 100;
  return `${change >= 0 ? "+" : ""}${percent(change)}`;
}

function genderShare(female: number | null, total: number | null): string {
  if (female === null || total === null || total === 0) return "n.d.";
  return percent((female / total) * 100);
}

function educationHref(view: { period: string; region: string; schoolType: string; pathway: string }, region?: string): string {
  const params = new URLSearchParams({ period: view.period });
  if (view.schoolType !== EDUCATION_ATLAS_ALL) params.set("schoolType", view.schoolType);
  if (view.pathway !== EDUCATION_ATLAS_ALL) params.set("pathway", view.pathway);
  if (region && region !== EDUCATION_ATLAS_ALL) params.set("region", region);
  return `/istruzione?${params.toString()}`;
}

export default async function EducationAtlasPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const view = getEducationAtlasView({
    period: first(params.period),
    region: first(params.region),
    schoolType: first(params.schoolType),
    pathway: first(params.pathway),
  });
  const topPathways = view.pathwayBreakdown.slice(0, 8);
  const pathwayTotal = view.pathwayBreakdown.reduce((sum, pathway) => sum + (pathway.value ?? 0), 0);
  const topRegions = view.ranking.filter((region) => region.value !== null).slice(0, 10);
  const currentTrend = view.trend.at(-1);
  const previousTrend = view.trend.at(-2);
  const selectedRegionName = view.selectedRegion?.name ?? (view.missingRegionNames.length > 0 ? "Territori osservati" : "Tutta Italia");
  const studentSource = view.sources.find((item) => item.id === "students")!;
  const registrySource = view.sources.find((item) => item.id === "registry")!;
  const selectedPeriodSourceFile = view.sourceFiles.find(
    (file) => file.role === "students" && file.period === view.period,
  );
  const hasTrendData = view.trend.some((point) => point.value !== null);

  return (
    <main className={`shell ${styles.dashboard}`}>
      <header className={styles.hero}>
        <div>
          <span className={styles.kicker}>Modulo Istruzione · MIM</span>
          <h1>Atlante Istruzione</h1>
          <p>
            Quali percorsi della scuola secondaria di II grado sono presenti, dove e come cambiano?
            Esplora gli studenti osservati dal MIM per Regione, tipo di scuola e indirizzo.
          </p>
        </div>
        <div className={styles.heroMeta}>
          <span className="tag tag-accent">Solo dati aggregati</span>
          <span>Scuola secondaria di II grado · dal 2022/23 al 2024/25</span>
          <Link href="/metodologia">Come leggiamo i numeri →</Link>
        </div>
      </header>

      <EducationAtlasFilters
        filters={{
          period: view.period,
          region: view.region,
          schoolType: view.schoolType,
          pathway: view.pathway,
        }}
        periods={educationAtlasPeriodOptions().map((item) => ({ id: item.id, label: item.label }))}
        regions={educationAtlasRegionOptions().map((item) => ({ id: item.code, label: item.name }))}
        schoolTypes={educationAtlasSchoolTypeOptions().map((item) => ({ id: item.code, label: item.label }))}
        pathways={educationAtlasPathwayOptions().map((item) => ({ id: item.code, label: item.label }))}
      />

      <div className={styles.dashboardGrid}>
        <div className={styles.column}>
          <section className="panel" aria-labelledby="education-scope-title">
            <div className={styles.panelHead}>
              <h2 id="education-scope-title" className="panel-title">Perimetro selezionato</h2>
              <span className="status status-attiva">Snapshot MIM</span>
            </div>
            <strong className={styles.headline}>{compactStudents(view.perimeterValue)}</strong>
            <p className={styles.headlineNote}>studenti osservati · anno scolastico {view.periodLabel} · dati al {longDate(selectedPeriodSourceFile?.dataAsOf)}</p>

            <dl className={styles.factRows}>
              <div><dt>Territorio</dt><dd>{selectedRegionName}</dd></div>
              <div><dt>Tipo di scuola</dt><dd>{view.schoolType === EDUCATION_ATLAS_ALL ? "Statali e paritarie" : view.schoolType === "state" ? "Statale" : "Paritaria"}</dd></div>
              <div><dt>Percorso</dt><dd>{view.selectedPathwayLabel}</dd></div>
              <div><dt>Copertura</dt><dd>{view.coverage.observedRegionCount}/{view.coverage.expectedRegionCount} Regioni</dd></div>
            </dl>

            <p className={styles.definition}>
              La presenza di studenti in un indirizzo descrive il file osservato. Non è una misura di qualità,
              esito scolastico, domanda futura o carenza occupazionale.
            </p>
            <Link className="btn btn-block" href="/metodologia">Metodo e definizioni</Link>
          </section>

          <section className="panel" aria-labelledby="pathway-title">
            <div className={styles.panelHead}>
              <h2 id="pathway-title" className="panel-title">Dove si concentrano i percorsi</h2>
              <span className={styles.headNote}>studenti osservati</span>
            </div>
            {topPathways.length > 0 ? (
              <ul className={styles.pathwayList}>
                {topPathways.map((pathway) => {
                  const share = pathway.value !== null && pathwayTotal > 0 ? (pathway.value / pathwayTotal) * 100 : 0;
                  return (
                    <li key={pathway.code}>
                      <div className={styles.pathwayLabel}>
                        <span>{pathway.label}</span>
                        <strong>{compactStudents(pathway.value)}</strong>
                      </div>
                      <i aria-hidden="true"><b style={{ width: `${share}%` }} /></i>
                      <small>{pathway.value === null ? "n.d." : percent(share)} del perimetro · {genderShare(pathway.femaleCount, pathway.value)} ragazze</small>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className={styles.emptyState} role="status">Dato non disponibile per il perimetro selezionato.</p>
            )}
            <p className={styles.note}>Il percorso è una categoria del file MIM; l&apos;indirizzo di studio è il dettaglio sottostante.</p>
          </section>
        </div>

        <div className={styles.column}>
          <section className={`panel ${styles.mapPanel}`} aria-labelledby="education-map-title">
            <div className={styles.panelHead}>
              <h2 id="education-map-title" className="panel-title">Studenti osservati per Regione</h2>
              <span className={styles.headNote}>{view.periodLabel}</span>
            </div>
            <CompanyAtlasMap
              regions={view.regionPoints}
              selectedRegion={view.region}
              metricUnit="studenti osservati"
              mapTitle="Studenti osservati nell'Atlante Istruzione"
              mapDescription="Mappa regionale degli studenti della scuola secondaria di secondo grado nel file MIM. Le Regioni senza dato restano non disponibili. Usa Tab, i tasti freccia e Invio per esplorare."
            />
            <p className={styles.attribution}>
              Confini amministrativi a fini statistici: <a href="https://www.istat.it/storage/cartografia/confini_amministrativi/generalizzati/2026/Limiti01012026_g.zip" target="_blank" rel="noreferrer">ISTAT, 1 gennaio 2026</a>, CC BY 4.0. La scala della mappa è relativa al perimetro visualizzato.
            </p>
          </section>

          <section className="panel" aria-labelledby="education-ranking-title">
            <div className={styles.panelHead}>
              <h2 id="education-ranking-title" className="panel-title">Prime 10 Regioni</h2>
              <span className={styles.headNote}>valore assoluto</span>
            </div>
            {topRegions.length > 0 ? (
              <div className="table-scroll" role="region" aria-label="Prime 10 Regioni ordinate per studenti osservati" tabIndex={0}>
                <table className="table">
                  <thead><tr><th scope="col">#</th><th scope="col">Regione</th><th scope="col" className="num">Studenti</th></tr></thead>
                  <tbody>
                    {topRegions.map((region, index) => (
                      <tr key={region.code}>
                        <td className="num">{index + 1}</td>
                        <th scope="row"><Link href={educationHref(view, region.code)}>{region.name}</Link></th>
                        <td className="num">{compactStudents(region.value)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className={styles.emptyState} role="status">Dato non disponibile per il perimetro selezionato.</p>
            )}
            <p className={styles.note}>La classifica descrive la dimensione del perimetro selezionato, non la qualità delle scuole.</p>
          </section>
        </div>

        <div className={styles.column}>
          <section className="panel" aria-labelledby="trend-title">
            <div className={styles.panelHead}>
              <h2 id="trend-title" className="panel-title">Trend del perimetro</h2>
              <span className={styles.headNote}>serie disponibile</span>
            </div>
            {hasTrendData ? (
              <>
                <EducationTrendChart data={view.trend} />
                <p className={styles.trendDelta}>
                  Ultimo confronto: <strong>{signedPercent(currentTrend?.value ?? null, previousTrend?.value ?? null)}</strong> rispetto all&apos;anno precedente.
                </p>
              </>
            ) : (
              <p className={styles.emptyState} role="status">Dato non disponibile per il perimetro selezionato.</p>
            )}
            <p className={styles.note}>La variazione è descrittiva e dipende dal perimetro e dalla classificazione pubblicati dal MIM.</p>
          </section>

          <section className="panel" aria-labelledby="address-title">
            <div className={styles.panelHead}>
              <h2 id="address-title" className="panel-title">Indirizzi più presenti</h2>
              <span className={styles.headNote}>{view.periodLabel}</span>
            </div>
            {view.addressRanking.length > 0 ? (
              <div className={`table-scroll ${styles.addressTable}`} role="region" aria-label="Indirizzi di studio con più studenti osservati" tabIndex={0}>
                <table className="table">
                  <thead><tr><th scope="col">Indirizzo</th><th scope="col">Percorso</th><th scope="col" className="num">Studenti</th></tr></thead>
                  <tbody>
                    {view.addressRanking.map((address) => (
                      <tr key={`${address.pathwayCode}-${address.addressLabel}`}>
                        <th scope="row">{address.addressLabel}</th>
                        <td>{address.pathwayLabel}</td>
                        <td className="num">{integer(address.value)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className={styles.emptyState} role="status">Dato non disponibile per il perimetro selezionato.</p>
            )}
            <p className={styles.note}>Gli indirizzi sono aggregati dal file MIM. Non vengono pubblicati nomi o indirizzi fisici delle scuole.</p>
          </section>

          <section className={`panel ${styles.coveragePanel}`} aria-labelledby="coverage-title">
            <div className={styles.panelHead}>
              <h2 id="coverage-title" className="panel-title">Copertura della fonte</h2>
              <span className="tag tag-neutral">da leggere con cautela</span>
            </div>
            <div className={styles.coverageSignal}>
              <strong>{view.coverage.observedRegionCount}/{view.coverage.expectedRegionCount} Regioni osservate</strong>
              <span>{view.missingRegionNames.join(" e ") || "Copertura completa"}</span>
            </div>
            <p className={styles.sourceCaveat}>
              {view.missingRegionNames.length > 0
                ? `Il dataset studenti esclude le province autonome di Trento e Bolzano; l'anagrafe usata per il join esclude inoltre Aosta. La copertura comune è ${view.coverage.observedRegionCount}/${view.coverage.expectedRegionCount} Regioni: ${view.missingRegionNames.join(" e ")} restano n.d.; n.d. significa dato non disponibile nel perimetro, non assenza di scuole o studenti.`
                : "Il file osservato espone tutte le Regioni dichiarate nel perimetro."}
            </p>
            <dl className={styles.factRows}>
              <div><dt>Join tecnico</dt><dd>CODICESCUOLA</dd></div>
              <div><dt>Righe anno selezionato</dt><dd>{integer(view.coverage.byPeriodSchoolType[view.period]?.state.sourceRows ?? 0)} + {integer(view.coverage.byPeriodSchoolType[view.period]?.paritaria.sourceRows ?? 0)}</dd></div>
              <div><dt>Dati della distribuzione</dt><dd>{longDate(selectedPeriodSourceFile?.dataAsOf)}</dd></div>
              <div><dt>Pubblicato dataset studenti</dt><dd>{longDate(studentSource.publishedAt)}</dd></div>
              <div><dt>Pubblicata anagrafe join</dt><dd>{longDate(registrySource.publishedAt)}</dd></div>
              <div><dt>Verificato da noi</dt><dd>{longDate(studentSource.verifiedAt)}</dd></div>
            </dl>
          </section>

          <section className="panel" aria-labelledby="education-source-title">
            <div className={styles.panelHead}>
              <h2 id="education-source-title" className="panel-title">Fonte del numero</h2>
              <span className="status status-attiva">IODL 2.0</span>
            </div>
            <h3 className={styles.sourceTitle}>{studentSource.label}</h3>
            <p className={styles.sourcePublisher}>{studentSource.publisher}</p>
            <p className={styles.sourceCaveat}>{studentSource.caveat}</p>
            <a className="btn btn-block" href={studentSource.landingUrl} target="_blank" rel="noreferrer">Apri il catalogo MIM ↗</a>
          </section>
        </div>
      </div>
    </main>
  );
}
