import { createHash } from "node:crypto";

import canonicalStressManifest from "../../scripts/etl/specs/government-scorecard-sensitivity.json";
import annualSnapshot from "@/data/generated/government-scorecard.json";
import { GOVERNMENT_SCORECARD_V6_MANIFEST } from "@/lib/data/government-scorecard-contract";
import {
  GOVERNMENT_SCORECARD_V6_CHRONOLOGY,
  GOVERNMENT_SCORECARD_V6_REGISTRY,
} from "@/lib/government-scorecard-chronology";
import { calculatePeerScoreV6, calculateRobustScaleV6, linearR7Quantile } from "@/lib/government-scorecard";
import {
  calculateProportionalDaySensitivityV6,
  hashGovernmentScorecardV6DayWeights,
  type GovernmentScorecardV6DayWeight,
} from "@/lib/government-scorecard-temporal";

type CountryCode = "IT" | "FR" | "DE" | "ES";
type PeerAggregation = "median" | "mean";
type ScaleEstimator = "mad_with_iqr_fallback" | "iqr_r7";
type Normalizer = "tanh" | "normal" | "ecdf";
type PillarAggregation = "arithmetic" | "geometric";
type Stability = "Alta" | "Media" | "Bassa";
type IndicatorId = (typeof GOVERNMENT_SCORECARD_V6_MANIFEST.indicators)[number]["id"];
type PillarId = (typeof GOVERNMENT_SCORECARD_V6_MANIFEST.pillars)[number]["id"];

type RawIndicator = (typeof annualSnapshot.indicators)[number];

type StressAxisEntry<TValue> = {
  id: string;
  order: number;
  value: TValue;
};

type ScaleNormalizerPair = {
  scale_estimator: ScaleEstimator;
  normalizer: Normalizer;
};

export type GovernmentScorecardV6StressManifest = {
  manifest_version: 1;
  methodology_version: "peer-relative-v6";
  required_operational_axes: readonly ["temporal", "peer", "vintage"];
  axes: {
    scale_normalizer_pairs: readonly StressAxisEntry<ScaleNormalizerPair>[];
    calibration_periods: readonly StressAxisEntry<1995 | 2000>[];
    peer_aggregations: readonly StressAxisEntry<PeerAggregation>[];
    public_finance_splits: readonly StressAxisEntry<{ debt_weight: 0.4 | 0.5 | 0.6 }>[];
    pillar_aggregations: readonly StressAxisEntry<PillarAggregation>[];
    pillar_weight_multipliers: readonly StressAxisEntry<0.8 | 1 | 1.2>[];
    coupled_data_variants: readonly StressAxisEntry<string>[];
  };
  thresholds: {
    minimum_rolling_windows: 20;
    minimum_disjoint_windows: 6;
    temporal_badge_width: 10;
    peer_badge_width: 10;
    method_badge_width: 20;
    stability_high_max_width: 10;
    stability_medium_max_width: 20;
  };
  rejected_configurations: readonly { id: string; reason: string }[];
  separate_diagnostics: readonly [
    "scale_jackknife_width",
    "scale_leave_block_width",
    "expanded_peer_width",
    "drop_one_indicator_width",
    "drop_one_pillar_width",
    "indicator_correlation_matrix",
  ];
  expected_method_configurations_per_government: 29_160;
  expected_coupled_configurations: 233_280;
};

const BASE_DATA_VARIANT = "baseline_+0_end_+0|all|median";

export const GOVERNMENT_SCORECARD_V6_STRESS_MANIFEST =
  canonicalStressManifest as unknown as GovernmentScorecardV6StressManifest;

const COUNTRY_IDS = { IT: "italy", FR: "france", DE: "germany", ES: "spain" } as const;
const Z_CAP = 3;

type WeightVector = {
  raw: readonly number[];
  normalized: readonly number[];
  id: string;
};

type VariantIndicator = {
  id: IndicatorId;
  pillar_id: PillarId;
  peer_gap: number;
  scores?: Record<Normalizer, number>;
  scale?: number;
  scale_gate?: ScaleGate;
  reference_gaps?: readonly number[];
};

type VariantResult = {
  government_id: string;
  baseline_year: number;
  end_year: number;
  indicators: readonly VariantIndicator[];
};

type ScaleGate = {
  indicator_id: IndicatorId;
  rolling_count: number;
  disjoint_capacity: number;
  passes: boolean;
  scale_key: string;
};

type AnnualVariantKey = {
  endpoint: string;
  peer_label: string;
  peer_aggregation: PeerAggregation;
};

type AnnualVariant = {
  key: AnnualVariantKey;
  id: string;
  result: VariantResult;
};

type StressFailure = {
  axis: string;
  configuration_id: string;
  reason: string;
};

type ScoreSummary = {
  minimum: number;
  maximum: number;
  width: number;
};

export type GovernmentScorecardV6SensitivityOutput = {
  base_score: number;
  operational_min: number;
  operational_max: number;
  operational_width: number;
  temporal_width: number;
  peer_width: number;
  vintage_delta: number | null;
  method_audit_min: number;
  method_audit_max: number;
  method_audit_width: number;
  dominant_assumption: string;
  stability: Stability;
  sensitivity_complete: boolean;
  sensitivity_badges: readonly string[];
  comparison_compatible: boolean;
  comparison_incompatible_reason: string | null;
  missing_axes: readonly string[];
  stress_failures: readonly StressFailure[];
  diagnostics: {
    scale_jackknife_width: { width: number; complete: true; reason: null };
    scale_leave_block_width: { width: null; complete: false; reason: string };
    expanded_peer_width: { width: null; complete: false; reason: string };
    drop_one_indicator_width: number;
    drop_one_pillar_width: number;
    indicator_correlation_matrix: Record<string, Record<string, number>>;
  };
  method_audit: {
    configurations_evaluated: number;
    complete: boolean;
    missing_axes: readonly string[];
    base_reconciled: boolean;
    duplicate_configuration_count: number;
    invalid_configurations: readonly { id: string; reason: string }[];
    separate_diagnostics: readonly string[];
  };
  operational_audit: {
    temporal: ScoreSummary & {
      configurations_evaluated: number;
      day_weight_hash: string | null;
      day_weights: readonly GovernmentScorecardV6DayWeight[];
    };
    peer: ScoreSummary & { configurations_evaluated: number };
    vintage: { delta: number | null; complete: boolean; reason: string | null };
  };
};

type SensitivityClassificationInput = {
  base_score: number;
  operational_width: number;
  temporal_width: number;
  peer_width: number;
  method_audit_width: number;
  sensitivity_complete: boolean;
  missing_axes: readonly string[];
  operational_min: number;
  operational_max: number;
};

const rawIndicatorById = new Map(annualSnapshot.indicators.map((indicator) => [indicator.id, indicator]));

function finite(value: number, label: string): number {
  if (!Number.isFinite(value)) throw new RangeError(`${label} deve essere finito`);
  return value;
}

function mean(values: readonly number[]): number {
  if (values.length === 0) throw new RangeError("media senza valori");
  return values.reduce((sum, value) => sum + finite(value, "valore"), 0) / values.length;
}

function median(values: readonly number[]): number {
  if (values.length === 0) throw new RangeError("mediana senza valori");
  const ordered = values.map((value) => finite(value, "valore")).toSorted((left, right) => left - right);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 === 0 ? (ordered[middle - 1] + ordered[middle]) / 2 : ordered[middle];
}

function scoreSummary(values: readonly number[]): ScoreSummary {
  const checked = values.map((value) => finite(value, "punteggio"));
  if (checked.length === 0) throw new RangeError("summary sensitivity senza punteggi");
  const ordered = checked.toSorted((left, right) => left - right);
  return {
    minimum: ordered[0],
    maximum: ordered[ordered.length - 1],
    width: ordered[ordered.length - 1] - ordered[0],
  };
}

function assertUniqueOrderedAxis(axisName: string, axis: readonly StressAxisEntry<unknown>[]) {
  if (!Array.isArray(axis) || axis.length === 0) throw new TypeError(`asse mancante: ${axisName}`);
  const ids = new Set<string>();
  const orders = new Set<number>();
  axis.forEach((entry, index) => {
    if (!entry || typeof entry.id !== "string" || entry.id.length === 0) {
      throw new TypeError(`id asse mancante: ${axisName}`);
    }
    if (ids.has(entry.id)) throw new TypeError(`id asse duplicato: ${axisName}:${entry.id}`);
    if (orders.has(entry.order)) throw new TypeError(`ordine asse duplicato: ${axisName}:${entry.order}`);
    if (entry.order !== index) throw new TypeError(`ordine non canonico: ${axisName}:${entry.id}`);
    ids.add(entry.id);
    orders.add(entry.order);
  });
}

export function validateGovernmentScorecardV6StressManifest(input: GovernmentScorecardV6StressManifest) {
  if (!input || input.manifest_version !== 1 || input.methodology_version !== "peer-relative-v6") {
    throw new TypeError("manifest stress v6 mancante o incompatibile");
  }
  const axes = input.axes;
  if (input.required_operational_axes.join("|") !== "temporal|peer|vintage") {
    throw new TypeError("assi operativi obbligatori mancanti o fuori ordine");
  }
  const expectedAxes = [
    "scale_normalizer_pairs",
    "calibration_periods",
    "peer_aggregations",
    "public_finance_splits",
    "pillar_aggregations",
    "pillar_weight_multipliers",
    "coupled_data_variants",
  ] as const;
  for (const axisName of expectedAxes) {
    if (!Object.hasOwn(axes, axisName)) throw new TypeError(`asse mancante: ${axisName}`);
    assertUniqueOrderedAxis(axisName, axes[axisName]);
  }
  const expectedMethodAxes = {
    scale_normalizer_pairs: [
      ["mad_with_iqr_fallback+tanh", { scale_estimator: "mad_with_iqr_fallback", normalizer: "tanh" }],
      ["mad_with_iqr_fallback+normal", { scale_estimator: "mad_with_iqr_fallback", normalizer: "normal" }],
      ["mad_with_iqr_fallback+ecdf", { scale_estimator: "mad_with_iqr_fallback", normalizer: "ecdf" }],
      ["iqr_r7+tanh", { scale_estimator: "iqr_r7", normalizer: "tanh" }],
      ["iqr_r7+normal", { scale_estimator: "iqr_r7", normalizer: "normal" }],
    ],
    calibration_periods: [["1995+", 1995], ["2000+", 2000]],
    peer_aggregations: [["median", "median"], ["mean", "mean"]],
    public_finance_splits: [
      ["debt_50_primary_50", { debt_weight: 0.5 }],
      ["debt_60_primary_40", { debt_weight: 0.6 }],
      ["debt_40_primary_60", { debt_weight: 0.4 }],
    ],
    pillar_aggregations: [["arithmetic", "arithmetic"], ["geometric", "geometric"]],
    pillar_weight_multipliers: [["0.8", 0.8], ["1.0", 1], ["1.2", 1.2]],
  } as const;
  for (const [axisName, expected] of Object.entries(expectedMethodAxes)) {
    const actual = axes[axisName as keyof typeof expectedMethodAxes]
      .map((entry) => [entry.id, entry.value]);
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      throw new TypeError(`asse scala o normalizzatore divergente dal manifest: ${axisName}`);
    }
  }
  const count = axes.scale_normalizer_pairs.length
    * axes.calibration_periods.length
    * axes.peer_aggregations.length
    * axes.public_finance_splits.length
    * axes.pillar_aggregations.length
    * axes.pillar_weight_multipliers.length ** 5;
  if (count !== input.expected_method_configurations_per_government) {
    throw new TypeError("cardinalita' method audit divergente dal manifest");
  }
  if (axes.scale_normalizer_pairs.some((entry) => entry.id === "iqr_r7+ecdf")) {
    throw new TypeError("configurazione IQR+ECDF non ammessa");
  }
  if (axes.calibration_periods.some((entry) => entry.id === "2005+")) {
    throw new TypeError("calibrazione 2005+ non ammessa");
  }
  if (
    axes.coupled_data_variants.length
      * axes.scale_normalizer_pairs.length
      * axes.calibration_periods.length
      * axes.public_finance_splits.length
      * axes.pillar_aggregations.length
      * axes.pillar_weight_multipliers.length ** 5
    !== input.expected_coupled_configurations
  ) {
    throw new TypeError("cardinalita' coupled audit divergente dal manifest");
  }
  const expectedCoupledVariants = [0, 1].flatMap((shift) =>
    ["all", "without_FR", "without_DE", "without_ES"].flatMap((peerLabel) =>
      (["median", "mean"] as const).map(
        (aggregation) => `baseline_${shift >= 0 ? "+" : ""}${shift}_end_${shift >= 0 ? "+" : ""}${shift}|${peerLabel}|${aggregation}`,
      )));
  const actualCoupledVariants = axes.coupled_data_variants.map((entry) => entry.id);
  if (
    actualCoupledVariants.length !== expectedCoupledVariants.length
    || expectedCoupledVariants.some((id, index) => actualCoupledVariants[index] !== id)
    || axes.coupled_data_variants.some((entry) => entry.id !== entry.value)
  ) {
    throw new TypeError("configurazioni dati coupled mancanti o divergenti");
  }
  const expectedThresholds = {
    minimum_rolling_windows: 20,
    minimum_disjoint_windows: 6,
    temporal_badge_width: 10,
    peer_badge_width: 10,
    method_badge_width: 20,
    stability_high_max_width: 10,
    stability_medium_max_width: 20,
  };
  if (JSON.stringify(input.thresholds) !== JSON.stringify(expectedThresholds)) {
    throw new TypeError("soglie stress divergenti dal manifest");
  }
  const expectedDiagnostics = [
    "scale_jackknife_width",
    "scale_leave_block_width",
    "expanded_peer_width",
    "drop_one_indicator_width",
    "drop_one_pillar_width",
    "indicator_correlation_matrix",
  ];
  if (
    input.separate_diagnostics.length !== expectedDiagnostics.length
    || new Set(input.separate_diagnostics).size !== expectedDiagnostics.length
    || expectedDiagnostics.some((id, index) => input.separate_diagnostics[index] !== id)
  ) {
    throw new TypeError("diagnostiche separate mancanti, duplicate o fuori ordine");
  }
  return input;
}

validateGovernmentScorecardV6StressManifest(GOVERNMENT_SCORECARD_V6_STRESS_MANIFEST);

function observedThrough(): number {
  return annualSnapshot.sources.ameco.observedThrough;
}

function commonObservedThrough(): number {
  for (let year = observedThrough(); year >= 1960; year -= 1) {
    const complete = GOVERNMENT_SCORECARD_V6_MANIFEST.indicators.every((indicator) =>
      GOVERNMENT_SCORECARD_V6_MANIFEST.countries.every((geography) =>
        rawValue(indicator.id, geography, year) !== null));
    if (complete) return year;
  }
  throw new Error("nessun endpoint AMECO comune osservato");
}

const COMMON_OBSERVED_THROUGH = commonObservedThrough();

function rawValue(indicatorId: IndicatorId, geography: CountryCode, year: number): number | null {
  const raw = rawIndicatorById.get(indicatorId) as RawIndicator | undefined;
  const series = raw?.countries[COUNTRY_IDS[geography]];
  const point = series?.find((candidate) => candidate.year === year);
  return point?.value ?? null;
}

function transformedChange(indicatorId: IndicatorId, geography: CountryCode, baselineYear: number, endYear: number): number | null {
  const indicator = GOVERNMENT_SCORECARD_V6_MANIFEST.indicators.find((candidate) => candidate.id === indicatorId);
  if (!indicator) return null;
  const baseline = rawValue(indicatorId, geography, baselineYear);
  const end = rawValue(indicatorId, geography, endYear);
  if (baseline === null || end === null) return null;
  const rawChange = indicator.transformation === "log_change"
    ? baseline > 0 && end > 0 ? 100 * (Math.log(end) - Math.log(baseline)) : null
    : end - baseline;
  if (rawChange === null) return null;
  return indicator.direction === "higher" ? rawChange : -rawChange;
}

function aggregatePeer(values: readonly number[], peerAggregation: PeerAggregation): number {
  return peerAggregation === "median" ? median(values) : mean(values);
}

function peerSet(peerLabel: string): readonly CountryCode[] {
  const peers = GOVERNMENT_SCORECARD_V6_MANIFEST.peers;
  if (peerLabel === "all") return peers;
  const omitted = peerLabel.replace(/^without_/, "");
  if (omitted === peerLabel) throw new RangeError(`variante peer non supportata: ${peerLabel}`);
  const selected = peers.filter((peer) => peer !== omitted);
  if (selected.length !== peers.length - 1) throw new RangeError(`peer omesso sconosciuto: ${omitted}`);
  return selected;
}

function calculateWindowResult(
  governmentId: string,
  baselineYear: number,
  endYear: number,
  peers: readonly CountryCode[] = GOVERNMENT_SCORECARD_V6_MANIFEST.peers,
  peerAggregation: PeerAggregation = "median",
): VariantResult {
  if (endYear <= baselineYear || endYear > COMMON_OBSERVED_THROUGH) {
    throw new RangeError("finestra endpoint non valida");
  }
  const indicators = GOVERNMENT_SCORECARD_V6_MANIFEST.indicators.map((indicator) => {
    const italy = transformedChange(indicator.id, "IT", baselineYear, endYear);
    const peerValues = peers.map((geography) =>
      transformedChange(indicator.id, geography, baselineYear, endYear));
    if (italy === null || peerValues.some((value) => value === null)) {
      throw new RangeError(`input obbligatorio mancante per ${indicator.id}`);
    }
    return {
      id: indicator.id,
      pillar_id: indicator.pillar_id,
      peer_gap: italy - aggregatePeer(peerValues as number[], peerAggregation),
    };
  });
  return { government_id: governmentId, baseline_year: baselineYear, end_year: endYear, indicators };
}

function referenceScale(values: readonly number[], estimator: ScaleEstimator): number {
  if (estimator === "mad_with_iqr_fallback") return calculateRobustScaleV6(values);
  const checked = values.map((value) => finite(value, "gap di riferimento"));
  const scale = (linearR7Quantile(checked, 0.75) - linearR7Quantile(checked, 0.25)) / 1.349;
  const epsilon = 1e-12 * Math.max(1, ...checked.map((value) => Math.abs(value)));
  if (scale <= epsilon) throw new RangeError("dispersione nulla dopo IQR R-7");
  return scale;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function erf(value: number): number {
  const sign = value < 0 ? -1 : 1;
  const x = Math.abs(value);
  const t = 1 / (1 + 0.3275911 * x);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return sign * y;
}

function normalCdf(value: number): number {
  return 0.5 * (1 + erf(value / Math.SQRT2));
}

function empiricalPosition(value: number, values: readonly number[]): number {
  if (values.length === 0) throw new RangeError("ECDF senza osservazioni");
  const below = values.filter((candidate) => candidate < value).length;
  const equal = values.filter((candidate) => candidate === value).length;
  return 100 * (below + 0.5 * equal) / values.length;
}

function zeroCenteredScores(value: number, referenceGaps: readonly number[], scaleEstimator: ScaleEstimator): Record<Normalizer, number> {
  const scale = referenceScale(referenceGaps, scaleEstimator);
  const z = value / scale;
  const symmetric = [...referenceGaps, ...referenceGaps.map((gap) => -gap)];
  return {
    tanh: calculatePeerScoreV6(value, scale),
    normal: 100 * normalCdf(clamp(z, -Z_CAP, Z_CAP)),
    ecdf: empiricalPosition(value, symmetric),
  };
}

function disjointWindowCapacity(windows: readonly { start_year: number; end_year: number }[]): number {
  let capacity = 0;
  let previousEnd: number | undefined;
  for (const window of windows.toSorted((left, right) => left.end_year - right.end_year)) {
    if (window.start_year >= window.end_year) throw new RangeError("finestra scala non positiva");
    if (previousEnd === undefined || window.start_year >= previousEnd) {
      capacity += 1;
      previousEnd = window.end_year;
    }
  }
  return capacity;
}

function scaleKey(
  indicatorId: IndicatorId,
  temporalOperatorId: string,
  durationOrWeightPatternId: string,
  peers: readonly CountryCode[],
  peerAggregation: PeerAggregation,
  scaleEstimator: ScaleEstimator,
  calibrationStart: number,
): string {
  return JSON.stringify([
    indicatorId,
    `ameco:${GOVERNMENT_SCORECARD_V6_MANIFEST.source.vintage}`,
    temporalOperatorId,
    durationOrWeightPatternId,
    GOVERNMENT_SCORECARD_V6_MANIFEST.source.vintage,
    peers.join("|"),
    peerAggregation,
    scaleEstimator,
    `${calibrationStart}+`,
    GOVERNMENT_SCORECARD_V6_MANIFEST.methodology_version,
  ]);
}

function commonScaleResult(
  result: VariantResult,
  peers: readonly CountryCode[],
  peerAggregation: PeerAggregation,
  scaleEstimator: ScaleEstimator,
  calibrationStart: number,
): VariantResult {
  const duration = result.end_year - result.baseline_year;
  const indicators = result.indicators.map((indicator) => {
    const windows: { start_year: number; end_year: number; peer_gap: number }[] = [];
    for (let startYear = calibrationStart; startYear + duration <= COMMON_OBSERVED_THROUGH; startYear += 1) {
      const finish = startYear + duration;
      const candidate = calculateWindowResult(result.government_id, startYear, finish, peers, peerAggregation)
        .indicators.find((item) => item.id === indicator.id);
      if (candidate) windows.push({ start_year: startYear, end_year: finish, peer_gap: candidate.peer_gap });
    }
    const disjointCapacity = disjointWindowCapacity(windows);
    const passes = windows.length >= GOVERNMENT_SCORECARD_V6_STRESS_MANIFEST.thresholds.minimum_rolling_windows
      && disjointCapacity >= GOVERNMENT_SCORECARD_V6_STRESS_MANIFEST.thresholds.minimum_disjoint_windows;
    if (!passes) throw new RangeError(`scala comune insufficiente per ${indicator.id}`);
    const referenceGaps = windows.map((window) => window.peer_gap);
    return {
      ...indicator,
      scores: zeroCenteredScores(indicator.peer_gap, referenceGaps, scaleEstimator),
      scale: referenceScale(referenceGaps, scaleEstimator),
      reference_gaps: referenceGaps,
      scale_gate: {
        indicator_id: indicator.id,
        rolling_count: windows.length,
        disjoint_capacity: disjointCapacity,
        passes,
        scale_key: scaleKey(indicator.id, "annual_endpoint", `years:${duration}`, peers, peerAggregation, scaleEstimator, calibrationStart),
      },
    };
  });
  return { ...result, indicators };
}

function parseDate(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function daysBetween(start: Date, end: Date): number {
  return (end.getTime() - start.getTime()) / 86_400_000;
}

export function annualOverlapWeightsV6(startDate: string, endDate: string) {
  const start = parseDate(startDate);
  const end = parseDate(endDate);
  if (end <= start) throw new RangeError("lo stress temporale richiede un intervallo positivo");
  const weights: { year: number; weight: number }[] = [];
  for (let year = start.getUTCFullYear(); year <= end.getUTCFullYear(); year += 1) {
    const yearStart = new Date(Date.UTC(year, 0, 1));
    const yearEnd = new Date(Date.UTC(year + 1, 0, 1));
    const overlapStart = start > yearStart ? start : yearStart;
    const overlapEnd = end < yearEnd ? end : yearEnd;
    const overlapDays = Math.max(0, daysBetween(overlapStart, overlapEnd));
    if (overlapDays > 0) {
      weights.push({ year, weight: overlapDays / daysBetween(yearStart, yearEnd) });
    }
  }
  return weights;
}

export function weightPatternIdV6(weights: readonly { year: number; weight: number }[]): string {
  const values = weights
    .toSorted((left, right) => left.year - right.year)
    .map((item) => finite(item.weight, "peso temporale"));
  const payload = JSON.stringify(values);
  return `sha256:${createHash("sha256").update(payload, "ascii").digest("hex")}`;
}

function fullDayWeightsV6(startDate: string, endDate: string) {
  const startYear = parseDate(startDate).getUTCFullYear();
  const endYear = parseDate(endDate).getUTCFullYear();
  return calculateProportionalDaySensitivityV6({
    start_date: startDate,
    end_exclusive: endDate,
    annual_increments: Array.from({ length: endYear - startYear + 1 }, (_, index) => ({
      year: startYear + index,
      value: 0,
    })),
  }).weights;
}

function weightedChange(indicatorId: IndicatorId, geography: CountryCode, weights: readonly { year: number; weight: number }[]): number | null {
  let total = 0;
  for (const { year, weight } of weights.toSorted((left, right) => left.year - right.year)) {
    const increment = transformedChange(indicatorId, geography, year - 1, year);
    if (increment === null) return null;
    total += weight * increment;
  }
  return total;
}

function calculateWeightedResult(governmentId: string, weights: readonly { year: number; weight: number }[], peers: readonly CountryCode[], peerAggregation: PeerAggregation): VariantResult {
  const years = weights.map((item) => item.year);
  const indicators = GOVERNMENT_SCORECARD_V6_MANIFEST.indicators.map((indicator) => {
    const italy = weightedChange(indicator.id, "IT", weights);
    const peerValues = peers.map((geography) => weightedChange(indicator.id, geography, weights));
    if (italy === null || peerValues.some((value) => value === null)) {
      throw new RangeError(`input weighted obbligatorio mancante per ${indicator.id}`);
    }
    return {
      id: indicator.id,
      pillar_id: indicator.pillar_id,
      peer_gap: italy - aggregatePeer(peerValues as number[], peerAggregation),
    };
  });
  return { government_id: governmentId, baseline_year: Math.min(...years) - 1, end_year: Math.max(...years), indicators };
}

function commonWeightedScaleResult(result: VariantResult, weights: readonly { year: number; weight: number }[], peers: readonly CountryCode[], peerAggregation: PeerAggregation): VariantResult {
  const pattern = weights.toSorted((left, right) => left.year - right.year).map((item) => item.weight);
  const patternId = weightPatternIdV6(weights);
  const firstIncrementYear = GOVERNMENT_SCORECARD_V6_MANIFEST.scale.first_score_year + 1;
  const indicators = result.indicators.map((indicator) => {
    const windows: { start_year: number; end_year: number; peer_gap: number }[] = [];
    for (let candidateStart = firstIncrementYear; candidateStart + pattern.length - 1 <= COMMON_OBSERVED_THROUGH; candidateStart += 1) {
      const candidateWeights = pattern.map((weight, index) => ({ year: candidateStart + index, weight }));
      const candidate = calculateWeightedResult(result.government_id, candidateWeights, peers, peerAggregation)
        .indicators.find((item) => item.id === indicator.id);
      if (candidate) {
        windows.push({
          start_year: candidateWeights[0].year - 1,
          end_year: candidateWeights[candidateWeights.length - 1].year,
          peer_gap: candidate.peer_gap,
        });
      }
    }
    const disjointCapacity = disjointWindowCapacity(windows);
    const passes = windows.length >= GOVERNMENT_SCORECARD_V6_STRESS_MANIFEST.thresholds.minimum_rolling_windows
      && disjointCapacity >= GOVERNMENT_SCORECARD_V6_STRESS_MANIFEST.thresholds.minimum_disjoint_windows;
    if (!passes) throw new RangeError(`scala weighted insufficiente per ${indicator.id}`);
    const referenceGaps = windows.map((window) => window.peer_gap);
    return {
      ...indicator,
      scores: zeroCenteredScores(indicator.peer_gap, referenceGaps, "mad_with_iqr_fallback"),
      scale: referenceScale(referenceGaps, "mad_with_iqr_fallback"),
      reference_gaps: referenceGaps,
      scale_gate: {
        indicator_id: indicator.id,
        rolling_count: windows.length,
        disjoint_capacity: disjointCapacity,
        passes,
        scale_key: scaleKey(indicator.id, "weighted_annual_increment", patternId, peers, peerAggregation, "mad_with_iqr_fallback", firstIncrementYear - 1),
      },
    };
  });
  return { ...result, indicators };
}

function pillarScores(result: VariantResult, normalizer: Normalizer, financeDebtWeight: number): Record<PillarId, number> {
  const grouped = new Map<PillarId, { id: IndicatorId; score: number }[]>();
  for (const indicator of result.indicators) {
    if (!indicator.scores) throw new RangeError("risultato non normalizzato");
    const values = grouped.get(indicator.pillar_id) ?? [];
    values.push({ id: indicator.id, score: indicator.scores[normalizer] });
    grouped.set(indicator.pillar_id, values);
  }
  const output = {} as Record<PillarId, number>;
  for (const pillar of GOVERNMENT_SCORECARD_V6_MANIFEST.pillars) {
    const values = grouped.get(pillar.id) ?? [];
    if (pillar.id !== "public_finance") {
      if (values.length !== 1) throw new RangeError(`pilastro inatteso: ${pillar.id}`);
      output[pillar.id] = values[0].score;
      continue;
    }
    const byId = new Map(values.map((value) => [value.id, value.score]));
    const debt = byId.get("debt_ratio");
    const primary = byId.get("primary_balance");
    if (debt === undefined || primary === undefined || values.length !== 2) {
      throw new RangeError("split finanza pubblica incompleto");
    }
    output[pillar.id] = financeDebtWeight * debt + (1 - financeDebtWeight) * primary;
  }
  return output;
}

function normalizedWeightVectors(): readonly WeightVector[] {
  const multipliers = GOVERNMENT_SCORECARD_V6_STRESS_MANIFEST.axes.pillar_weight_multipliers.map((entry) => entry.value);
  const output: WeightVector[] = [];
  const visit = (raw: number[]) => {
    if (raw.length === GOVERNMENT_SCORECARD_V6_MANIFEST.pillars.length) {
      const total = raw.reduce((sum, value) => sum + value, 0);
      const normalized = raw.map((value) => value / total);
      output.push({ raw, normalized, id: raw.map((value) => value.toFixed(1)).join("|") });
      return;
    }
    for (const multiplier of multipliers) visit([...raw, multiplier]);
  };
  visit([]);
  return output;
}

const WEIGHT_VECTORS = normalizedWeightVectors();
const PILLAR_ORDER = GOVERNMENT_SCORECARD_V6_MANIFEST.pillars.map((pillar) => pillar.id).toSorted();

function aggregatePillars(pillars: Record<PillarId, number>, weights: readonly number[], aggregation: PillarAggregation): number {
  if (weights.length !== PILLAR_ORDER.length) throw new RangeError("pesi pilastro incompleti");
  if (Math.abs(weights.reduce((sum, value) => sum + value, 0) - 1) > 1e-12) {
    throw new RangeError("pesi pilastro non normalizzati");
  }
  if (aggregation === "arithmetic") {
    return PILLAR_ORDER.reduce((sum, pillarId, index) => sum + weights[index] * pillars[pillarId], 0);
  }
  return 100 * Math.exp(PILLAR_ORDER.reduce(
    (sum, pillarId, index) => sum + weights[index] * Math.log(Math.max(pillars[pillarId], 0.01) / 100),
    0,
  ));
}

function scoreScaledVariant(
  scaled: VariantResult,
  normalizer: Normalizer = "tanh",
  financeDebtWeight = 0.5,
  aggregation: PillarAggregation = "arithmetic",
  weights: readonly number[] = PILLAR_ORDER.map(() => 1 / PILLAR_ORDER.length),
): number {
  return aggregatePillars(pillarScores(scaled, normalizer, financeDebtWeight), weights, aggregation);
}

function annualVariants(governmentId: string, baselineYear: number, endYear: number, peerAggregations: readonly PeerAggregation[]): { valid: AnnualVariant[]; invalid: StressFailure[] } {
  const peerLabels = [
    "all",
    ...GOVERNMENT_SCORECARD_V6_MANIFEST.peers.map((peer) => `without_${peer}`),
  ];
  const valid: AnnualVariant[] = [];
  const invalid: StressFailure[] = [];
  for (const baselineShift of [-1, 0, 1]) {
    for (const endShift of [-1, 0, 1]) {
      const endpoint = `baseline_${baselineShift >= 0 ? "+" : ""}${baselineShift}_end_${endShift >= 0 ? "+" : ""}${endShift}`;
      for (const peerLabel of peerLabels) {
        for (const peerAggregation of peerAggregations) {
          const key = { endpoint, peer_label: peerLabel, peer_aggregation: peerAggregation };
          const id = `${endpoint}|${peerLabel}|${peerAggregation}`;
          try {
            valid.push({
              key,
              id,
              result: calculateWindowResult(governmentId, baselineYear + baselineShift, endYear + endShift, peerSet(peerLabel), peerAggregation),
            });
          } catch (error) {
            invalid.push({
              axis: "operational",
              configuration_id: id,
              reason: error instanceof Error ? error.message : "variante annuale non valida",
            });
          }
        }
      }
    }
  }
  return { valid, invalid };
}

function findBaseYears(governmentId: string): { baselineYear: number; endYear: number } {
  const government = GOVERNMENT_SCORECARD_V6_CHRONOLOGY.find((candidate) => candidate.id === governmentId);
  if (!government) throw new RangeError(`governo v6 non registrato: ${governmentId}`);
  const asOfDate = GOVERNMENT_SCORECARD_V6_REGISTRY.asOfDate;
  const institutionalEnd = government.end_exclusive ?? asOfDate;
  const start = parseDate(government.start_date);
  const end = parseDate(institutionalEnd);
  if (daysBetween(start, end) < 365) throw new RangeError("mandato sotto gate");
  const assignedYears: number[] = [];
  for (let year = start.getUTCFullYear(); year <= end.getUTCFullYear(); year += 1) {
    const julyFirst = parseDate(`${year}-07-01`);
    if (julyFirst >= start && julyFirst < end && year <= COMMON_OBSERVED_THROUGH) assignedYears.push(year);
  }
  if (assignedYears.length === 0) throw new RangeError("nessun anno statistico assegnato");
  const baselineYear = assignedYears[0] - 1;
  const endYear = government.status === "current" ? COMMON_OBSERVED_THROUGH : assignedYears[assignedYears.length - 1];
  if (endYear <= baselineYear) throw new RangeError("finestra statistica non positiva");
  return { baselineYear, endYear };
}

function baseScore(governmentId: string): number {
  const { baselineYear, endYear } = findBaseYears(governmentId);
  const scaled = commonScaleResult(
    calculateWindowResult(governmentId, baselineYear, endYear),
    GOVERNMENT_SCORECARD_V6_MANIFEST.peers,
    "median",
    "mad_with_iqr_fallback",
    1995,
  );
  return scoreScaledVariant(scaled);
}

function methodAudit(governmentId: string, base: number) {
  const { baselineYear, endYear } = findBaseYears(governmentId);
  const baseResult = calculateWindowResult(governmentId, baselineYear, endYear);
  const scaledCache = new Map<string, VariantResult>();
  const scores: number[] = [];
  const ids = new Set<string>();
  let duplicateConfigurationCount = 0;
  let baseFound: number | null = null;
  const oneAtATime: Record<string, number[]> = {
    scale_normalizer_pair: [],
    calibration_period: [],
    peer_aggregation: [],
    public_finance_split: [],
    pillar_aggregation: [],
    pillar_weights: [],
  };
  const invalid: { id: string; reason: string }[] = [...GOVERNMENT_SCORECARD_V6_STRESS_MANIFEST.rejected_configurations];

  for (const pair of GOVERNMENT_SCORECARD_V6_STRESS_MANIFEST.axes.scale_normalizer_pairs) {
    for (const calibration of GOVERNMENT_SCORECARD_V6_STRESS_MANIFEST.axes.calibration_periods) {
      for (const peerAggregation of GOVERNMENT_SCORECARD_V6_STRESS_MANIFEST.axes.peer_aggregations) {
        const scaledKey = `${pair.value.scale_estimator}|${calibration.value}|${peerAggregation.value}`;
        let scaled = scaledCache.get(scaledKey);
        if (!scaled) {
          scaled = commonScaleResult(
            baseResult,
            GOVERNMENT_SCORECARD_V6_MANIFEST.peers,
            peerAggregation.value,
            pair.value.scale_estimator,
            calibration.value,
          );
          scaledCache.set(scaledKey, scaled);
        }
        for (const financeSplit of GOVERNMENT_SCORECARD_V6_STRESS_MANIFEST.axes.public_finance_splits) {
          for (const aggregation of GOVERNMENT_SCORECARD_V6_STRESS_MANIFEST.axes.pillar_aggregations) {
            for (const weights of WEIGHT_VECTORS) {
              const id = [
                pair.id,
                calibration.id,
                peerAggregation.id,
                financeSplit.id,
                aggregation.id,
                weights.id,
              ].join("|");
              if (ids.has(id)) duplicateConfigurationCount += 1;
              ids.add(id);
              const score = scoreScaledVariant(
                scaled,
                pair.value.normalizer,
                financeSplit.value.debt_weight,
                aggregation.value,
                weights.normalized,
              );
              scores.push(score);
              const baseAxes = {
                scale_normalizer_pair: pair.id === "mad_with_iqr_fallback+tanh",
                calibration_period: calibration.id === "1995+",
                peer_aggregation: peerAggregation.id === "median",
                public_finance_split: financeSplit.id === "debt_50_primary_50",
                pillar_aggregation: aggregation.id === "arithmetic",
                pillar_weights: weights.id === "1.0|1.0|1.0|1.0|1.0",
              };
              const changedAxes = Object.entries(baseAxes)
                .filter(([, isBaseAxis]) => !isBaseAxis)
                .map(([axis]) => axis);
              if (changedAxes.length === 0) baseFound = score;
              if (changedAxes.length === 1) oneAtATime[changedAxes[0]].push(score);
            }
          }
        }
      }
    }
  }

  const summary = scoreSummary(scores);
  const axisWidths = Object.fromEntries(
    Object.entries(oneAtATime).map(([axis, axisScores]) => [
      axis,
      scoreSummary([base, ...axisScores]).width,
    ]),
  );
  const dominant = Object.entries(axisWidths)
    .toSorted((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))[0][0];
  return {
    ...summary,
    base_reconciled: baseFound !== null && Math.abs(baseFound - base) <= 1e-10,
    configurations_evaluated: scores.length,
    complete: scores.length === GOVERNMENT_SCORECARD_V6_STRESS_MANIFEST.expected_method_configurations_per_government
      && duplicateConfigurationCount === 0
      && baseFound !== null
      && Math.abs(baseFound - base) <= 1e-10,
    missing_axes: [] as string[],
    duplicate_configuration_count: duplicateConfigurationCount,
    invalid_configurations: invalid,
    dominant_assumption: dominant,
    separate_diagnostics: GOVERNMENT_SCORECARD_V6_STRESS_MANIFEST.separate_diagnostics,
  };
}

function pearson(left: readonly number[], right: readonly number[]): number {
  if (left.length !== right.length || left.length < 2) {
    throw new RangeError("correlazione senza osservazioni appaiate sufficienti");
  }
  const leftMean = mean(left);
  const rightMean = mean(right);
  const numerator = left.reduce(
    (sum, value, index) => sum + (value - leftMean) * (right[index] - rightMean),
    0,
  );
  const denominator = Math.sqrt(
    left.reduce((sum, value) => sum + (value - leftMean) ** 2, 0)
    * right.reduce((sum, value) => sum + (value - rightMean) ** 2, 0),
  );
  if (denominator === 0) throw new RangeError("correlazione con varianza nulla");
  return numerator / denominator;
}

function separateDiagnostics(governmentId: string) {
  const { baselineYear, endYear } = findBaseYears(governmentId);
  const scaled = commonScaleResult(
    calculateWindowResult(governmentId, baselineYear, endYear),
    GOVERNMENT_SCORECARD_V6_MANIFEST.peers,
    "median",
    "mad_with_iqr_fallback",
    1995,
  );
  const referenceLength = Math.min(...scaled.indicators.map((indicator) => indicator.reference_gaps?.length ?? 0));
  const jackknifeScores: number[] = [];
  for (let omittedWindow = 0; omittedWindow < referenceLength; omittedWindow += 1) {
    const indicators = scaled.indicators.map((indicator) => {
      const referenceGaps = indicator.reference_gaps;
      if (!referenceGaps) throw new Error(`riferimenti scala mancanti per ${indicator.id}`);
      const retained = referenceGaps.filter((_, index) => index !== omittedWindow);
      return {
        ...indicator,
        scores: zeroCenteredScores(indicator.peer_gap, retained, "mad_with_iqr_fallback"),
        scale: referenceScale(retained, "mad_with_iqr_fallback"),
        reference_gaps: retained,
      };
    });
    jackknifeScores.push(scoreScaledVariant({ ...scaled, indicators }));
  }
  const basePillars = pillarScores(scaled, "tanh", 0.5);
  const dropPillarScores = PILLAR_ORDER.map((omitted) =>
    mean(PILLAR_ORDER.filter((pillar) => pillar !== omitted).map((pillar) => basePillars[pillar])));
  const effectiveIndicatorWeights = new Map<IndicatorId, number>();
  for (const pillar of GOVERNMENT_SCORECARD_V6_MANIFEST.pillars) {
    for (const member of pillar.indicators) {
      effectiveIndicatorWeights.set(
        member.indicator_id,
        pillar.weight_basis_points / 10_000 * member.weight_basis_points / 10_000,
      );
    }
  }
  const indicatorScores = new Map(
    scaled.indicators.map((indicator) => {
      if (!indicator.scores) throw new Error(`punteggio diagnostico mancante per ${indicator.id}`);
      return [indicator.id, indicator.scores.tanh] as const;
    }),
  );
  const dropIndicatorScores = [...indicatorScores].map(([omitted]) => {
    const retained = [...indicatorScores].filter(([indicatorId]) => indicatorId !== omitted);
    const totalWeight = retained.reduce(
      (sum, [indicatorId]) => sum + (effectiveIndicatorWeights.get(indicatorId) ?? 0),
      0,
    );
    return retained.reduce(
      (sum, [indicatorId, score]) =>
        sum + score * (effectiveIndicatorWeights.get(indicatorId) ?? 0) / totalWeight,
      0,
    );
  });
  const correlationMatrix = Object.fromEntries(scaled.indicators.map((left) => {
    if (!left.reference_gaps) throw new Error(`riferimenti correlazione mancanti per ${left.id}`);
    const leftReferenceGaps = left.reference_gaps;
    return [left.id, Object.fromEntries(scaled.indicators.map((right) => {
      if (!right.reference_gaps) throw new Error(`riferimenti correlazione mancanti per ${right.id}`);
      const rightReferenceGaps = right.reference_gaps;
      return [right.id, left.id === right.id
        ? 1
        : pearson(leftReferenceGaps, rightReferenceGaps)];
    }))];
  }));
  return {
    scale_jackknife_width: {
      width: scoreSummary(jackknifeScores).width,
      complete: true as const,
      reason: null,
    },
    scale_leave_block_width: {
      width: null,
      complete: false as const,
      reason: "La dimensione del blocco temporale non è preregistrata nel manifest metodologico.",
    },
    expanded_peer_width: {
      width: null,
      complete: false as const,
      reason: "Lo snapshot corrente non contiene un gruppo di confronto allargato e congelato.",
    },
    drop_one_indicator_width: scoreSummary(dropIndicatorScores).width,
    drop_one_pillar_width: scoreSummary(dropPillarScores).width,
    indicator_correlation_matrix: correlationMatrix,
  };
}

function operationalAudit(governmentId: string, base: number) {
  const { baselineYear, endYear } = findBaseYears(governmentId);
  const variants = annualVariants(governmentId, baselineYear, endYear, ["median"]);
  const operationalRoles = (id: string) => {
    const [endpoint, peerLabel] = id.split("|");
    return [
      ...(peerLabel === "all" ? ["temporal"] : []),
      ...(endpoint === "baseline_+0_end_+0" ? ["peer"] : []),
    ];
  };
  const temporalScores = [base];
  const peerScores = [base];
  const combinedScores = [base];
  const failures: StressFailure[] = variants.invalid.flatMap((failure) =>
    operationalRoles(failure.configuration_id).map((axis) => ({ ...failure, axis })));
  let dayWeightHash: string | null = null;
  let dayWeights: readonly {
    year: number;
    overlap_days: number;
    days_in_year: number;
    weight: number;
  }[] = [];
  for (const variant of variants.valid) {
    const roles = operationalRoles(variant.id);
    if (roles.length === 0) continue;
    try {
      const scaled = commonScaleResult(
        variant.result,
        peerSet(variant.key.peer_label),
        variant.key.peer_aggregation,
        "mad_with_iqr_fallback",
        1995,
      );
      const score = scoreScaledVariant(scaled);
      if (variant.key.peer_label === "all") {
        temporalScores.push(score);
        combinedScores.push(score);
      }
      if (variant.key.endpoint === "baseline_+0_end_+0") {
        peerScores.push(score);
        combinedScores.push(score);
      }
    } catch (error) {
      failures.push(...roles.map((axis) => ({
        axis,
        configuration_id: variant.id,
        reason: error instanceof Error ? error.message : "scala operativa non valida",
      })));
    }
  }

  const government = GOVERNMENT_SCORECARD_V6_CHRONOLOGY.find((candidate) => candidate.id === governmentId);
  if (!government) throw new RangeError(`governo v6 non registrato: ${governmentId}`);
  const overlapEnd = government.end_exclusive ?? `${COMMON_OBSERVED_THROUGH + 1}-01-01`;
  try {
    const exactWeights = fullDayWeightsV6(government.start_date, overlapEnd)
      .filter((item) => item.year <= COMMON_OBSERVED_THROUGH);
    dayWeightHash = `sha256:${hashGovernmentScorecardV6DayWeights(exactWeights)}`;
    dayWeights = exactWeights;
    const weights = exactWeights.map(({ year, weight }) => ({ year, weight }));
    const weighted = calculateWeightedResult(governmentId, weights, GOVERNMENT_SCORECARD_V6_MANIFEST.peers, "median");
    const scaled = commonWeightedScaleResult(weighted, weights, GOVERNMENT_SCORECARD_V6_MANIFEST.peers, "median");
    const score = scoreScaledVariant(scaled);
    temporalScores.push(score);
    combinedScores.push(score);
  } catch (error) {
    failures.push({
      axis: "temporal",
      configuration_id: "weighted_annual_increment",
      reason: error instanceof Error ? error.message : "overlap temporale non valido",
    });
  }

  failures.push({
    axis: "vintage",
    configuration_id: "previous_vintage",
    reason: "Un vintage AMECO precedente non è incluso nei dati pubblicati.",
  });

  const temporal = scoreSummary(temporalScores);
  const peer = scoreSummary(peerScores);
  const combined = scoreSummary(combinedScores);
  const missingAxisSet = new Set<string>(["vintage"]);
  for (const failure of failures) {
    if (failure.axis === "temporal" || failure.axis === "peer") missingAxisSet.add(failure.axis);
  }
  const missingAxes = GOVERNMENT_SCORECARD_V6_STRESS_MANIFEST.required_operational_axes
    .filter((axis) => missingAxisSet.has(axis));
  return {
    operational_min: combined.minimum,
    operational_max: combined.maximum,
    operational_width: combined.width,
    temporal_width: temporal.width,
    peer_width: peer.width,
    vintage_delta: null,
    missing_axes: missingAxes,
    failures,
    temporal: {
      ...temporal,
      configurations_evaluated: temporalScores.length,
      day_weight_hash: dayWeightHash,
      day_weights: dayWeights,
    },
    peer: { ...peer, configurations_evaluated: peerScores.length },
    vintage: {
      delta: null,
      complete: false,
      reason: "Un vintage AMECO precedente non è incluso nei dati pubblicati.",
    },
  };
}

function crossesQualityBand(minimum: number, maximum: number): boolean {
  const thresholds = [24, 44, 55, 75];
  return thresholds.some((threshold) => minimum <= threshold && maximum > threshold);
}

export function classifyGovernmentScorecardV6Sensitivity(input: SensitivityClassificationInput) {
  const stability: Stability = input.operational_width <= GOVERNMENT_SCORECARD_V6_STRESS_MANIFEST.thresholds.stability_high_max_width
    ? "Alta"
    : input.operational_width <= GOVERNMENT_SCORECARD_V6_STRESS_MANIFEST.thresholds.stability_medium_max_width
      ? "Media"
      : "Bassa";
  const badges: string[] = [];
  if (crossesQualityBand(input.operational_min, input.operational_max)) badges.push("Variabile");
  if (input.temporal_width > GOVERNMENT_SCORECARD_V6_STRESS_MANIFEST.thresholds.temporal_badge_width) {
    badges.push("Periodo sensibile");
  }
  if (input.peer_width > GOVERNMENT_SCORECARD_V6_STRESS_MANIFEST.thresholds.peer_badge_width) {
    badges.push("Peer sensibili");
  }
  if (input.method_audit_width > GOVERNMENT_SCORECARD_V6_STRESS_MANIFEST.thresholds.method_badge_width) {
    badges.push("Metodo sensibile");
  }
  if (!input.sensitivity_complete || input.missing_axes.length > 0) badges.push("Stress parziale");
  return { base_score: input.base_score, stability, badges };
}

const sensitivityCache = new Map<string, GovernmentScorecardV6SensitivityOutput>();

export function getGovernmentScorecardV6Sensitivity(governmentId: string): GovernmentScorecardV6SensitivityOutput {
  const cached = sensitivityCache.get(governmentId);
  if (cached) return cached;
  const base = baseScore(governmentId);
  const method = methodAudit(governmentId, base);
  const operational = operationalAudit(governmentId, base);
  const missingAxes = [...operational.missing_axes, ...method.missing_axes];
  const sensitivityComplete = method.complete && missingAxes.length === 0;
  const classified = classifyGovernmentScorecardV6Sensitivity({
    base_score: base,
    operational_width: operational.operational_width,
    temporal_width: operational.temporal_width,
    peer_width: operational.peer_width,
    method_audit_width: method.width,
    sensitivity_complete: sensitivityComplete,
    missing_axes: missingAxes,
    operational_min: operational.operational_min,
    operational_max: operational.operational_max,
  });
  const output: GovernmentScorecardV6SensitivityOutput = {
    base_score: base,
    operational_min: operational.operational_min,
    operational_max: operational.operational_max,
    operational_width: operational.operational_width,
    temporal_width: operational.temporal_width,
    peer_width: operational.peer_width,
    vintage_delta: operational.vintage_delta,
    method_audit_min: method.minimum,
    method_audit_max: method.maximum,
    method_audit_width: method.width,
    dominant_assumption: method.dominant_assumption,
    stability: classified.stability,
    sensitivity_complete: sensitivityComplete,
    sensitivity_badges: classified.badges,
    comparison_compatible: true,
    comparison_incompatible_reason: null,
    missing_axes: missingAxes,
    stress_failures: operational.failures,
    diagnostics: separateDiagnostics(governmentId),
    method_audit: {
      configurations_evaluated: method.configurations_evaluated,
      complete: method.complete,
      missing_axes: method.missing_axes,
      base_reconciled: method.base_reconciled,
      duplicate_configuration_count: method.duplicate_configuration_count,
      invalid_configurations: method.invalid_configurations,
      separate_diagnostics: method.separate_diagnostics,
    },
    operational_audit: {
      temporal: operational.temporal,
      peer: operational.peer,
      vintage: operational.vintage,
    },
  };
  sensitivityCache.set(governmentId, output);
  return output;
}

type CoupledDataVariant = {
  id: string;
  baseline_shift: 0 | 1;
  end_shift: 0 | 1;
  peer_label: string;
  peer_aggregation: PeerAggregation;
};

function parseCoupledDataVariant(id: string): CoupledDataVariant {
  const match = /^baseline_\+(0|1)_end_\+(0|1)\|([^|]+)\|(median|mean)$/.exec(id);
  if (!match) throw new TypeError(`variante dati coupled non valida: ${id}`);
  return {
    id,
    baseline_shift: Number(match[1]) as 0 | 1,
    end_shift: Number(match[2]) as 0 | 1,
    peer_label: match[3],
    peer_aggregation: match[4] as PeerAggregation,
  };
}

let coupledAuditCache: ReturnType<typeof calculateGovernmentScorecardV6CoupledAudit> | undefined;

function calculateGovernmentScorecardV6CoupledAudit() {
  const government_ids = GOVERNMENT_SCORECARD_V6_CHRONOLOGY
    .filter((government) => government.status === "ended")
    .map((government) => government.id)
    .filter((governmentId) => {
      try {
        findBaseYears(governmentId);
        baseScore(governmentId);
        return true;
      } catch {
        return false;
      }
    });
  const manifest = validateGovernmentScorecardV6StressManifest(GOVERNMENT_SCORECARD_V6_STRESS_MANIFEST);
  const axes = manifest.axes;
  const dataVariants = axes.coupled_data_variants.map((entry) => parseCoupledDataVariant(entry.value));
  const configurationIds = new Set<string>();
  const configurationHash = createHash("sha256");
  const scoreMatrixHash = createHash("sha256");
  const scaledCache = new Map<string, VariantResult>();
  const failures: StressFailure[] = [];
  let configurationsEvaluated = 0;
  let governmentScoresEvaluated = 0;
  let baseReconciled = false;

  const scaledResult = (
    governmentId: string,
    dataVariant: CoupledDataVariant,
    estimator: ScaleEstimator,
    calibrationStart: 1995 | 2000,
  ) => {
    const key = [governmentId, dataVariant.id, estimator, calibrationStart].join("\u0000");
    const cached = scaledCache.get(key);
    if (cached) return cached;
    const { baselineYear, endYear } = findBaseYears(governmentId);
    const peers = peerSet(dataVariant.peer_label);
    const result = commonScaleResult(
      calculateWindowResult(
        governmentId,
        baselineYear + dataVariant.baseline_shift,
        endYear + dataVariant.end_shift,
        peers,
        dataVariant.peer_aggregation,
      ),
      peers,
      dataVariant.peer_aggregation,
      estimator,
      calibrationStart,
    );
    scaledCache.set(key, result);
    return result;
  };

  outer: for (const dataVariant of dataVariants) {
    for (const pair of axes.scale_normalizer_pairs) {
      for (const calibration of axes.calibration_periods) {
        for (const financeSplit of axes.public_finance_splits) {
          for (const aggregation of axes.pillar_aggregations) {
            for (const weights of WEIGHT_VECTORS) {
              const configurationId = [
                dataVariant.id,
                pair.id,
                calibration.id,
                financeSplit.id,
                aggregation.id,
                weights.id,
              ].join("|");
              if (configurationIds.has(configurationId)) {
                failures.push({
                  axis: "coupled_grid",
                  configuration_id: configurationId,
                  reason: "identificatore di configurazione duplicato",
                });
                break outer;
              }
              configurationIds.add(configurationId);
              configurationHash.update(configurationId).update("\n");
              configurationsEvaluated += 1;
              for (const governmentId of government_ids) {
                try {
                  const score = scoreScaledVariant(
                    scaledResult(
                      governmentId,
                      dataVariant,
                      pair.value.scale_estimator,
                      calibration.value,
                    ),
                    pair.value.normalizer,
                    financeSplit.value.debt_weight,
                    aggregation.value,
                    weights.normalized,
                  );
                  finite(score, "punteggio coupled");
                  scoreMatrixHash
                    .update(configurationId).update("\u0000")
                    .update(governmentId).update("\u0000")
                    .update(score.toPrecision(17)).update("\n");
                  governmentScoresEvaluated += 1;
                  const isBaseConfiguration = dataVariant.id === BASE_DATA_VARIANT
                    && pair.id === "mad_with_iqr_fallback+tanh"
                    && calibration.id === "1995+"
                    && financeSplit.id === "debt_50_primary_50"
                    && aggregation.id === "arithmetic"
                    && weights.id === "1.0|1.0|1.0|1.0|1.0";
                  if (isBaseConfiguration) {
                    if (Math.abs(score - baseScore(governmentId)) > 1e-10) {
                      throw new RangeError("riconciliazione della configurazione base fallita");
                    }
                    if (governmentId === government_ids.at(-1)) baseReconciled = true;
                  }
                } catch (error) {
                  failures.push({
                    axis: "coupled_grid",
                    configuration_id: configurationId,
                    reason: error instanceof Error ? error.message : "configurazione coupled non valida",
                  });
                  break outer;
                }
              }
            }
          }
        }
      }
    }
  }
  const complete = failures.length === 0
    && government_ids.length === 13
    && configurationsEvaluated === manifest.expected_coupled_configurations
    && configurationIds.size === manifest.expected_coupled_configurations
    && governmentScoresEvaluated === manifest.expected_coupled_configurations * government_ids.length
    && baseReconciled;
  const missing_axes = complete ? [] : ["coupled_grid"];
  return {
    methodology_version: GOVERNMENT_SCORECARD_V6_MANIFEST.methodology_version,
    government_count: government_ids.length,
    government_ids,
    configurations_evaluated: configurationsEvaluated,
    unique_configuration_count: configurationIds.size,
    government_scores_evaluated: governmentScoresEvaluated,
    configuration_ids_sha256: configurationHash.digest("hex"),
    score_matrix_sha256: scoreMatrixHash.digest("hex"),
    base_reconciled: baseReconciled,
    complete,
    missing_axes,
    failures,
    note: "Audit interno accoppiato: il prodotto espone soltanto conteggio e completezza, senza confronti ordinali o verdetti.",
  };
}

export function getGovernmentScorecardV6CoupledAudit() {
  coupledAuditCache ??= calculateGovernmentScorecardV6CoupledAudit();
  return coupledAuditCache;
}
