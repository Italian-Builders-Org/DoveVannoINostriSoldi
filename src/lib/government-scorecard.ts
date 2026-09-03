import {
  GOVERNMENT_SCORECARD_V6_MANIFEST,
  governmentScorecardV6ScaleKeySchema,
  parseGovernmentScorecardV6Input,
  type GovernmentScorecardV6ScaleKey,
} from "@/lib/data/government-scorecard-contract";

function finite(value: number, label: string): number {
  if (!Number.isFinite(value)) {
    throw new RangeError(`${label} deve essere finito`);
  }
  return value;
}

export function calculatePeerScoreV6(peerGap: number, scale: number): number {
  finite(peerGap, "peer gap");
  finite(scale, "scala");
  if (scale <= 0) {
    throw new RangeError("scala deve essere positiva");
  }
  const { neutral_score: neutral, tanh_divisor: divisor } = GOVERNMENT_SCORECARD_V6_MANIFEST.formula;
  return neutral * (1 + Math.tanh((peerGap / scale) / divisor));
}

function median(values: readonly number[]): number {
  if (values.length === 0) {
    throw new RangeError("mediana senza valori");
  }
  const ordered = values.map((value) => finite(value, "valore")).toSorted((left, right) => left - right);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 === 0
    ? (ordered[middle - 1] + ordered[middle]) / 2
    : ordered[middle];
}

export function linearR7Quantile(values: readonly number[], probability: number): number {
  finite(probability, "probabilità");
  if (probability < 0 || probability > 1 || values.length === 0) {
    throw new RangeError("quantile R-7 non valido");
  }
  const ordered = values.map((value) => finite(value, "valore")).toSorted((left, right) => left - right);
  const position = (ordered.length - 1) * probability;
  const lower = Math.floor(position);
  const fraction = position - lower;
  return ordered[lower] + fraction * (ordered[Math.min(lower + 1, ordered.length - 1)] - ordered[lower]);
}

export function calculateRobustScaleV6(values: readonly number[]): number {
  if (values.length === 0) {
    throw new RangeError("scala senza valori");
  }
  const checked = values.map((value) => finite(value, "gap di riferimento"));
  const center = median(checked);
  const epsilon = 1e-12 * Math.max(1, ...checked.map((value) => Math.abs(value)));
  const mad = median(checked.map((value) => Math.abs(value - center)));
  const madScale = GOVERNMENT_SCORECARD_V6_MANIFEST.scale.mad_multiplier * mad;
  if (madScale > epsilon) {
    return madScale;
  }
  const iqr = linearR7Quantile(checked, 0.75) - linearR7Quantile(checked, 0.25);
  const iqrScale = iqr / GOVERNMENT_SCORECARD_V6_MANIFEST.scale.iqr_divisor;
  if (iqrScale <= epsilon) {
    throw new RangeError("dispersione nulla dopo MAD e IQR");
  }
  return iqrScale;
}

export function serializeScaleKeyV6(input: GovernmentScorecardV6ScaleKey): string {
  const key = governmentScorecardV6ScaleKeySchema.parse(input);
  return JSON.stringify([
    key.indicator_id,
    key.source_set_id,
    key.temporal_operator_id,
    key.duration_or_weight_pattern_id,
    key.vintage_id,
    key.peer_set_id,
    key.peer_aggregation_id,
    key.scale_estimator_id,
    key.calibration_period_id,
    key.methodology_version,
  ]);
}

function transformedChange(
  transformation: "log_change" | "point_change",
  baseline: number,
  end: number,
): number {
  return transformation === "log_change"
    ? 100 * (Math.log(end) - Math.log(baseline))
    : end - baseline;
}

export function calculateGovernmentScorecardV6(input: unknown) {
  const frozen = parseGovernmentScorecardV6Input(input);
  const manifest = GOVERNMENT_SCORECARD_V6_MANIFEST;
  const observations = new Map(
    frozen.observations.map((observation) => [
      `${observation.indicator_id}:${observation.geography}`,
      observation,
    ]),
  );
  const scales = new Map(frozen.scales.map((scale) => [scale.key.indicator_id, scale]));
  const indicators = manifest.indicators.map((indicator) => {
    const countryChanges = manifest.countries.map((geography) => {
      const observation = observations.get(`${indicator.id}:${geography}`);
      if (!observation) {
        throw new Error("input validato privo di osservazione obbligatoria");
      }
      const rawChange = transformedChange(
        indicator.transformation,
        observation.baseline.value_raw,
        observation.end.value_raw,
      );
      return {
        geography,
        series_selectors: observation.series_selectors,
        baseline_reference_period: observation.baseline.reference_period,
        end_reference_period: observation.end.reference_period,
        baseline_value: observation.baseline.value_raw,
        end_value: observation.end.value_raw,
        observed_or_forecast: "observed" as const,
        raw_change: rawChange,
        oriented_change: indicator.direction === "higher" ? rawChange : -rawChange,
      };
    });
    const italy = countryChanges.find((country) => country.geography === "IT");
    const peers = manifest.peers.map((geography) => {
      const country = countryChanges.find((candidate) => candidate.geography === geography);
      if (!country) {
        throw new Error("input validato privo di peer obbligatorio");
      }
      return country.oriented_change;
    });
    const scaleInput = scales.get(indicator.id);
    if (!italy || !scaleInput) {
      throw new Error("input validato incompleto");
    }
    const peerMedian = median(peers);
    const peerGap = italy.oriented_change - peerMedian;
    const scale = calculateRobustScaleV6(scaleInput.windows.map((window) => window.peer_gap));
    return {
      id: indicator.id,
      pillar_id: indicator.pillar_id,
      direction: indicator.direction,
      transformation: indicator.transformation,
      unit: indicator.unit,
      definition: indicator.definition,
      source_series: indicator.source_series,
      frequency: "annual" as const,
      seasonal_adjustment: "not_applicable" as const,
      country_changes: countryChanges,
      peer_median: peerMedian,
      peer_gap: peerGap,
      scale,
      scale_key: serializeScaleKeyV6(scaleInput.key),
      score_raw: calculatePeerScoreV6(peerGap, scale),
    };
  });
  const scoreByIndicator = new Map(indicators.map((indicator) => [indicator.id, indicator.score_raw]));
  const pillars = manifest.pillars.map((pillar) => {
    const internalWeight = pillar.indicators.reduce((sum, indicator) => sum + indicator.weight_basis_points, 0);
    if (internalWeight !== 10_000) {
      throw new Error(`pesi interni non riconciliati per ${pillar.id}`);
    }
    const scoreRaw = pillar.indicators.reduce((sum, member) => {
      const score = scoreByIndicator.get(member.indicator_id);
      if (score === undefined) {
        throw new Error(`indicatore obbligatorio assente da ${pillar.id}`);
      }
      return sum + score * member.weight_basis_points / 10_000;
    }, 0);
    return {
      id: pillar.id,
      weight_basis_points: pillar.weight_basis_points,
      score_raw: scoreRaw,
    };
  });
  const pillarWeight = pillars.reduce((sum, pillar) => sum + pillar.weight_basis_points, 0);
  if (pillarWeight !== 10_000) {
    throw new Error("pesi pilastro non riconciliati");
  }
  const scoreRaw = pillars.reduce(
    (sum, pillar) => sum + pillar.score_raw * pillar.weight_basis_points / 10_000,
    0,
  );
  const canonicalScales = manifest.indicators.map((indicator) => {
    const scale = scales.get(indicator.id);
    if (!scale) throw new Error(`scala obbligatoria assente per ${indicator.id}`);
    return {
      key: scale.key,
      windows: scale.windows.toSorted((left, right) =>
        left.start_year - right.start_year || left.end_year - right.end_year),
    };
  });
  return {
    schema_version: frozen.schema_version,
    snapshot_version: frozen.snapshot_version,
    methodology_version: frozen.methodology_version,
    as_of_date: frozen.as_of_date,
    government: frozen.government,
    source: frozen.source,
    window: frozen.window,
    stability: frozen.stability,
    scales: canonicalScales,
    indicators,
    pillars,
    score_raw: scoreRaw,
    display_score: Math.floor(scoreRaw + 0.5),
  };
}
