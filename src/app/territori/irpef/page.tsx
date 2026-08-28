import type { Metadata } from "next";
import Form from "next/form";
import Link from "next/link";
import { HorizontalScrollRegion } from "@/components/horizontal-scroll-region";
import { RegionCrest, RegionCrestAttribution } from "@/components/region-crest";
import { compactEuro, compactEuroLike, exactEuro, integer, longDate } from "@/lib/format";
import {
  MefIrpefQueryError,
  queryMefMunicipalIrpef,
  type MefIrpefLevel,
  type MefIrpefQuery,
  type MefIrpefTerritoryRecord,
  type ReportedMeasure,
} from "@/lib/mef-irpef-snapshot";
import type { MefIrpefMeasureKey } from "@/lib/data/mef-irpef-contract";
import { municipalityName } from "@/lib/municipality-name";
import {
  getMunicipalityGeographyByIstatCode,
  getRegionGeography,
} from "@/lib/municipality-geography";
import styles from "./irpef.module.css";

export const metadata: Metadata = {
  title: "Redditi e imposta netta dichiarata per territorio",
  description:
    "Contribuenti, redditi, imposta netta dichiarata e addizionali MEF 2024 per Regione, Provincia e Comune.",
};

const PAGE_SIZE = 50;

const LEVEL_BY_PARAM = {
  regione: "region",
  provincia: "province",
  comune: "municipality",
} as const satisfies Record<string, MefIrpefLevel>;

const PARAM_BY_LEVEL: Readonly<Record<MefIrpefLevel, keyof typeof LEVEL_BY_PARAM>> = {
  region: "regione",
  province: "provincia",
  municipality: "comune",
};

const METRIC_LABELS: Readonly<Record<MefIrpefMeasureKey, string>> = {
  comprehensiveIncome: "Reddito complessivo",
  taxableIncome: "Reddito imponibile",
  netTaxDeclared: "Imposta netta dichiarata",
  regionalSurtaxDue: "Addizionale regionale dovuta",
  municipalSurtaxDue: "Addizionale comunale dovuta",
};

const METRIC_KEYS = Object.keys(METRIC_LABELS) as MefIrpefMeasureKey[];

type PageParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function nonEmpty(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized || undefined;
}

function optionalInteger(value: string | undefined): number | undefined {
  if (value === undefined || value === "") return undefined;
  return /^\d+$/.test(value) ? Number(value) : Number.NaN;
}

function pageQuery(params: PageParams): MefIrpefQuery {
  const levelValue = nonEmpty(first(params.livello));
  let level: MefIrpefLevel | undefined;
  if (levelValue) {
    level = LEVEL_BY_PARAM[levelValue as keyof typeof LEVEL_BY_PARAM];
    if (!level) {
      throw new MefIrpefQueryError(
        "invalid_query",
        "Il livello deve essere regione, provincia oppure comune.",
      );
    }
  }

  return {
    year: optionalInteger(first(params.anno)),
    level,
    region: nonEmpty(first(params.regione)),
    province: nonEmpty(first(params.provincia)),
    code: nonEmpty(first(params.codice)),
    query: nonEmpty(first(params.q)),
    limit: PAGE_SIZE,
    offset: optionalInteger(first(params.offset)),
  };
}

function amount(measure: ReportedMeasure): number {
  return measure.coverage === "complete" ? measure.amountCents : measure.knownAmountCents;
}

function frequency(measure: ReportedMeasure): number {
  return measure.coverage === "complete" ? measure.frequency : measure.knownFrequency;
}

function suppressedRowsLabel(count: number): string {
  return `${integer(count)} ${count === 1 ? "riga oscurata" : "righe oscurate"}`;
}

function SummaryAmount({ measure }: { measure: ReportedMeasure }) {
  const knownAmount = amount(measure);
  return (
    <dd>
      <span aria-label={`${measure.coverage === "partial" ? "Subtotale noto, almeno " : ""}${exactEuro(knownAmount / 100)}`}>
        {measure.coverage === "partial" ? "≥ " : ""}
        {compactEuro(knownAmount / 100)}
      </span>
      <small>
        {measure.coverage === "partial"
          ? `${suppressedRowsLabel(measure.suppressedRows)} · subtotale noto`
          : `${integer(measure.frequency)} contribuenti con valore`}
      </small>
    </dd>
  );
}

function TableAmount({
  measure,
  referenceCents,
}: {
  measure: ReportedMeasure;
  referenceCents: number;
}) {
  const knownAmount = amount(measure);
  const partial = measure.coverage === "partial";
  return (
    <div className={styles.metricValue}>
      <span
        aria-label={`${partial ? "Subtotale noto, almeno " : ""}${exactEuro(knownAmount / 100)}`}
      >
        {partial ? "≥ " : ""}
        {compactEuroLike(knownAmount / 100, referenceCents / 100)}
      </span>
      <small>
        {partial
          ? `Frequenza nota: ${integer(frequency(measure))} contribuenti`
          : `${integer(frequency(measure))} contribuenti con valore`}
      </small>
      {partial ? (
        <em>{suppressedRowsLabel(measure.suppressedRows)}</em>
      ) : null}
    </div>
  );
}

function territoryName(record: MefIrpefTerritoryRecord): string {
  if (record.territory.level === "region") return record.territory.name;
  if (record.territory.level === "province") return `Provincia ${record.territory.abbreviation}`;
  return municipalityName(record.territory.name);
}

function territoryContext(
  record: MefIrpefTerritoryRecord,
  regionNames: ReadonlyMap<string, string>,
): string | null {
  if (record.territory.level === "region") return null;
  const region = regionNames.get(record.territory.regionCode) ?? `Regione ${record.territory.regionCode}`;
  if (record.territory.level === "province") return region;
  return `${record.territory.provinceAbbreviation} · ${region}`;
}

function geographyContext(record: MefIrpefTerritoryRecord, year: number): string | null {
  if (record.territory.level === "municipality") {
    const geography = getMunicipalityGeographyByIstatCode(year, record.territory.code);
    if (!geography) return null;
    const density = geography.densityPerSquareKilometre === null
      ? "densità n.d."
      : `${integer(Math.round(geography.densityPerSquareKilometre))} ab./km²`;
    return `${geography.surfaceSquareKilometres.toLocaleString("it-IT", { maximumFractionDigits: 1 })} km² · ${density} · ${geography.altimetricZoneLabel ?? "altimetria n.d."}`;
  }
  if (record.territory.level === "region") {
    const geography = getRegionGeography(year, record.territory.code);
    return geography
      ? `${geography.surfaceSquareKilometres.toLocaleString("it-IT", { maximumFractionDigits: 1 })} km² · ${integer(Math.round(geography.densityPerSquareKilometre))} ab./km²`
      : null;
  }
  return null;
}

function paginationUrl(result: ReturnType<typeof queryMefMunicipalIrpef>, offset: number): string {
  const params = new URLSearchParams({
    anno: String(result.period.taxYear),
    livello: PARAM_BY_LEVEL[result.level],
    offset: String(offset),
  });
  if (result.query.region) params.set("regione", result.query.region);
  if (result.query.province) params.set("provincia", result.query.province);
  if (result.query.code) params.set("codice", result.query.code);
  if (result.query.query) params.set("q", result.query.query);
  return `/territori/irpef?${params.toString()}`;
}

function hasMunicipalityScope(query: MefIrpefQuery): boolean {
  return Boolean(query.region || query.province || query.code || query.query);
}

function normalizedRegionName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase("it-IT")
    .trim();
}

function selectedRegionCode(
  value: string | undefined,
  regions: readonly MefIrpefTerritoryRecord[],
): string {
  if (!value) return "";
  const normalized = normalizedRegionName(value);
  const match = regions.find((record) =>
    record.territory.level === "region" && (
      record.territory.code === value ||
      normalizedRegionName(record.territory.name) === normalized ||
      record.territory.sourceNames.some((name) => normalizedRegionName(name) === normalized)
    ));
  return match?.territory.code ?? "";
}

export default async function MefIrpefPage({
  searchParams,
}: {
  searchParams: Promise<PageParams>;
}) {
  const params = await searchParams;
  const regionOverview = queryMefMunicipalIrpef({ level: "region", limit: 20 });
  let queryError: string | null = null;
  let queryErrorTitle = "Filtri non validi";
  let queryErrorDetail = "Sono mostrati di nuovo i dati regionali.";
  let result: ReturnType<typeof queryMefMunicipalIrpef>;
  let requestedQuery: MefIrpefQuery | undefined;
  let awaitingMunicipalityFilter = false;
  try {
    requestedQuery = pageQuery(params);
    if (requestedQuery.level === "municipality" && !hasMunicipalityScope(requestedQuery)) {
      awaitingMunicipalityFilter = true;
      result = regionOverview;
    } else {
      result = queryMefMunicipalIrpef(requestedQuery);
    }
  } catch (error) {
    if (!(error instanceof MefIrpefQueryError)) throw error;
    queryErrorTitle = error.code === "not_found" ? "Territorio non trovato" : "Filtri non validi";
    if (error.code === "not_found" && requestedQuery?.offset && requestedQuery.offset > 0) {
      try {
        result = queryMefMunicipalIrpef({ ...requestedQuery, offset: 0 });
        queryErrorTitle = "Pagina non disponibile";
        queryError = "La pagina richiesta non esiste.";
        queryErrorDetail = "Sono mostrati i primi risultati della stessa ricerca.";
      } catch {
        queryError = error.message;
        result = regionOverview;
      }
    } else {
      queryError = error.message;
      result = regionOverview;
    }
  }

  const regionNames = new Map(
    regionOverview.data.flatMap((record) =>
      record.territory.level === "region" ? [[record.territory.code, record.territory.name] as const] : []),
  );
  const firstResult = result.pagination.total === 0 ? 0 : result.pagination.offset + 1;
  const lastResult = result.pagination.offset + result.pagination.returned;
  const previousOffset = Math.max(0, result.pagination.offset - result.pagination.limit);
  const nextOffset = result.pagination.offset + result.pagination.limit;
  const displayLevel = awaitingMunicipalityFilter ? "municipality" : result.level;
  const activeQuery = awaitingMunicipalityFilter && requestedQuery ? requestedQuery : result.query;
  const selectedLevel = PARAM_BY_LEVEL[displayLevel];
  const selectedRegion = selectedRegionCode(activeQuery.region, regionOverview.data);
  const selectedProvince = activeQuery.province ?? "";
  const selectedQuery = activeQuery.query ?? "";
  const resetUrl = `/territori/irpef?anno=${result.period.taxYear}&livello=${selectedLevel}`;
  const matched = result.matchedTotals;
  const source = result.provenance.source;

  return (
    <main className="shell page">
      <div className="page-intro">
        <h1>Redditi e imposta netta dichiarata, Comune per Comune</h1>
        <p>
          Statistiche MEF su contribuenti, redditi e addizionali. La vista iniziale mostra le
          Regioni; puoi passare a Province e Comuni senza scaricare l’intero archivio nel browser.
        </p>
      </div>

      <div className={styles.period} aria-label="Periodo e aggiornamento del dataset">
        <span><strong>Anno d’imposta</strong> {result.period.taxYear}</span>
        <span><strong>Dichiarazioni</strong> {result.period.declarationYear}</span>
        <span><strong>Pubblicazione</strong> {longDate(`${result.period.publishedAt}T00:00:00Z`)}</span>
        <span><strong>Snapshot verificato</strong> {longDate(result.period.observedAt)}</span>
      </div>

      <div className="notice">
        <strong>Che cosa misura l&apos;imposta netta dichiarata</strong>
        <p>
          L&apos;imposta netta dichiarata è la cifra presente nelle statistiche MEF sulle
          dichiarazioni. Resta separata da spesa e saldo CPT.
        </p>
      </div>

      {queryError ? (
        <div className="notice warning-notice" role="alert">
          <strong>{queryErrorTitle}</strong>
          <p>{queryError} {queryErrorDetail} <Link href="/territori/irpef">Azzera i filtri →</Link></p>
        </div>
      ) : null}

      <section aria-labelledby="irpef-summary-title">
        <h2 className="panel-title" id="irpef-summary-title">
          {awaitingMunicipalityFilter
            ? "Totali nazionali attribuiti ai territori"
            : "Totali delle righe corrispondenti"}
        </h2>
        <dl className={styles.summary}>
          <div>
            <dt>Contribuenti</dt>
            <dd>
              <span>{integer(matched.taxpayers)}</span>
              <small>Persone nelle statistiche MEF</small>
            </dd>
          </div>
          {METRIC_KEYS.map((key) => (
            <div key={key}>
              <dt>{METRIC_LABELS[key]}</dt>
              <SummaryAmount measure={matched.measures[key]} />
            </div>
          ))}
        </dl>
        <p className={styles.coverageNote}>
          I totali territoriali escludono la riga non geografica <code>Mancante/errata</code>,
          conservata separatamente: {integer(result.national.unassigned.taxpayers)} contribuenti.
          Un simbolo ≥ indica un subtotale noto, perché alcune celle sono oscurate dal MEF.
        </p>
      </section>

      <section className="panel" aria-labelledby="irpef-filters-title">
        <h2 className="panel-title" id="irpef-filters-title">Scegli il dettaglio territoriale</h2>
        <nav className={styles.levelTabs} aria-label="Livello territoriale">
          <Link
            aria-current={displayLevel === "region" ? "page" : undefined}
            href={`/territori/irpef?anno=${result.period.taxYear}&livello=regione`}
          >
            Regioni
          </Link>
          <Link
            aria-current={displayLevel === "province" ? "page" : undefined}
            href={`/territori/irpef?anno=${result.period.taxYear}&livello=provincia`}
          >
            Province
          </Link>
          <Link
            aria-current={displayLevel === "municipality" ? "page" : undefined}
            href={`/territori/irpef?anno=${result.period.taxYear}&livello=comune`}
          >
            Comuni
          </Link>
        </nav>
        <Form action="/territori/irpef" className={styles.filters}>
          <input name="anno" type="hidden" value={result.period.taxYear} />
          <input name="livello" type="hidden" value={selectedLevel} />
          <label>
            <span>Regione</span>
            <select className="input" defaultValue={selectedRegion} name="regione">
              <option value="">Tutte le Regioni</option>
              {regionOverview.data.map((record) =>
                record.territory.level === "region" ? (
                  <option key={record.territory.code} value={record.territory.code}>
                    {record.territory.name}
                  </option>
                ) : null)}
            </select>
          </label>
          {displayLevel !== "region" ? (
            <label>
              <span>Provincia</span>
              <input
                className="input"
                defaultValue={selectedProvince}
                maxLength={3}
                name="provincia"
                placeholder="Sigla o codice, es. RM"
              />
            </label>
          ) : null}
          {displayLevel === "municipality" ? (
            <label>
              <span>Cerca un Comune</span>
              <input
                className="input"
                defaultValue={selectedQuery}
                maxLength={100}
                name="q"
                placeholder="Per esempio, Bologna"
                type="search"
              />
            </label>
          ) : null}
          <div className={styles.filterActions}>
            <button className="btn btn-primary" type="submit">Applica</button>
            <Link className="btn btn-secondary" href={resetUrl}>Azzera</Link>
          </div>
        </Form>
        <p className={styles.filterHint}>
          {displayLevel === "municipality"
            ? "Indica almeno una Regione, una Provincia o un testo di ricerca. Le Province accettano la sigla o il codice ISTAT a tre cifre."
            : displayLevel === "province"
              ? "Puoi restringere l’elenco per Regione, sigla provinciale o codice ISTAT a tre cifre."
              : "Puoi mostrare tutte le Regioni oppure selezionarne una."}
        </p>
      </section>

      <section className="panel" aria-labelledby="irpef-results-title">
        <div className={styles.resultsHeader}>
          <div>
            <h2 className="panel-title" id="irpef-results-title">Dettaglio territoriale</h2>
            <p id="irpef-results-summary">
              {awaitingMunicipalityFilter
                ? "Indica almeno un filtro per caricare i Comuni."
                : result.pagination.total === 0
                ? "Nessun territorio corrisponde ai filtri scelti."
                : `Risultati da ${integer(firstResult)} a ${integer(lastResult)} su ${integer(result.pagination.total)}.`}
            </p>
          </div>
          <span>Anno d’imposta {result.period.taxYear}</span>
        </div>

        {!awaitingMunicipalityFilter && result.data.length > 0 ? (
          <>
          <p className={styles.scrollHint} id="irpef-scroll-hint">
            Tabella larga: scorri orizzontalmente. Da tastiera, porta il focus sulla tabella e usa
            Freccia sinistra, Freccia destra, Inizio e Fine.
          </p>
          <HorizontalScrollRegion
            ariaDescribedBy="irpef-results-summary irpef-scroll-hint"
            ariaLabel="Redditi e variabili IRPEF per territorio"
            className={`table-scroll ${styles.tableRegion}`}
          >
            <table className={`table ${styles.table}`}>
              <caption>Contribuenti, redditi, imposta netta dichiarata e addizionali per territorio</caption>
              <thead>
                <tr>
                  <th scope="col">Territorio</th>
                  <th className="num" scope="col">Contribuenti</th>
                  <th scope="col">Contesto geografico</th>
                  {METRIC_KEYS.map((key) => (
                    <th className="num" key={key} scope="col">{METRIC_LABELS[key]}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {result.data.map((record) => {
                  const context = territoryContext(record, regionNames);
                  const geography = geographyContext(record, result.period.taxYear);
                  return (
                    <tr key={`${record.territory.level}:${record.territory.code}`}>
                      <th scope="row">
                        {record.territory.level === "region" ? (
                          <RegionCrest
                            regionCode={record.territory.code}
                            regionName={record.territory.name}
                            decorative
                          />
                        ) : null}{" "}
                        {territoryName(record)}
                        {context ? <small>{context}</small> : null}
                      </th>
                      <td className="num">{integer(record.taxpayers)}</td>
                      <td>{geography ?? "Non disponibile per questo livello"}</td>
                      {METRIC_KEYS.map((key) => (
                        <td className="num" key={key}>
                          <TableAmount
                            measure={record.measures[key]}
                            referenceCents={amount(matched.measures[key])}
                          />
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </HorizontalScrollRegion>
          </>
        ) : (
          <div className={styles.emptyState}>
            <p>
              {awaitingMunicipalityFilter
                ? "Scegli una Regione, una Provincia o inserisci il nome di un Comune."
                : "Nessun risultato. Prova un nome meno specifico o rimuovi uno dei filtri."}
            </p>
            <Link className="btn btn-secondary" href={resetUrl}>Azzera i filtri</Link>
          </div>
        )}

        {!awaitingMunicipalityFilter && result.pagination.total > result.pagination.limit ? (
          <nav className={styles.pagination} aria-label="Paginazione dei territori">
            {result.pagination.offset > 0 ? (
              <Link className="btn btn-secondary" href={paginationUrl(result, previousOffset)}>← Precedenti</Link>
            ) : <span aria-hidden="true" />}
            <span>Pagina {integer(Math.floor(result.pagination.offset / result.pagination.limit) + 1)}</span>
            {nextOffset < result.pagination.total ? (
              <Link className="btn btn-secondary" href={paginationUrl(result, nextOffset)}>Successivi →</Link>
            ) : <span aria-hidden="true" />}
          </nav>
        ) : null}
      </section>

      {displayLevel === "region" && !awaitingMunicipalityFilter ? <RegionCrestAttribution /> : null}

      <section className={`panel ${styles.methodology}`} aria-labelledby="irpef-method-title">
        <div>
          <h2 className="panel-title" id="irpef-method-title">Come leggere le variabili</h2>
          <dl className={styles.definitions}>
            <div><dt>Contribuenti</dt><dd>{result.definitions.taxpayers}</dd></div>
            {METRIC_KEYS.map((key) => (
              <div key={key}><dt>{METRIC_LABELS[key]}</dt><dd>{result.definitions[key]}</dd></div>
            ))}
          </dl>
          <p className={styles.methodNote}>{result.methodology.missingValues}</p>
          <p className={styles.methodNote}>{result.methodology.municipalityAssignment}</p>
        </div>
        <div className={styles.provenance}>
          <h2 className="panel-title">Fonte e provenienza</h2>
          <p>
            <a href={source.landingUrl} target="_blank" rel="noreferrer">MEF, Dipartimento delle Finanze</a>,
            anno d’imposta {result.period.taxYear}. Licenza{" "}
            <a href={source.licenseUrl} target="_blank" rel="noreferrer">{source.license}</a>;
            attribuzione: {source.attribution}.
          </p>
          <ul>
            <li><a href={source.methodologyUrl} target="_blank" rel="noreferrer">Nota metodologica ufficiale</a></li>
            <li><a href={source.definitionsUrl} target="_blank" rel="noreferrer">Definizioni ufficiali delle variabili</a></li>
            <li><a href={source.assetUrl} target="_blank" rel="noreferrer">CSV ufficiale bloccato nello snapshot</a></li>
          </ul>
          <dl>
            <div><dt>Comuni attribuiti</dt><dd>{integer(result.coverage.municipalities)}</dd></div>
            <div><dt>Province</dt><dd>{integer(result.coverage.provinces)}</dd></div>
            <div><dt>Regioni</dt><dd>{integer(result.coverage.regions)}</dd></div>
            <div><dt>Hash ZIP</dt><dd><code className={styles.hash}>{source.zip.sha256}</code></dd></div>
          </dl>
          <p className={styles.sourceFooter}>
            Snapshot osservato il {longDate(result.period.observedAt)}. L’hash è un’impronta
            calcolata dal progetto sul file osservato. <Link href="/fonti/stato">Controlla lo stato delle fonti →</Link>
          </p>
        </div>
      </section>
    </main>
  );
}
