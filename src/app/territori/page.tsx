import Link from "next/link";
import type { Metadata } from "next";
import { PeriodSelector } from "@/components/period-selector";
import { RegionCrest, RegionCrestAttribution } from "@/components/region-crest";
import { compactEuro, compactEuroLike, exactEuro, integer, longDate } from "@/lib/format";
import { municipalityName } from "@/lib/municipality-name";
import { cptRegionAnchorOf, groupRegionsByMacroArea, istatCodeOfRegion } from "@/lib/italy-regions";
import {
  availableSiopeYears,
  getSiopeMunicipalSnapshot,
  partialMonth,
  regionsByPerCapita,
} from "@/lib/siope-snapshot";
import {
  getSiopeMunicipalityPeerCoverage,
  getSiopeMunicipalityPeerObservations,
} from "@/lib/siope-municipality-detail";
import {
  aggregateEurosPerSquareKilometreCents,
  centsPerSquareKilometreForCompleteCoverage,
  eurosPerSquareKilometreCents,
  getRegionGeography,
} from "@/lib/municipality-geography";
import { TerritoryMetricChart } from "./territory-metric-chart";
import { TerritoryViewSwitcher } from "./territory-view-switcher";
import styles from "./territori.module.css";

export const metadata: Metadata = {
  title: "Territori",
  description:
    "Pagamenti effettuati dai Comuni, regione per regione: valori per abitante, per km², totali. La pagina espone anche valori per km² e copertura dei Comuni con dati SIOPE e superficie ISTAT.",
};

function selectedYear(value: string | string[] | undefined): number {
  const raw = Array.isArray(value) ? value[0] ?? "" : value ?? "";
  const parsed = /^\d{4}$/.test(raw) ? Number(raw) : Number.NaN;
  return availableSiopeYears.includes(parsed) ? parsed : availableSiopeYears[0];
}

type Metric = "per-abitante" | "per-km2" | "totale";

function selectedMetric(value: string | string[] | undefined): Metric {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw === "per-km2" || raw === "totale" ? raw : "per-abitante";
}

const METRIC_LABELS: Record<Metric, string> = {
  "per-abitante": "Per abitante",
  "per-km2": "Per km²",
  totale: "Totale",
};

type TerritoryView = "grafico" | "tabella";
type PopulationFilter = "tutti" | "fino-5000" | "5000-20000" | "20000-100000" | "oltre-100000";
type SurfaceFilter = "tutte" | "fino-10" | "10-50" | "50-200" | "oltre-200";

function firstParam(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value)?.trim() ?? "";
}

function selectedView(value: string | string[] | undefined): TerritoryView {
  return firstParam(value) === "tabella" ? "tabella" : "grafico";
}

function selectedPopulationFilter(value: string | string[] | undefined): PopulationFilter {
  const raw = firstParam(value);
  return raw === "fino-5000" || raw === "5000-20000" || raw === "20000-100000" || raw === "oltre-100000"
    ? raw
    : "tutti";
}

function selectedSurfaceFilter(value: string | string[] | undefined): SurfaceFilter {
  const raw = firstParam(value);
  return raw === "fino-10" || raw === "10-50" || raw === "50-200" || raw === "oltre-200"
    ? raw
    : "tutte";
}

function compactMetric(value: number | null, metric: Metric): string {
  if (value === null) return "Non disponibile";
  if (metric === "totale") return compactEuro(value);
  const unit = metric === "per-km2" ? "€/km²" : "€/abitante";
  const absolute = Math.abs(value);
  if (absolute >= 1_000_000) {
    return `${(value / 1_000_000).toLocaleString("it-IT", { maximumFractionDigits: 1 })} mln ${unit}`;
  }
  if (absolute >= 1_000) {
    return `${(value / 1_000).toLocaleString("it-IT", { maximumFractionDigits: 0 })} mila ${unit}`;
  }
  return `${integer(Math.round(value))} ${unit}`;
}

function tableMetric(value: number | null, metric: Metric): string {
  if (value === null) return "n.d.";
  return metric === "totale" ? compactEuro(value) : compactMetric(value, metric);
}

function exactMetricValue(value: number | null): string {
  return value === null ? "n.d." : exactEuro(value);
}

function populationMatches(population: number | null, filter: PopulationFilter): boolean {
  if (filter === "tutti") return true;
  if (population === null) return false;
  if (filter === "fino-5000") return population < 5_000;
  if (filter === "5000-20000") return population >= 5_000 && population < 20_000;
  if (filter === "20000-100000") return population >= 20_000 && population < 100_000;
  return population >= 100_000;
}

function surfaceMatches(surface: number, filter: SurfaceFilter): boolean {
  if (filter === "tutte") return true;
  if (filter === "fino-10") return surface < 10;
  if (filter === "10-50") return surface >= 10 && surface < 50;
  if (filter === "50-200") return surface >= 50 && surface < 200;
  return surface >= 200;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
    : sorted[middle] ?? null;
}

function metricExplanation(metric: Metric): string {
  if (metric === "per-km2") {
    return "Il totale dei pagamenti è diviso per la superficie amministrativa ISTAT. Indica quanto la spesa è concentrata sul territorio, non quanto un Comune sia efficiente.";
  }
  if (metric === "totale") {
    return "È la somma dei pagamenti osservati nel periodo. Territori più popolosi o con maggiori investimenti tendono ad avere importi più elevati.";
  }
  return "Il totale dei pagamenti è diviso per la popolazione disponibile. Turismo, pendolarismo e servizi sovracomunali possono modificare i bisogni effettivi.";
}

export default async function TerritoriesPage({
  searchParams,
}: {
  searchParams: Promise<{
    anno?: string | string[];
    misura?: string | string[];
    vista?: string | string[];
    regione?: string | string[];
    confronta?: string | string[];
    comune?: string | string[];
    comune_regione?: string | string[];
    popolazione?: string | string[];
    superficie?: string | string[];
  }>;
}) {
  const params = await searchParams;
  const year = selectedYear(params.anno);
  const metric = selectedMetric(params.misura);
  const view = selectedView(params.vista);
  const selectedRegion = firstParam(params.regione) || null;
  const selectedComparison = firstParam(params.confronta).split(",").map((item) => item.trim()).filter(Boolean).slice(0, 3);
  const municipalityQuery = firstParam(params.comune);
  const municipalityRegion = firstParam(params.comune_regione);
  const populationFilter = selectedPopulationFilter(params.popolazione);
  const surfaceFilter = selectedSurfaceFilter(params.superficie);
  const data = getSiopeMunicipalSnapshot(year);
  const isPartialYear = partialMonth(data) !== null;
  const monthLabel = data.latestMonthLabel.toLocaleLowerCase("it-IT");

  const regions = regionsByPerCapita(data)
    .map((region) => {
      const regionCode = istatCodeOfRegion(region.region);
      const geography = regionCode ? getRegionGeography(year, regionCode) : null;
      const perSquareKm = geography
        ? eurosPerSquareKilometreCents(Math.round(region.value * 100), geography.surfaceSquareMetres)
        : null;
      return { ...region, geography, perSquareKm: perSquareKm === null ? null : perSquareKm / 100 };
    })
    .sort((left, right) => {
      const value = metric === "totale" ? "value" : metric === "per-km2" ? "perSquareKm" : "perCapita";
      return (right[value] ?? -1) - (left[value] ?? -1);
    });
  const regionsByArea = groupRegionsByMacroArea(regions);
  const nationalPerSquareKmCents = aggregateEurosPerSquareKilometreCents(
    regions.map((region) => ({
      amountCents: Math.round(region.value * 100),
      surfaceSquareMetres: region.geography?.surfaceSquareMetres ?? null,
    })),
  );
  const nationalPerSquareKm = nationalPerSquareKmCents === null
    ? null
    : nationalPerSquareKmCents / 100;
  const metricValue = (region: typeof regions[number]): number | null => metric === "totale"
    ? region.value
    : metric === "per-km2"
      ? region.perSquareKm
      : region.perCapita;
  const formatMetric = (value: number | null): string => compactMetric(value, metric);
  const nationalMetric = metric === "totale"
    ? data.totalPaid
    : metric === "per-km2"
      ? nationalPerSquareKm
      : data.nationalPerCapita;
  const nationalMetricLabel = metric === "per-km2"
    ? "Valore nazionale regionalizzato"
    : metric === "totale" ? "Totale Italia" : "Valore nazionale";
  const nationalMetricNote = metric === "per-km2"
    ? `Esclusi ${integer(data.coverage.withoutRegion)} Comuni senza regione e circa ${compactEuro(data.coverage.paymentsWithoutRegion)} di pagamenti.`
    : METRIC_LABELS[metric];
  const regionalMedian = median(regions.flatMap((region) => {
    const value = metricValue(region);
    return value === null ? [] : [value];
  }));
  const denominatorCoverage = metric === "per-km2"
    ? `${integer(regions.filter((region) => region.perSquareKm !== null).length)} / ${integer(regions.length)} regioni`
    : metric === "per-abitante"
      ? `${integer(data.coverage.withPopulation)} / ${integer(data.coverage.activeSiopeMunicipalities)} Comuni`
      : `${integer(data.coverage.withMovements)} / ${integer(data.coverage.activeSiopeMunicipalities)} Comuni`;
  const historyByRegion = new Map<string, Array<{
    year: number;
    value: number | null;
    formattedValue: string;
    periodLabel: string;
    partial: boolean;
  }>>();
  for (const historyYear of [...availableSiopeYears].sort((left, right) => left - right)) {
    const snapshot = getSiopeMunicipalSnapshot(historyYear);
    for (const historyRegion of regionsByPerCapita(snapshot)) {
      const regionCode = istatCodeOfRegion(historyRegion.region);
      const geography = regionCode ? getRegionGeography(historyYear, regionCode) : null;
      const perSquareKm = geography
        ? eurosPerSquareKilometreCents(Math.round(historyRegion.value * 100), geography.surfaceSquareMetres)
        : null;
      const value = metric === "totale"
        ? historyRegion.value
        : metric === "per-km2"
          ? perSquareKm === null ? null : perSquareKm / 100
          : historyRegion.perCapita;
      const points = historyByRegion.get(historyRegion.region) ?? [];
      points.push({
        year: historyYear,
        value,
        formattedValue: compactMetric(value, metric),
        periodLabel: `gennaio-${snapshot.latestMonthLabel.toLocaleLowerCase("it-IT")}`,
        partial: partialMonth(snapshot) !== null,
      });
      historyByRegion.set(historyRegion.region, points);
    }
  }
  const chartPoints = regions.flatMap((region) => {
    const value = metricValue(region);
    return value === null ? [] : [{
      label: region.region,
      value,
      formattedValue: formatMetric(value),
      exactValue: metric === "totale" ? exactEuro(value) : `${exactEuro(value)} ${metric === "per-km2" ? "per km²" : "per abitante"}`,
      total: compactEuro(region.value),
      perCapita: region.perCapita === null ? "n.d." : compactMetric(region.perCapita, "per-abitante"),
      perSquareKm: region.perSquareKm === null ? "n.d." : compactMetric(region.perSquareKm, "per-km2"),
      population: region.population === null ? "abitanti n.d." : `${integer(region.population)} abitanti`,
      surface: region.geography === null ? "superficie n.d." : `${region.geography.surfaceSquareKilometres.toLocaleString("it-IT", { maximumFractionDigits: 1 })} km²`,
      detailHref: cptRegionAnchorOf(region.region) ? `/territori/fisco#${cptRegionAnchorOf(region.region)}` : null,
      history: historyByRegion.get(region.region) ?? [],
    }];
  });
  const observations = getSiopeMunicipalityPeerObservations(year);
  const municipalityCoverage = getSiopeMunicipalityPeerCoverage(year);
  const municipalityRegions = [...new Set(observations.flatMap((item) => item.region ? [item.region] : []))]
    .sort((left, right) => left.localeCompare(right, "it-IT"));
  const normalizedMunicipalityQuery = municipalityQuery.toLocaleLowerCase("it-IT");
  const filteredMunicipalities = observations
    .map((item) => ({
      codiceFiscale: item.taxCode,
      name: item.name,
      province: item.province,
      region: item.region ?? "Territorio non regionalizzato",
      population: item.geography.residentPopulation,
      value: item.totalCents / 100,
      perCapita: item.perCapitaCents === null ? null : item.perCapitaCents / 100,
      perSquareKm: item.perSquareKmCents / 100,
      geography: item.geography,
    }))
    .filter((item) => !normalizedMunicipalityQuery || municipalityName(item.name).toLocaleLowerCase("it-IT").includes(normalizedMunicipalityQuery))
    .filter((item) => !municipalityRegion || item.region === municipalityRegion)
    .filter((item) => populationMatches(item.population, populationFilter))
    .filter((item) => surfaceMatches(item.geography.surfaceSquareKilometres, surfaceFilter));
  const hasMunicipalityFilters = Boolean(municipalityQuery || municipalityRegion || populationFilter !== "tutti" || surfaceFilter !== "tutte");
  const topMunicipalities = filteredMunicipalities
    .sort((left, right) => {
      const leftValue = metric === "totale" ? left.value : metric === "per-km2" ? left.perSquareKm : left.perCapita ?? -1;
      const rightValue = metric === "totale" ? right.value : metric === "per-km2" ? right.perSquareKm : right.perCapita ?? -1;
      return rightValue - leftValue;
    })
    .slice(0, hasMunicipalityFilters ? 10 : 5);
  const resetMunicipalityFiltersHref = `/territori?anno=${year}&misura=${metric}${view === "tabella" ? "&vista=tabella" : ""}${selectedRegion ? `&regione=${encodeURIComponent(selectedRegion)}` : ""}${selectedComparison.length > 0 ? `&confronta=${encodeURIComponent(selectedComparison.join(","))}` : ""}`;
  const regionScale = Math.max(
    ...regions.map((region) => region.value),
    ...regionsByArea.map(({ summary }) => summary.value),
    0,
  );
  return (
    <main className="shell page">
      <div className={styles.intro}>
        <div className="page-intro">
          {isPartialYear ? (
            <span className={styles.periodBadge}>Dati parziali · gennaio-{monthLabel} {data.year}</span>
          ) : null}
          <h1>Pagamenti dei Comuni, territorio per territorio</h1>
          <p>
            Pagamenti di cassa dei Comuni con sede nella regione, da gennaio a {monthLabel} {data.year}.
            {" "}{metricExplanation(metric)}
          </p>
        </div>
        <PeriodSelector activeYear={year} years={availableSiopeYears} pathname="/territori" query={{ misura: metric }} />
      </div>

      <nav className={styles.metricSelector} aria-label="Misura territoriale">
        {(["per-abitante", "per-km2", "totale"] as const).map((value) => (
          <Link
            key={value}
            href={`/territori?anno=${year}&misura=${value}`}
            aria-current={metric === value ? "page" : undefined}
          >
            {METRIC_LABELS[value]}
          </Link>
        ))}
      </nav>

      <dl className="stat-strip" aria-label={`Sintesi ${METRIC_LABELS[metric].toLocaleLowerCase("it-IT")}`}>
        <div>
          <dt>{nationalMetricLabel}</dt>
          <dd>{formatMetric(nationalMetric)}</dd>
          <small className="stat-note">{nationalMetricNote}</small>
        </div>
        <div>
          <dt>Mediana regionale</dt>
          <dd>{formatMetric(regionalMedian)}</dd>
          <small className="stat-note">Metà delle regioni è sopra, metà sotto</small>
        </div>
        <div>
          <dt>Copertura</dt>
          <dd>{denominatorCoverage}</dd>
          <small className="stat-note">Dati disponibili per questa misura</small>
        </div>
        <div>
          <dt>Periodo osservato</dt>
          <dd>Gennaio - {monthLabel}</dd>
          <small className="stat-note">{isPartialYear ? "Anno ancora parziale" : "Anno completo"}</small>
        </div>
      </dl>

      <TerritoryViewSwitcher
        key={`${year}-${metric}-${view}`}
        initialView={view}
        chart={<section className="panel">
          <TerritoryMetricChart
          points={chartPoints}
          title={`Confronto tra regioni · ${METRIC_LABELS[metric]}`}
          description="Una barra più lunga indica un valore maggiore nella misura selezionata. Non rappresenta qualità dei servizi, fabbisogno o merito amministrativo."
          reference={metric === "totale" || nationalMetric === null ? null : {
            label: nationalMetricLabel,
            value: nationalMetric,
            formattedValue: formatMetric(nationalMetric),
          }}
          initialRegion={selectedRegion}
          initialComparison={selectedComparison}
        />
        </section>}
        table={<section className="panel">
          <h2 className="panel-title">Tutte le {regions.length} regioni</h2>
          <div className="table-scroll" role="region" aria-label="Pagamenti di tutte le regioni; scorri orizzontalmente per vedere tutte le colonne" tabIndex={0}>
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Regione</th>
                  <th scope="col" className="num">{METRIC_LABELS[metric]}</th>
                  <th scope="col" className="num">Totale</th>
                  <th scope="col" className="num">{metric === "per-km2" ? "Superficie" : "Abitanti"}</th>
                  <th scope="col" className="num">Comuni nel rapporto</th>
                </tr>
              </thead>
              {regionsByArea.map(({ area, regions: areaRegions, summary }) => {
                const areaSurfaceSquareKilometres = areaRegions.every((region) => region.geography !== null)
                  ? areaRegions.reduce(
                      (total, region) => total + region.geography!.surfaceSquareKilometres,
                      0,
                    )
                  : null;
                const areaPerSquareKmCents = centsPerSquareKilometreForCompleteCoverage(
                  areaRegions.map((region) => ({
                    amountCents: Math.round(region.value * 100),
                    surfaceSquareMetres: region.geography?.surfaceSquareMetres ?? null,
                  })),
                );
                const areaPerSquareKm = areaPerSquareKmCents === null ? null : areaPerSquareKmCents / 100;
                return <tbody key={area}>
                  <tr className={styles.areaRow}>
                    <th scope="rowgroup">{area}</th>
                    <td className="num">
                      {metric === "totale"
                        ? compactEuro(summary.value)
                        : metric === "per-km2"
                          ? tableMetric(areaPerSquareKm, metric)
                          : tableMetric(summary.perCapita, metric)}
                    </td>
                    <td className="num">{compactEuroLike(summary.value, regionScale)}</td>
                    <td className="num">
                      {metric === "per-km2"
                        ? areaSurfaceSquareKilometres === null
                          ? "n.d."
                          : `${areaSurfaceSquareKilometres.toLocaleString("it-IT", { maximumFractionDigits: 1 })} km²`
                        : summary.population === null ? "n.d." : integer(summary.population)}
                    </td>
                    <td className="num">
                      {integer(summary.municipalitiesWithPopulation)} /{" "}
                      {integer(summary.municipalities)}
                    </td>
                  </tr>
                  {areaRegions.map((region) => {
                    const cptAnchor = cptRegionAnchorOf(region.region);
                    return (
                      <tr key={region.region}>
                        <th scope="row">
                          <RegionCrest
                            regionCode={istatCodeOfRegion(region.region)}
                            regionName={region.region}
                            decorative
                          />{" "}
                          {cptAnchor ? (
                            <Link
                              href={`/territori/fisco#${cptAnchor}`}
                              aria-label={`${region.region}: apri dati CPT 2023`}
                            >
                              {region.region}
                            </Link>
                          ) : (
                            region.region
                          )}
                        </th>
                        <td className="num">
                          {tableMetric(metric === "totale" ? region.value : metric === "per-km2" ? region.perSquareKm : region.perCapita, metric)}
                        </td>
                        <td className="num">{compactEuroLike(region.value, regionScale)}</td>
                        <td className="num">
                          {metric === "per-km2"
                            ? region.geography === null ? "n.d." : `${region.geography.surfaceSquareKilometres.toLocaleString("it-IT", { maximumFractionDigits: 1 })} km²`
                            : region.population === null ? "n.d." : integer(region.population)}
                        </td>
                        <td className="num">
                          {integer(region.municipalitiesWithPopulation)} /{" "}
                          {integer(region.municipalities)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>;
              })}
            </table>
          </div>
        </section>}
      />

      <RegionCrestAttribution />

      <details className={`panel ${styles.methodDetails}`}>
        <summary>Metodo, denominatori e copertura</summary>
        <p className={styles.note}>Nota di metodo: {data.methodology.warning}</p>
        <p className={styles.note}>
          {metric === "per-km2"
            ? "La superficie viene dallo snapshot annuale ISTAT SITUAS e deve essere positiva. I valori aggregati per km² sono disponibili soltanto quando ogni Regione del totale ha una geografia compatibile, così numeratore e denominatore mantengono la stessa copertura; il totale SIOPE resta sempre visibile per permettere la riconciliazione."
            : metric === "per-abitante"
              ? `Copertura pro capite: ${data.methodology.perCapitaCoverage}.`
              : "Il totale non usa un denominatore; comprende i pagamenti osservati nel periodo selezionato."}
        </p>
        <p className={styles.note}>
          I link regionali aprono i dati CPT 2023, un perimetro distinto da SIOPE. Nei CPT,
          Trento e Bolzano sono pubblicati come due Province autonome: il dato SIOPE aggregato
          del Trentino-Alto Adige non viene collegato artificialmente a una sola voce.
        </p>
      </details>

      <section className={`panel ${styles.municipalityPanel}`} data-municipality-ranking={metric}>
        <div className={styles.municipalityHeading}>
          <div>
            <span className={styles.eyebrow}>Esplora i Comuni</span>
            <h2 className="panel-title">Valori più alti · {METRIC_LABELS[metric].toLocaleLowerCase("it-IT")}</h2>
            <p>
              Non è una classifica di efficienza. Un totale alto può dipendere da turismo,
              ricostruzione o servizi offerti a non residenti; superficie ridotta, investimenti e
              servizi sovracomunali possono produrre valori molto distanti. I filtri aiutano a
              confrontare territori più omogenei.
            </p>
          </div>
          <Link href="/territori/confronto">Confronta Comuni simili →</Link>
        </div>

        <form action="/territori" method="get" className={styles.municipalityFilters}>
          <input type="hidden" name="anno" value={year} />
          <input type="hidden" name="misura" value={metric} />
          {view === "tabella" ? <input type="hidden" name="vista" value={view} /> : null}
          {selectedRegion ? <input type="hidden" name="regione" value={selectedRegion} /> : null}
          {selectedComparison.length > 0 ? <input type="hidden" name="confronta" value={selectedComparison.join(",")} /> : null}
          <label>
            <span>Comune</span>
            <input name="comune" defaultValue={municipalityQuery} placeholder="Cerca per nome" />
          </label>
          <label>
            <span>Regione</span>
            <select name="comune_regione" defaultValue={municipalityRegion}>
              <option value="">Tutte le regioni</option>
              {municipalityRegions.map((region) => <option key={region} value={region}>{region}</option>)}
            </select>
          </label>
          <label>
            <span>Abitanti</span>
            <select name="popolazione" defaultValue={populationFilter}>
              <option value="tutti">Qualsiasi popolazione</option>
              <option value="fino-5000">Meno di 5.000</option>
              <option value="5000-20000">Da 5.000 a 19.999</option>
              <option value="20000-100000">Da 20.000 a 99.999</option>
              <option value="oltre-100000">Almeno 100.000</option>
            </select>
          </label>
          <label>
            <span>Superficie</span>
            <select name="superficie" defaultValue={surfaceFilter}>
              <option value="tutte">Qualsiasi superficie</option>
              <option value="fino-10">Meno di 10 km²</option>
              <option value="10-50">Da 10 a 49,9 km²</option>
              <option value="50-200">Da 50 a 199,9 km²</option>
              <option value="oltre-200">Almeno 200 km²</option>
            </select>
          </label>
          <div className={styles.filterActions}>
            <button type="submit">Applica filtri</button>
            {hasMunicipalityFilters ? <Link href={resetMunicipalityFiltersHref}>Azzera</Link> : null}
          </div>
        </form>

        <div className={styles.resultsSummary} aria-live="polite">
          <strong>{integer(filteredMunicipalities.length)} Comuni trovati nel perimetro</strong>
          <span>
            Il perimetro comprende {integer(municipalityCoverage.withMovementsAndGeography)} Comuni con movimenti e superficie ISTAT disponibile: sono i Comuni con movimenti SIOPE e superficie ISTAT valida;
            {` `}esclude {integer(municipalityCoverage.withoutMovements)} senza movimenti e {integer(municipalityCoverage.withMovementsWithoutGeography)} senza superficie ISTAT abbinata.
          </span>
          <span>{topMunicipalities.length > 0 ? `Mostriamo i primi ${topMunicipalities.length} per ${METRIC_LABELS[metric].toLocaleLowerCase("it-IT")}.` : "Modifica i filtri per ampliare il confronto."}</span>
        </div>

        <div className="table-scroll" role="region" aria-label={`Comuni ordinati ${METRIC_LABELS[metric]}; scorri orizzontalmente per vedere tutte le colonne`} tabIndex={0}>
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Comune</th>
                <th scope="col" className="num">{METRIC_LABELS[metric]}</th>
                <th scope="col" className="num">Totale</th>
                <th scope="col" className="num">Abitanti</th>
                <th scope="col" className="num">Superficie</th>
              </tr>
            </thead>
            <tbody>
              {topMunicipalities.length === 0 ? (
                <tr><td colSpan={5} className={styles.emptyState}>Nessun Comune corrisponde ai filtri selezionati.</td></tr>
              ) : topMunicipalities.map((municipality) => {
                const selectedMunicipalityValue = metric === "totale"
                  ? municipality.value
                  : metric === "per-km2" ? municipality.perSquareKm : municipality.perCapita;
                return <tr key={municipality.codiceFiscale}>
                  <th scope="row">
                    {municipalityName(municipality.name)}
                    <small>{municipality.province} · {municipality.region}</small>
                  </th>
                  <td className="num" title={exactMetricValue(selectedMunicipalityValue)}>
                    {tableMetric(metric === "totale" ? municipality.value : metric === "per-km2" ? municipality.perSquareKm : municipality.perCapita, metric)}
                  </td>
                  <td className="num">{compactEuro(municipality.value)}</td>
                  <td className="num">{municipality.population === null ? "n.d." : integer(municipality.population)}</td>
                  <td className="num">{municipality.geography.surfaceSquareKilometres.toLocaleString("it-IT", { maximumFractionDigits: 1 })} km²</td>
                </tr>;
              })}
            </tbody>
          </table>
        </div>
      </section>

      <div className="notice">
        <strong>Come leggere i totali assoluti</strong>
        <p>
          Un Comune turistico serve molte più persone dei suoi residenti, e un Comune che
          ricostruisce dopo un terremoto spende per opere che dureranno decenni. I totali
          vanno letti con popolazione, servizi e contesto locale.
        </p>
      </div>

      <div className="notice">
        <strong>Entrate e spese sul territorio</strong>
        <p>
          Confronta entrate e spese della PA sul territorio.{" "}
          <Link href="/territori/fisco">Apri i Conti Pubblici Territoriali →</Link>
        </p>
      </div>

      <div className="notice">
        <strong>Redditi e imposte dichiarate</strong>
        <p>
          Dati MEF su contribuenti, redditi e imposta netta per Comune.{" "}
          <Link href="/territori/irpef">Apri IRPEF →</Link>
        </p>
      </div>

      <div className="notice">
        <strong>Spesa e fabbisogno standard</strong>
        <p>
          Per i Comuni in Regioni a statuto ordinario: spesa storica vs fabbisogno OpenCivitas.{" "}
          <Link href="/territori/confronto">Apri il confronto →</Link>
        </p>
      </div>

      <section className="panel">
        <h2 className="panel-title">Quanto del registro stiamo leggendo</h2>
        <div className={styles.coverage}>
          <dl className={styles.coverageList}>
            <div>
              <dt>Comuni con movimenti</dt>
              <dd>{integer(data.coverage.withMovements)}</dd>
            </div>
            <div>
              <dt>Comuni validi nel periodo</dt>
              <dd>{integer(data.coverage.activeSiopeMunicipalities)}</dd>
            </div>
            <div>
              <dt>Con movimenti senza regione</dt>
              <dd>{integer(data.coverage.withoutRegion)}</dd>
            </div>
            <div>
              <dt>Righe malformate</dt>
              <dd>{integer(data.coverage.malformedRows)}</dd>
            </div>
            <div>
              <dt>Comuni con popolazione</dt>
              <dd>{integer(data.coverage.withPopulation)}</dd>
            </div>
            <div>
              <dt>Senza popolazione</dt>
              <dd>{integer(data.coverage.withoutPopulation)}</dd>
            </div>
          </dl>
          <p>
            I {exactEuro(data.coverage.paymentsWithoutRegion)} dei Comuni senza abbinamento IPA
            restano nel totale nazionale ma fuori dai totali regionali: non assegniamo una regione
            senza una corrispondenza ufficiale. Il denominatore è la{" "}
            {data.methodology.populationSource}; {data.methodology.populationReference}; anagrafica
            aggiornata il{" "}
            {data.methodology.populationSourceLastModified
              ? longDate(data.methodology.populationSourceLastModified)
              : "data non disponibile"}. Fonte SIOPE · {data.source.siopeOwner},
            scaricata il{" "}
            {longDate(data.source.observedAt)}.{" "}
            <Link href="/fonti/stato">Stato di tutte le fonti →</Link>
          </p>
        </div>
      </section>
    </main>
  );
}
