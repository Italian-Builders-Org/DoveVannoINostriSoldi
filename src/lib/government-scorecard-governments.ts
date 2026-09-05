import { z } from "zod";

import sourceSpec from "../../scripts/etl/specs/government-scorecard.source.json";
import pageSpec from "../../scripts/etl/specs/government-scorecard-page.source.json";

import annualSnapshot from "@/data/generated/government-scorecard.json";
import { GOVERNMENT_SCORECARD_V6_MANIFEST } from "@/lib/data/government-scorecard-contract";
import { getGovernmentScorecardV6SupplementalSnapshot } from "@/lib/data/government-scorecard-page-contract";
import {
  GOVERNMENT_SCORECARD_V6_CHRONOLOGY,
  GOVERNMENT_SCORECARD_V6_REGISTRY,
} from "@/lib/government-scorecard-chronology";
import { calculateGovernmentScorecardV6 } from "@/lib/government-scorecard";
import {
  buildNotScoredGovernmentScorecardV6View,
  buildScoredGovernmentScorecardV6View,
  withGovernmentScorecardV6Ui,
  type GovernmentScorecardV6Gate,
  type GovernmentScorecardV6ContextSlide,
  type GovernmentScorecardV6PageView,
  type GovernmentScorecardV6ScoreState,
  type GovernmentScorecardV6Ui,
} from "@/lib/government-scorecard-page";
import { getGovernmentScorecardV6Sensitivity } from "@/lib/government-scorecard-sensitivity";
import { deriveAnnualStatisticalWindowV6, durationDaysV6 } from "@/lib/government-scorecard-temporal";

export const GOVERNMENT_SCORECARD_V6_GOVERNMENT_IDS = GOVERNMENT_SCORECARD_V6_CHRONOLOGY.map((government) => government.id);

export type GovernmentScorecardV6GovernmentId = (typeof GOVERNMENT_SCORECARD_V6_GOVERNMENT_IDS)[number];

const countryId = z.enum(["italy", "france", "germany", "spain"]);
const countrySeries = z.array(z.object({
  year: z.number().int(),
  value: z.number().finite().nullable(),
}).strict());
const rawSourceSeries = z.object({
  file: z.string().min(1),
  codeTemplate: z.string().min(1),
  title: z.string().min(1),
  unit: z.string().min(1),
}).strict();
const rawIndicatorSchema = z.object({
  id: z.string(),
  sourceId: z.literal("ameco"),
  direction: z.enum(["higher", "lower"]),
  transformation: z.enum(["log-change", "point-change"]),
  unit: z.string().min(1),
  definition: z.string().min(1),
  sourceSeries: z.array(rawSourceSeries).min(1),
  sourceCodes: z.record(countryId, z.array(z.string().min(1))),
  countries: z.record(countryId, countrySeries),
}).strict();
const rawAnnualDatasetSchema = z.object({
  schemaVersion: z.literal(2),
  methodologyVersion: z.literal("peer-relative-v6"),
  generatedAt: z.iso.datetime({ offset: true }),
  sources: z.object({
    ameco: z.object({
      owner: z.literal("European Commission, Directorate-General for Economic and Financial Affairs"),
      release: z.literal(sourceSpec.ameco.release),
      releaseDate: z.literal(sourceSpec.ameco.releaseDate),
      landingUrl: z.literal("https://economy-finance.ec.europa.eu/economic-research-and-databases/economic-databases/ameco-database/download-annual-data-set-macro-economic-database-ameco_en"),
      downloadUrl: z.literal("https://ec.europa.eu/economy_finance/db_indicators/ameco/documents/ameco0_csv.zip"),
      termsUrl: z.literal("https://commission.europa.eu/legal-notice_en"),
      license: z.literal("CC BY 4.0 unless otherwise indicated"),
      retrievedAt: z.literal(pageSpec.refreshPolicy.scoreAcquiredAt),
      bytes: z.literal(pageSpec.refreshPolicy.approvedSources[0].raw_bytes),
      sha256: z.literal(pageSpec.refreshPolicy.approvedSources[0].raw_sha256),
      observedThrough: z.literal(sourceSpec.ameco.observedThrough),
      forecastFrom: z.literal(sourceSpec.ameco.forecastFrom),
      forecastThrough: z.literal(sourceSpec.ameco.forecastThrough),
    }),
  }).strict(),
  indicators: z.array(rawIndicatorSchema).length(6),
  caveats: z.array(z.string().min(1)).min(3),
}).strict();

const annualDataset = rawAnnualDatasetSchema.parse(annualSnapshot);
const rawIndicatorById = new Map(annualDataset.indicators.map((indicator) => [indicator.id, indicator]));
const COUNTRY_IDS = { IT: "italy", FR: "france", DE: "germany", ES: "spain" } as const;
function rawValue(indicatorId: string, geography: keyof typeof COUNTRY_IDS, year: number): number | null {
  const indicator = rawIndicatorById.get(indicatorId);
  const point = indicator?.countries[COUNTRY_IDS[geography]].find((candidate) => candidate.year === year);
  return point?.value ?? null;
}

function commonObservedThrough(): number {
  for (let year = annualDataset.sources.ameco.observedThrough; year >= 1960; year -= 1) {
    const complete = GOVERNMENT_SCORECARD_V6_MANIFEST.indicators.every((indicator) =>
      GOVERNMENT_SCORECARD_V6_MANIFEST.countries.every(
        (geography) => rawValue(indicator.id, geography, year) !== null,
      ));
    if (complete) return year;
  }
  throw new Error("nessun endpoint AMECO comune osservato");
}

const COMMON_OBSERVED_THROUGH = commonObservedThrough();

function datasetIsComparable(): boolean {
  return GOVERNMENT_SCORECARD_V6_MANIFEST.indicators.every((indicator) => {
    const raw = rawIndicatorById.get(indicator.id);
    if (!raw) return false;
    const rawTransformation = raw.transformation.replace("-", "_");
    const sourceSeriesMatch = raw.sourceSeries.length === indicator.source_series.length
      && raw.sourceSeries.every((series, index) => {
        const expected = indicator.source_series[index];
        return series.file === expected.file
          && series.codeTemplate === expected.selector_template
          && series.title === expected.series_label
          && series.unit === expected.unit;
      });
    if (
      raw.direction !== indicator.direction
      || rawTransformation !== indicator.transformation
      || raw.unit !== indicator.unit
      || !sourceSeriesMatch
    ) return false;
    return GOVERNMENT_SCORECARD_V6_MANIFEST.countries.every((geography) => {
      const expected = indicator.source_series.map((series) =>
        series.selector_template.replace("{country}", { IT: "ITA", FR: "FRA", DE: "DEU", ES: "ESP" }[geography]));
      return JSON.stringify(raw.sourceCodes[COUNTRY_IDS[geography]]) === JSON.stringify(expected);
    });
  });
}

const DATASET_IS_COMPARABLE = datasetIsComparable();

function transformedChange(
  transformation: "log_change" | "point_change",
  baseline: number,
  end: number,
): number {
  if (transformation === "log_change") {
    if (baseline <= 0 || end <= 0) throw new RangeError("livello AMECO non positivo");
    return 100 * (Math.log(end) - Math.log(baseline));
  }
  return end - baseline;
}

function median(values: readonly number[]): number {
  const ordered = values.toSorted((left, right) => left - right);
  return ordered.length % 2 === 0
    ? (ordered[ordered.length / 2 - 1] + ordered[ordered.length / 2]) / 2
    : ordered[Math.floor(ordered.length / 2)];
}

function peerGap(indicatorId: string, baselineYear: number, endYear: number): number | null {
  const indicator = GOVERNMENT_SCORECARD_V6_MANIFEST.indicators.find((candidate) => candidate.id === indicatorId);
  if (!indicator) return null;
  const changes = new Map<string, number>();
  for (const geography of GOVERNMENT_SCORECARD_V6_MANIFEST.countries) {
    const baseline = rawValue(indicatorId, geography, baselineYear);
    const end = rawValue(indicatorId, geography, endYear);
    if (baseline === null || end === null) return null;
    const change = transformedChange(indicator.transformation, baseline, end);
    changes.set(geography, indicator.direction === "higher" ? change : -change);
  }
  const italy = changes.get("IT");
  const peers = GOVERNMENT_SCORECARD_V6_MANIFEST.peers.map((geography) => changes.get(geography));
  if (italy === undefined || peers.some((value) => value === undefined)) return null;
  return italy - median(peers as number[]);
}

function disjointCapacity(windows: readonly { start_year: number; end_year: number }[]): number {
  let capacity = 0;
  let previousEnd: number | undefined;
  for (const window of windows.toSorted((left, right) => left.end_year - right.end_year)) {
    if (previousEnd === undefined || window.start_year >= previousEnd) {
      capacity += 1;
      previousEnd = window.end_year;
    }
  }
  return capacity;
}

function scaleInputs(duration: number) {
  return GOVERNMENT_SCORECARD_V6_MANIFEST.indicators.map((indicator) => {
    const windows: { start_year: number; end_year: number; peer_gap: number }[] = [];
    for (
      let startYear = GOVERNMENT_SCORECARD_V6_MANIFEST.scale.first_score_year;
      startYear + duration <= COMMON_OBSERVED_THROUGH;
      startYear += 1
    ) {
      const gap = peerGap(indicator.id, startYear, startYear + duration);
      if (gap !== null) windows.push({ start_year: startYear, end_year: startYear + duration, peer_gap: gap });
    }
    return {
      key: {
        indicator_id: indicator.id,
        source_set_id: `ameco:${annualDataset.sources.ameco.release}`,
        temporal_operator_id: "annual_endpoint",
        duration_or_weight_pattern_id: `years:${duration}`,
        vintage_id: annualDataset.sources.ameco.release,
        peer_set_id: GOVERNMENT_SCORECARD_V6_MANIFEST.peers.join("|"),
        peer_aggregation_id: GOVERNMENT_SCORECARD_V6_MANIFEST.peer_aggregator,
        scale_estimator_id: GOVERNMENT_SCORECARD_V6_MANIFEST.scale.scale_estimator_id,
        calibration_period_id: GOVERNMENT_SCORECARD_V6_MANIFEST.scale.calibration_period_id,
        methodology_version: GOVERNMENT_SCORECARD_V6_MANIFEST.methodology_version,
      },
      windows,
    };
  });
}

function sourceInput() {
  const source = annualDataset.sources.ameco;
  return {
    source_id: "ameco" as const,
    source_owner: source.owner,
    dataset_code: "AMECO" as const,
    vintage: source.release,
    published_at: source.releaseDate,
    upstream_updated_at: source.releaseDate,
    retrieved_at: source.retrievedAt,
    observed_through: COMMON_OBSERVED_THROUGH,
    forecast_from: source.forecastFrom,
    forecast_through: source.forecastThrough,
    raw_url: source.downloadUrl,
    landing_url: source.landingUrl,
    reuse_url: source.termsUrl,
    license: source.license,
    raw_sha256: source.sha256,
    raw_bytes: source.bytes,
    limitations: [
      "I valori annuali iniziale e finale AMECO non descrivono ciò che accade dentro l'anno.",
      `Il vintage ${source.release} classifica il ${source.forecastFrom}-${source.forecastThrough} come previsione: questi anni non entrano nel voto.`,
    ],
  };
}

function chronologyGovernment(id: GovernmentScorecardV6GovernmentId) {
  const government = GOVERNMENT_SCORECARD_V6_CHRONOLOGY.find((candidate) => candidate.id === id);
  if (!government) throw new RangeError(`governo v6 non registrato: ${id}`);
  return government;
}

function missingEndpointInputs(baselineYear: number | null, endYear: number | null): string[] {
  if (baselineYear === null || endYear === null) return [];
  const missing: string[] = [];
  for (const indicator of GOVERNMENT_SCORECARD_V6_MANIFEST.indicators) {
    for (const geography of GOVERNMENT_SCORECARD_V6_MANIFEST.countries) {
      for (const year of [baselineYear, endYear]) {
        if (rawValue(indicator.id, geography, year) === null) {
          missing.push(`${indicator.id}:${geography}:${year}`);
        }
      }
    }
  }
  return missing;
}

function dataReason(missing: readonly string[], endpointPositive: boolean, scaleComplete: boolean): string {
  if (!endpointPositive) return "La finestra annuale non contiene due anni distinti.";
  if (missing.length > 0) return `Dati AMECO obbligatori mancanti: ${missing.join(", ")}.`;
  if (!scaleComplete) return "La serie storica necessaria al confronto è incompleta.";
  return "Definizione, unità o stato del dato non comparabile.";
}

export function getGovernmentScorecardV6Assessment(id: GovernmentScorecardV6GovernmentId) {
  const government = chronologyGovernment(id);
  const asOfDate = GOVERNMENT_SCORECARD_V6_REGISTRY.asOfDate;
  const institutionalEnd = government.end_exclusive ?? asOfDate;
  const durationDays = durationDaysV6(government.start_date, institutionalEnd);
  const window = deriveAnnualStatisticalWindowV6(government, COMMON_OBSERVED_THROUGH, asOfDate);
  const endpointPositive = window.baseline_year !== null
    && window.end_year !== null
    && window.end_year > window.baseline_year;
  const missing = missingEndpointInputs(window.baseline_year, window.end_year);
  const duration = endpointPositive ? window.end_year! - window.baseline_year! : 0;
  const scales = duration > 0 ? scaleInputs(duration) : [];
  const scaleGate = scales.map((scale) => {
    const capacity = disjointCapacity(scale.windows);
    return {
      indicator_id: scale.key.indicator_id,
      rolling_count: scale.windows.length,
      disjoint_capacity: capacity,
      passes: scale.windows.length >= GOVERNMENT_SCORECARD_V6_MANIFEST.scale.minimum_rolling_windows
        && capacity >= GOVERNMENT_SCORECARD_V6_MANIFEST.scale.minimum_disjoint_windows,
    };
  });
  const scaleComplete = scaleGate.length === 6 && scaleGate.every((scale) => scale.passes);
  const forecastFree = window.end_year === null || window.end_year <= COMMON_OBSERVED_THROUGH;
  const gate: GovernmentScorecardV6Gate = {
    minimum_duration_days: 365,
    duration_days: durationDays,
    duration_complete: durationDays >= 365,
    endpoint_positive: endpointPositive,
    mandatory_inputs_complete: missing.length === 0,
    comparable: DATASET_IS_COMPARABLE,
    forecast_free: forecastFree,
    scales: scaleGate,
  };
  let scoreState: GovernmentScorecardV6ScoreState;
  let reason: string | undefined;
  if (!gate.duration_complete) {
    scoreState = "not_scored_short";
    reason = "Mandato troppo breve per i dati annuali disponibili.";
  } else if (
    !gate.endpoint_positive
    || !gate.mandatory_inputs_complete
    || !gate.comparable
    || !gate.forecast_free
    || !scaleComplete
  ) {
    scoreState = "not_scored_data";
    reason = dataReason(missing, endpointPositive, scaleComplete);
  } else {
    scoreState = government.status === "current" ? "scored_provisional" : "scored_final";
  }
  return {
    government,
    as_of_date: asOfDate,
    window,
    gate,
    score_state: scoreState,
    reason,
    scales,
  };
}

export function buildGovernmentScorecardV6Input(id: GovernmentScorecardV6GovernmentId) {
  const assessment = getGovernmentScorecardV6Assessment(id);
  if (!assessment.score_state.startsWith("scored_") || assessment.window.baseline_year === null || assessment.window.end_year === null) {
    throw new RangeError(`il governo ${id} non supera i gate v6`);
  }
  const observations = GOVERNMENT_SCORECARD_V6_MANIFEST.indicators.flatMap((indicator) =>
    GOVERNMENT_SCORECARD_V6_MANIFEST.countries.map((geography) => {
      const baseline = rawValue(indicator.id, geography, assessment.window.baseline_year!);
      const end = rawValue(indicator.id, geography, assessment.window.end_year!);
      const raw = rawIndicatorById.get(indicator.id);
      if (baseline === null || end === null || !raw) throw new Error("gate dati v6 non riconciliato");
      return {
        indicator_id: indicator.id,
        geography,
        source_id: "ameco" as const,
        dataset_code: "AMECO" as const,
        series_selectors: raw.sourceCodes[COUNTRY_IDS[geography]],
        definition: indicator.definition,
        unit: indicator.unit,
        frequency: "annual" as const,
        seasonal_adjustment: "not_applicable" as const,
        baseline: {
          reference_period: assessment.window.baseline_year!,
          value_raw: baseline,
          observed_or_forecast: "observed" as const,
          status_flags_or_null: null,
        },
        end: {
          reference_period: assessment.window.end_year!,
          value_raw: end,
          observed_or_forecast: "observed" as const,
          status_flags_or_null: null,
        },
      };
    }));
  const government = assessment.government;
  return {
    schema_version: 1 as const,
    snapshot_version: `${id}-v6-all-1`,
    methodology_version: "peer-relative-v6" as const,
    as_of_date: assessment.as_of_date,
    government: {
      id: government.id,
      name: government.name,
      start_date: government.start_date,
      end_date: government.end_exclusive,
      status: government.status,
      source_owner: government.source_owner,
      source_url: government.source_url,
      source_locator: government.source_locator,
    },
    source: sourceInput(),
    window: {
      temporal_operator_id: "annual_endpoint" as const,
      ...assessment.window,
      baseline_year: assessment.window.baseline_year,
      end_year: assessment.window.end_year,
      duration_or_weight_pattern_id: `years:${assessment.window.end_year - assessment.window.baseline_year}`,
    },
    stability: {
      evidence_scope: "calcolo-base; diagnostica applicata separatamente",
      operational_combined_width: null,
      method_audit_width: null,
      label: null,
      source: "government-scorecard-sensitivity",
    },
    observations,
    scales: assessment.scales,
  };
}

const CHART_COPY = {
  inflation: {
    question: "Come si è mossa l'inflazione nei quattro paesi?",
    unit: "% annuo",
  },
  real_compensation: {
    question: "Come sono cambiate le retribuzioni reali nei quattro paesi?",
    unit: "Indice reale (2020 = 100)",
  },
  unemployment: {
    question: "Come è cambiato il tasso di disoccupazione nei quattro paesi?",
    unit: "% della popolazione attiva",
  },
  employment_rate: {
    question: "Come è cambiato il tasso di occupazione tra 20 e 64 anni?",
    unit: "% della popolazione 20–64",
  },
  real_gdp_per_capita: {
    question: "Come è cambiato il PIL reale per abitante nei quattro paesi?",
    unit: "Migliaia di valuta nazionale, prezzi 2020",
  },
  debt_ratio: {
    question: "Come è cambiato il debito pubblico rispetto al PIL?",
    unit: "% del PIL",
  },
  debt_per_capita: {
    question: "Come è cambiato il debito pubblico per abitante?",
    unit: "Euro per abitante",
  },
  primary_balance: {
    question: "Come è cambiato il saldo primario rispetto al PIL?",
    unit: "% del PIL",
  },
  investment_share: {
    question: "Come sono cambiati gli investimenti rispetto al PIL?",
    unit: "% del PIL",
  },
} as const;

const CHART_COUNTRY_LABELS = {
  IT: "Italia",
  FR: "Francia",
  DE: "Germania",
  ES: "Spagna",
} as const;

const CHART_FREQUENCY_LABELS = {
  annual: "Annuale",
  quarterly: "Trimestrale",
  monthly: "Mensile",
} as const;

function chartQualityNotes(upstreamStatus: string | null): string[] {
  const flags = new Set(upstreamStatus ?? "");
  return [
    flags.has("b") ? "interruzione nella serie" : null,
    flags.has("d") ? "definizione diversa" : null,
    flags.has("u") ? "bassa affidabilità" : null,
  ].filter((note): note is string => note !== null);
}

function buildTimeSeriesCharts(
  assessment: ReturnType<typeof getGovernmentScorecardV6Assessment>,
): GovernmentScorecardV6Ui["charts"] {
  const snapshot = getGovernmentScorecardV6SupplementalSnapshot();
  const institutionalStartDate = assessment.government.start_date;
  const institutionalEndDate = assessment.government.end_exclusive ?? snapshot.as_of_date;

  return {
    status: "ready",
    default_scope: "mandate",
    slides: snapshot.series.map((indicator) => {
      const points = indicator.geographies.flatMap((geography) => geography.points);
      const years = points.map((point) => point.year);
      const dates = points.map((point) => point.period_start).toSorted();
      const completeStart = Math.min(...years);
      const completeEnd = Math.max(...years);
      const completeStartDate = dates[0]!;
      const completeEndDate = dates.at(-1)!;
      const mandateStartDate = institutionalStartDate;
      const mandateEndDate = institutionalEndDate;
      const mandateEndExclusive = assessment.government.end_exclusive !== null;
      const mandateStart = Number(mandateStartDate.slice(0, 4));
      const mandateEnd = Number(mandateEndDate.slice(0, 4));
      const firstPoint = indicator.geographies[0]?.points[0];
      if (!firstPoint) throw new Error(`serie supplementare vuota: ${indicator.indicator_id}`);
      return {
        status: "ready" as const,
        indicator_id: indicator.indicator_id,
        title: indicator.label,
        question: CHART_COPY[indicator.indicator_id].question,
        unit: CHART_COPY[indicator.indicator_id].unit,
        frequency: CHART_FREQUENCY_LABELS[indicator.frequency],
        mandate_window: {
          start_year: mandateStart,
          end_year: mandateEnd,
          start_date: mandateStartDate,
          end_date: mandateEndDate,
          end_exclusive: mandateEndExclusive,
        },
        complete_window: {
          start_year: completeStart,
          end_year: completeEnd,
          start_date: completeStartDate,
          end_date: completeEndDate,
          end_exclusive: false,
        },
        note: indicator.usage === "score_and_context"
          ? `Ogni punto è un dato ${CHART_FREQUENCY_LABELS[indicator.frequency].toLowerCase()} pubblicato dalla fonte: le linee uniscono soltanto periodi disponibili e non creano dati intermedi. Questa serie fa parte dei sei indicatori annuali del voto.`
          : `Ogni punto è un dato ${CHART_FREQUENCY_LABELS[indicator.frequency].toLowerCase()} pubblicato dalla fonte; le linee uniscono solo i periodi disponibili. Stime, dati provvisori, interruzioni, definizioni diverse o bassa affidabilità sono indicati accanto al numero.`,
        source: {
          owner: firstPoint.source_owner,
          url: firstPoint.source_url,
          data_version: snapshot.snapshot_version,
          retrieved_at: firstPoint.retrieved_at,
          raw_sha256: firstPoint.raw_sha256,
        },
        series: indicator.geographies.map((geography) => ({
          id: geography.geography,
          label: CHART_COUNTRY_LABELS[geography.geography],
          points: geography.points.map((point) => {
            const qualityNotes = chartQualityNotes(point.upstream_status_or_null);
            return {
              year: point.year,
              period: point.period,
              period_start: point.period_start,
              value: point.value,
              status: point.status,
              ...(qualityNotes.length > 0 ? { quality_notes: qualityNotes } : {}),
            };
          }),
        })),
      };
    }),
  };
}

function buildContextSlides(
  assessment: ReturnType<typeof getGovernmentScorecardV6Assessment>,
): readonly GovernmentScorecardV6ContextSlide[] {
  const frozen = getGovernmentScorecardV6SupplementalSnapshot().contexts.find(
    (context) => context.government_id === assessment.government.id,
  );
  if (!frozen) throw new Error("contesto supplementare v6 non disponibile");
  const ids = {
    overview: "overview",
    inheritance: "inheritance",
    geopolitics_crises: "geopolitics_crises",
    eurozone_ecb: "ecb",
    laws_measures: "measures",
    chronology: "chronology",
  } as const;
  const labels = {
    overview: "Mandato",
    inheritance: "Eredità",
    geopolitics_crises: "Crisi e guerre",
    eurozone_ecb: "BCE",
    laws_measures: "Misure",
    chronology: "Cronologia",
  } as const;
  const titles = {
    overview: "Il mandato in breve",
    inheritance: "Situazione ereditata",
    geopolitics_crises: "Geopolitica, shock e crisi",
    eurozone_ecb: "BCE ed eurozona",
    laws_measures: "Manovre e misure",
    chronology: "Cronologia",
  } as const;
  const selectionRules = {
    overview: "Sintesi del mandato istituzionale e dello stato del voto.",
    inheritance: "Ultimo anno osservato coerente con l'inizio del periodo.",
    geopolitics_crises: "Evento esterno essenziale, documentato e sovrapposto al mandato.",
    eurozone_ecb: "Decisione monetaria comune documentata e sovrapposta al mandato.",
    laws_measures: "Atto ufficiale approvato o attuato durante il mandato.",
    chronology: "Data di giuramento verificata; fine esclusiva uguale al giuramento del successore.",
  } as const;
  const mandateRelations = {
    overview: "during",
    inheritance: "inherited",
    geopolitics_crises: "cross_government",
    eurozone_ecb: "cross_government",
    laws_measures: "during",
    chronology: "during",
  } as const;

  return frozen.slides.map((slide) => {
    const id = ids[slide.category];
    const firstItem = slide.items[0] ?? null;
    const lastItem = slide.items.at(-1) ?? null;
    const period = firstItem === null
      ? "Nessuna prova disponibile"
      : slide.items.some((item) => item.end_date_or_null === null)
        ? `${firstItem.start_date}–in corso`
        : `${firstItem.start_date}–${lastItem!.end_date_or_null}`;
    const items = slide.status === "ready"
      ? slide.items.map((item) => ({
          id: item.id,
          title: item.title,
          summary: item.summary,
          period: item.period,
          start_date: item.start_date,
          end_date_or_null: item.end_date_or_null,
          date_precision: item.date_precision,
          economic_channel: item.economic_channel,
          mandate_relation: item.mandate_relation,
          selection_rule: item.selection_rule,
          score_impact: item.score_impact,
          sources: item.sources,
          retrieved_at: item.retrieved_at,
          evidence_sha256: item.evidence_sha256,
        }))
      : [];
    return {
      id,
      context_item_id: items[0]?.id ?? `${frozen.government_id}:${id}-empty`,
      government_id: frozen.government_id,
      category: slide.category,
      title: titles[slide.category],
      label: labels[slide.category],
      status: slide.status,
      badge: "Contesto · non cambia il voto",
      score_impact: "none",
      primary_value: slide.category === "inheritance" && slide.status === "ready" ? slide.summary : null,
      message: slide.status === "ready" ? slide.summary : slide.message,
      summary: slide.status === "ready" ? [slide.summary] : [],
      period,
      start_date: firstItem?.start_date ?? null,
      end_date_or_null: items.some((item) => item.end_date_or_null === null) ? null : (lastItem?.end_date_or_null ?? null),
      date_precision: firstItem?.date_precision ?? "day",
      economic_channel: firstItem?.economic_channel ?? null,
      mandate_relation: mandateRelations[slide.category],
      selection_rule: selectionRules[slide.category],
      source_rank: slide.status === "ready" ? 1 : null,
      source_owner: firstItem?.sources[0]?.owner ?? null,
      source_type: slide.status === "ready" ? "official" : null,
      persistent_id_or_url: firstItem?.sources[0]?.url ?? null,
      retrieved_at: firstItem?.retrieved_at ?? null,
      evidence_sha256: firstItem?.evidence_sha256 ?? null,
      items,
    } satisfies GovernmentScorecardV6ContextSlide;
  });
}

function buildSupplementalUi(
  assessment: ReturnType<typeof getGovernmentScorecardV6Assessment>,
): GovernmentScorecardV6Ui {
  return {
    charts: buildTimeSeriesCharts(assessment),
    context: {
      status: "ready",
      slides: buildContextSlides(assessment),
    },
    compare: {
      status: "ready",
      message: "Scegli due governi per leggere affiancati gli stessi dati e il contesto documentato.",
      current_government_id: assessment.government.id,
      options: GOVERNMENT_SCORECARD_V6_GOVERNMENT_IDS.map((id) => {
        const candidate = getGovernmentScorecardV6Assessment(id);
        const scoreDisplay = candidate.score_state === "scored_final" || candidate.score_state === "scored_provisional"
          ? calculateGovernmentScorecardV6(buildGovernmentScorecardV6Input(id)).display_score
          : null;
        return {
          id,
          label: candidate.government.name,
          href: `/governi/${id}`,
          score_state: candidate.score_state,
          score_display: scoreDisplay,
          start_date: candidate.government.start_date,
          end_date: candidate.government.end_exclusive,
          current: candidate.government.status === "current",
        };
      }),
    },
  };
}

export function getGovernmentScorecardV6View(id: GovernmentScorecardV6GovernmentId): GovernmentScorecardV6PageView {
  const assessment = getGovernmentScorecardV6Assessment(id);
  if (assessment.score_state === "scored_final" || assessment.score_state === "scored_provisional") {
    const result = calculateGovernmentScorecardV6(buildGovernmentScorecardV6Input(id));
    const stress = getGovernmentScorecardV6Sensitivity(id);
    const view = buildScoredGovernmentScorecardV6View(
      result,
      assessment.score_state,
      {
        sensitivity_complete: stress.sensitivity_complete,
        stability_label: stress.stability,
        sensitivity_badges: stress.sensitivity_badges,
        comparison_notes: [
          stress.comparison_incompatible_reason
            ?? (stress.missing_axes.includes("vintage")
              ? "Confronto consentito sullo stesso snapshot base; lo stress sul vintage precedente non e' disponibile."
              : "Metodo e vintage coincidono nel confronto."),
        ],
        stress,
      },
      assessment.gate,
    );
    return withGovernmentScorecardV6Ui(view, buildSupplementalUi(assessment));
  }
  const government = assessment.government;
  const view = buildNotScoredGovernmentScorecardV6View(
    {
      government: {
        id: government.id,
        name: government.name,
        start_date: government.start_date,
        end_date: government.end_exclusive,
        status: government.status,
        source_owner: government.source_owner,
        source_url: government.source_url,
        source_locator: government.source_locator,
      },
      as_of_date: assessment.as_of_date,
      coverage: {
        mandatory_inputs_complete: assessment.gate.mandatory_inputs_complete,
        scale_complete: assessment.gate.scales.length === 6 && assessment.gate.scales.every((scale) => scale.passes),
        comparable: assessment.gate.comparable,
        endpoint_status: assessment.gate.forecast_free ? "observed" : "forecast",
        missing_reason: assessment.reason,
      },
    },
    assessment.score_state,
    sourceInput(),
    assessment.window,
    assessment.gate,
  );
  return withGovernmentScorecardV6Ui(view, buildSupplementalUi(assessment));
}

export function isGovernmentScorecardV6GovernmentId(value: string): value is GovernmentScorecardV6GovernmentId {
  return (GOVERNMENT_SCORECARD_V6_GOVERNMENT_IDS as readonly string[]).includes(value);
}

export function getCurrentGovernmentScorecardV6Id(): GovernmentScorecardV6GovernmentId {
  const current = GOVERNMENT_SCORECARD_V6_CHRONOLOGY.find((government) => government.status === "current");
  if (!current || !isGovernmentScorecardV6GovernmentId(current.id)) {
    throw new Error("governo corrente non registrato nella pagella");
  }
  return current.id;
}

export function getGovernmentScorecardPublicPaths() {
  return GOVERNMENT_SCORECARD_V6_GOVERNMENT_IDS.map((id) => `/governi/${id}` as const);
}

export function getGovernmentScorecardSourceSummary() {
  const source = annualDataset.sources.ameco;
  const observedCells = annualDataset.indicators.reduce(
    (total, indicator) => total + Object.values(indicator.countries).reduce(
      (countryTotal, points) => countryTotal + points.filter((point) => point.value !== null).length,
      0,
    ),
    0,
  );
  return {
    release: source.release,
    releaseDate: source.releaseDate,
    retrievedAt: source.retrievedAt,
    observedThrough: source.observedThrough,
    forecastFrom: source.forecastFrom,
    forecastThrough: source.forecastThrough,
    observedCells,
    governmentCount: GOVERNMENT_SCORECARD_V6_CHRONOLOGY.length,
    firstGovernmentYear: GOVERNMENT_SCORECARD_V6_CHRONOLOGY[0]!.start_date.slice(0, 4),
    chronologyVerifiedAt: GOVERNMENT_SCORECARD_V6_REGISTRY.verifiedAt,
  } as const;
}
