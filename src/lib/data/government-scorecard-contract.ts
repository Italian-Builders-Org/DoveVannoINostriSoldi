import { z } from "zod";

import sourceSpec from "../../../scripts/etl/specs/government-scorecard.source.json";
import pageSpec from "../../../scripts/etl/specs/government-scorecard-page.source.json";

import canonicalManifest from "../../../scripts/etl/specs/government-scorecard-methodology.json";
import {
  GOVERNMENT_SCORECARD_V6_CHRONOLOGY,
  GOVERNMENT_SCORECARD_V6_REGISTRY,
} from "@/lib/government-scorecard-chronology";
import { deriveAnnualStatisticalWindowV6, durationDaysV6 } from "@/lib/government-scorecard-temporal";

const indicatorId = z.enum([
  "real_compensation",
  "unemployment",
  "real_gdp_per_capita",
  "debt_ratio",
  "primary_balance",
  "investment_share",
]);

const sourceSeriesSchema = z.object({
  file: z.string().min(1),
  selector_template: z.string().min(1),
  series_label: z.string().min(1),
  unit: z.string().min(1),
}).strict();

const indicatorSchema = z.object({
  id: indicatorId,
  pillar_id: z.enum(["purchasing_power", "labour", "growth", "public_finance", "future_capacity"]),
  direction: z.enum(["higher", "lower"]),
  transformation: z.enum(["log_change", "point_change"]),
  unit: z.string().min(1),
  definition: z.string().min(1),
  source_series: z.array(sourceSeriesSchema).min(1).max(2),
}).strict();

const pillarSchema = z.object({
  id: z.enum(["purchasing_power", "labour", "growth", "public_finance", "future_capacity"]),
  weight_basis_points: z.number().int().positive(),
  indicators: z.array(z.object({
    indicator_id: indicatorId,
    weight_basis_points: z.number().int().positive(),
  }).strict()).min(1).max(2),
}).strict();

const scaleKeyField = z.enum([
  "indicator_id",
  "source_set_id",
  "temporal_operator_id",
  "duration_or_weight_pattern_id",
  "vintage_id",
  "peer_set_id",
  "peer_aggregation_id",
  "scale_estimator_id",
  "calibration_period_id",
  "methodology_version",
]);

export const governmentScorecardV6ManifestSchema = z.object({
  schema_version: z.literal(1),
  methodology_version: z.literal("peer-relative-v6"),
  source: z.object({
    source_id: z.literal("ameco"),
    source_owner: z.literal("European Commission, Directorate-General for Economic and Financial Affairs"),
    dataset_code: z.literal("AMECO"),
    vintage: z.literal(sourceSpec.ameco.release),
    observed_through: z.literal(sourceSpec.ameco.observedThrough),
    forecast_from: z.literal(sourceSpec.ameco.forecastFrom),
    forecast_through: z.literal(sourceSpec.ameco.forecastThrough),
  }).strict(),
  countries: z.tuple([z.literal("IT"), z.literal("FR"), z.literal("DE"), z.literal("ES")]),
  peers: z.tuple([z.literal("FR"), z.literal("DE"), z.literal("ES")]),
  peer_aggregator: z.literal("median"),
  formula: z.object({
    formula_id: z.literal("peer_gap_zero_centered_tanh"),
    tanh_divisor: z.literal(2),
    neutral_score: z.literal(50),
    minimum_score: z.literal(0),
    maximum_score: z.literal(100),
    display_rounding: z.literal("half_up"),
  }).strict(),
  scale: z.object({
    scale_estimator_id: z.literal("mad_with_iqr_fallback"),
    mad_multiplier: z.literal(1.4826),
    iqr_divisor: z.literal(1.349),
    quantile_method: z.literal("linear_r7"),
    calibration_period_id: z.literal("1995+"),
    first_score_year: z.literal(1995),
    minimum_rolling_windows: z.literal(20),
    minimum_disjoint_windows: z.literal(6),
  }).strict(),
  scale_key_fields: z.array(scaleKeyField).length(10),
  pillars: z.array(pillarSchema).length(5),
  indicators: z.array(indicatorSchema).length(6),
}).strict();

export type GovernmentScorecardV6Manifest = z.infer<typeof governmentScorecardV6ManifestSchema>;

export const governmentScorecardV6ScaleKeySchema = z.object({
  indicator_id: indicatorId,
  source_set_id: z.string().min(1),
  temporal_operator_id: z.string().min(1),
  duration_or_weight_pattern_id: z.string().min(1),
  vintage_id: z.string().min(1),
  peer_set_id: z.string().min(1),
  peer_aggregation_id: z.string().min(1),
  scale_estimator_id: z.string().min(1),
  calibration_period_id: z.string().min(1),
  methodology_version: z.literal("peer-relative-v6"),
}).strict();

export type GovernmentScorecardV6ScaleKey = z.infer<typeof governmentScorecardV6ScaleKeySchema>;

const countryCode = z.enum(["IT", "FR", "DE", "ES"]);
const finiteNumber = z.number().finite();
const isoDate = z.iso.date();
const httpsUrl = z.url().refine((value) => new URL(value).protocol === "https:", "URL HTTPS atteso");
const sha256 = z.string().regex(/^[0-9a-f]{64}$/);

const endpointSchema = z.object({
  reference_period: z.number().int(),
  value_raw: finiteNumber,
  observed_or_forecast: z.enum(["observed", "forecast"]),
  status_flags_or_null: z.null(),
}).strict();

const frozenObservationSchema = z.object({
  indicator_id: indicatorId,
  geography: countryCode,
  source_id: z.literal("ameco"),
  dataset_code: z.literal("AMECO"),
  series_selectors: z.array(z.string().min(1)).min(1).max(2),
  definition: z.string().min(1),
  unit: z.string().min(1),
  frequency: z.literal("annual"),
  seasonal_adjustment: z.literal("not_applicable"),
  baseline: endpointSchema,
  end: endpointSchema,
}).strict();

const scaleWindowSchema = z.object({
  start_year: z.number().int(),
  end_year: z.number().int(),
  peer_gap: finiteNumber,
}).strict();

const frozenScaleSchema = z.object({
  key: governmentScorecardV6ScaleKeySchema,
  windows: z.array(scaleWindowSchema).min(20),
}).strict();

function issue(context: z.RefinementCtx, message: string, path: PropertyKey[] = []) {
  context.addIssue({ code: "custom", message, path });
}

function disjointWindowCapacity(windows: readonly { start_year: number; end_year: number }[]): number {
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

const COUNTRY_SERIES_CODES = { IT: "ITA", FR: "FRA", DE: "DEU", ES: "ESP" } as const;

export const governmentScorecardV6InputSchema = z.object({
  schema_version: z.literal(1),
  snapshot_version: z.string().regex(/^[a-z0-9-]+-v6-(?:tracer|all)-1$/),
  methodology_version: z.literal("peer-relative-v6"),
  as_of_date: isoDate,
  government: z.object({
    id: z.string().regex(/^[a-z0-9-]+$/),
    name: z.string().min(1),
    start_date: isoDate,
    end_date: isoDate.nullable(),
    status: z.enum(["current", "ended"]),
    source_owner: z.literal("Presidenza della Repubblica"),
    source_url: httpsUrl,
    source_locator: z.string().trim().min(30),
  }).strict(),
  source: z.object({
    source_id: z.literal("ameco"),
    source_owner: z.string().min(1),
    dataset_code: z.literal("AMECO"),
    vintage: z.string().min(1),
    published_at: z.literal(sourceSpec.ameco.releaseDate),
    upstream_updated_at: z.literal(sourceSpec.ameco.releaseDate),
    retrieved_at: z.literal(pageSpec.refreshPolicy.scoreAcquiredAt),
    observed_through: z.number().int(),
    forecast_from: z.number().int(),
    forecast_through: z.number().int(),
    raw_url: z.literal("https://ec.europa.eu/economy_finance/db_indicators/ameco/documents/ameco0_csv.zip"),
    landing_url: z.literal("https://economy-finance.ec.europa.eu/economic-research-and-databases/economic-databases/ameco-database/download-annual-data-set-macro-economic-database-ameco_en"),
    reuse_url: z.literal("https://commission.europa.eu/legal-notice_en"),
    license: z.literal("CC BY 4.0 unless otherwise indicated"),
    raw_sha256: sha256.pipe(z.literal(pageSpec.refreshPolicy.approvedSources[0].raw_sha256)),
    raw_bytes: z.literal(pageSpec.refreshPolicy.approvedSources[0].raw_bytes),
    limitations: z.array(z.string().min(1)).min(1),
  }).strict(),
  window: z.object({
    temporal_operator_id: z.literal("annual_endpoint"),
    reference_date_rule: z.literal("july-1"),
    assigned_years: z.array(z.number().int()).min(1),
    first_year: z.number().int(),
    last_year: z.number().int(),
    baseline_year: z.number().int(),
    end_year: z.number().int(),
    observed_through: z.number().int(),
    duration_or_weight_pattern_id: z.string().min(1),
  }).strict(),
  stability: z.object({
    evidence_scope: z.string().min(1),
    operational_combined_width: finiteNumber.nullable(),
    method_audit_width: finiteNumber.nullable(),
    label: z.enum(["Alta", "Media", "Bassa"]).nullable(),
    source: z.string().min(1),
  }).strict(),
  observations: z.array(frozenObservationSchema).length(24),
  scales: z.array(frozenScaleSchema).length(6),
}).strict().superRefine((input, context) => {
  const manifest = GOVERNMENT_SCORECARD_V6_MANIFEST;
  const expectedGovernment = GOVERNMENT_SCORECARD_V6_CHRONOLOGY.find(
    (government) => government.id === input.government.id,
  );
  if (
    !expectedGovernment
    || input.government.name !== expectedGovernment.name
    || input.government.start_date !== expectedGovernment.start_date
    || input.government.end_date !== expectedGovernment.end_exclusive
    || input.government.status !== expectedGovernment.status
    || input.government.source_owner !== expectedGovernment.source_owner
    || input.government.source_url !== expectedGovernment.source_url
    || input.government.source_locator !== expectedGovernment.source_locator
  ) {
    issue(context, "identita' o cronologia dello snapshot divergente", ["government"]);
  }
  if (input.snapshot_version !== `${input.government.id}-v6-all-1`) {
    issue(context, "versione snapshot incompatibile con il governo", ["snapshot_version"]);
  }
  if (input.as_of_date !== GOVERNMENT_SCORECARD_V6_REGISTRY.asOfDate) {
    issue(context, "as_of_date divergente dal registro congelato", ["as_of_date"]);
  }
  const expectedSource = manifest.source;
  for (const field of ["source_id", "source_owner", "dataset_code", "vintage", "observed_through", "forecast_from", "forecast_through"] as const) {
    if (input.source[field] !== expectedSource[field]) {
      issue(context, `provenienza AMECO divergente: ${field}`, ["source", field]);
    }
  }
  if (input.source.forecast_from !== input.source.observed_through + 1 || input.source.forecast_through < input.source.forecast_from) {
    issue(context, "confine osservato/forecast incoerente", ["source"]);
  }
  const institutionalEnd = input.government.end_date ?? input.as_of_date;
  const mandateDurationDays = durationDaysV6(input.government.start_date, institutionalEnd);
  if (mandateDurationDays < 365) {
    issue(context, "durata istituzionale inferiore a 365 giorni", ["as_of_date"]);
  }
  const expectedWindow = expectedGovernment
    ? deriveAnnualStatisticalWindowV6(expectedGovernment, input.source.observed_through, input.as_of_date)
    : null;
  if (
    !expectedWindow
    || expectedWindow.first_year === null
    || expectedWindow.last_year === null
    || expectedWindow.baseline_year === null
    || expectedWindow.end_year === null
    || input.window.reference_date_rule !== expectedWindow.reference_date_rule
    || JSON.stringify(input.window.assigned_years) !== JSON.stringify(expectedWindow.assigned_years)
    || input.window.first_year !== expectedWindow.first_year
    || input.window.last_year !== expectedWindow.last_year
    || input.window.baseline_year !== expectedWindow.baseline_year
    || input.window.end_year !== expectedWindow.end_year
    || input.window.observed_through !== expectedWindow.observed_through
  ) {
    issue(context, "finestra annuale divergente dalla cronologia", ["window"]);
  }
  const duration = input.window.end_year - input.window.baseline_year;
  if (duration <= 0 || input.window.duration_or_weight_pattern_id !== `years:${duration}`) {
    issue(context, "durata statistica incoerente", ["window"]);
  }
  if (input.window.end_year > input.source.observed_through) {
    issue(context, "forecast nel periodo di voto", ["window", "end_year"]);
  } else if (input.government.status === "current" && input.window.end_year < input.source.observed_through) {
    issue(context, "ultimo endpoint comune osservato obbligatorio", ["window", "end_year"]);
  }

  const observations = new Map<string, typeof input.observations[number]>();
  input.observations.forEach((observation, index) => {
    const key = `${observation.indicator_id}:${observation.geography}`;
    if (observations.has(key)) {
      issue(context, "osservazione duplicata", ["observations", index]);
    }
    observations.set(key, observation);
  });
  manifest.indicators.forEach((indicator) => {
    manifest.countries.forEach((geography) => {
      const observation = observations.get(`${indicator.id}:${geography}`);
      if (!observation) {
        issue(context, "osservazione obbligatoria mancante", ["observations"]);
        return;
      }
      const expectedSelectors = indicator.source_series.map((series) =>
        series.selector_template.replace("{country}", COUNTRY_SERIES_CODES[geography]));
      if (JSON.stringify(observation.series_selectors) !== JSON.stringify(expectedSelectors)) {
        issue(context, "selettori AMECO incompatibili", ["observations"]);
      }
      if (observation.definition !== indicator.definition || observation.unit !== indicator.unit) {
        issue(context, "unità o definizione incompatibile", ["observations"]);
      }
      if (observation.baseline.reference_period !== input.window.baseline_year || observation.end.reference_period !== input.window.end_year) {
        issue(context, "periodo osservazione incoerente", ["observations"]);
      }
      if (observation.baseline.observed_or_forecast !== "observed" || observation.end.observed_or_forecast !== "observed") {
        issue(context, "forecast non ammesso", ["observations"]);
      }
      if (indicator.transformation === "log_change" && (observation.baseline.value_raw <= 0 || observation.end.value_raw <= 0)) {
        issue(context, "livello non positivo per log-change", ["observations"]);
      }
    });
  });

  const expectedScaleKeys = new Set<string>();
  const actualScaleKeys = new Set<string>();
  input.scales.forEach((scale, scaleIndex) => {
    const serialized = JSON.stringify(scale.key);
    if (actualScaleKeys.has(serialized)) {
      issue(context, "chiave scala duplicata", ["scales", scaleIndex, "key"]);
    }
    actualScaleKeys.add(serialized);
    const starts = new Set<number>();
    scale.windows.forEach((window, windowIndex) => {
      if (starts.has(window.start_year)) {
        issue(context, "finestra scala duplicata", ["scales", scaleIndex, "windows", windowIndex]);
      }
      starts.add(window.start_year);
      if (
        window.start_year < manifest.scale.first_score_year
        || window.end_year - window.start_year !== duration
        || window.end_year > input.source.observed_through
      ) {
        issue(context, "finestra scala incompatibile", ["scales", scaleIndex, "windows", windowIndex]);
      }
    });
    if (disjointWindowCapacity(scale.windows) < manifest.scale.minimum_disjoint_windows) {
      issue(context, "capacità disgiunta insufficiente", ["scales", scaleIndex, "windows"]);
    }
  });
  manifest.indicators.forEach((indicator) => {
    const expected = {
      indicator_id: indicator.id,
      source_set_id: `ameco:${input.source.vintage}`,
      temporal_operator_id: input.window.temporal_operator_id,
      duration_or_weight_pattern_id: input.window.duration_or_weight_pattern_id,
      vintage_id: input.source.vintage,
      peer_set_id: manifest.peers.join("|"),
      peer_aggregation_id: manifest.peer_aggregator,
      scale_estimator_id: manifest.scale.scale_estimator_id,
      calibration_period_id: manifest.scale.calibration_period_id,
      methodology_version: manifest.methodology_version,
    };
    expectedScaleKeys.add(JSON.stringify(expected));
  });
  if (actualScaleKeys.size !== expectedScaleKeys.size || [...expectedScaleKeys].some((key) => !actualScaleKeys.has(key))) {
    issue(context, "insieme delle scale incompleto o incompatibile", ["scales"]);
  }
});

export type GovernmentScorecardV6Input = z.infer<typeof governmentScorecardV6InputSchema>;

export function parseGovernmentScorecardV6Input(input: unknown): GovernmentScorecardV6Input {
  const result = governmentScorecardV6InputSchema.safeParse(input);
  if (!result.success) {
    throw new GovernmentScorecardV6ContractError("input AMECO v6 non valido", { cause: result.error });
  }
  return result.data;
}

export class GovernmentScorecardV6ContractError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "GovernmentScorecardV6ContractError";
  }
}

export function parseGovernmentScorecardV6Manifest(input: unknown): GovernmentScorecardV6Manifest {
  const result = governmentScorecardV6ManifestSchema.safeParse(input);
  if (!result.success) {
    throw new GovernmentScorecardV6ContractError("manifest v6 non valido", { cause: result.error });
  }
  if (JSON.stringify(result.data) !== JSON.stringify(canonicalManifest)) {
    throw new GovernmentScorecardV6ContractError("manifest v6 divergente dalla versione metodologica");
  }
  return result.data;
}

export const GOVERNMENT_SCORECARD_V6_MANIFEST = parseGovernmentScorecardV6Manifest(canonicalManifest);
