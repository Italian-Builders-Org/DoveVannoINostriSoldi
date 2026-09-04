import { GOVERNMENT_SCORECARD_V6_MANIFEST } from "@/lib/data/government-scorecard-contract";
import { durationDaysV6 } from "@/lib/government-scorecard-temporal";
import type { calculateGovernmentScorecardV6 } from "@/lib/government-scorecard";
import type { GovernmentScorecardV6SensitivityOutput } from "@/lib/government-scorecard-sensitivity";

export const GOVERNMENT_SCORECARD_V6_SCORE_STATES = [
  "scored_final",
  "scored_provisional",
  "not_scored_short",
  "not_scored_data",
] as const;

export type GovernmentScorecardV6ScoreState = (typeof GOVERNMENT_SCORECARD_V6_SCORE_STATES)[number];

export type GovernmentScorecardV6Coverage = {
  mandatory_inputs_complete: boolean;
  scale_complete: boolean;
  comparable: boolean;
  endpoint_status: "observed" | "forecast";
  missing_reason?: string;
};

export type VerifiedGovernmentScorecardV6Input = {
  government: {
    id: string;
    name: string;
    start_date: string;
    end_date: string | null;
    status: "current" | "ended";
    source_owner: string;
    source_url: string;
    source_locator: string;
  };
  as_of_date: string;
  coverage: GovernmentScorecardV6Coverage;
};

export type GovernmentScorecardV6Decision =
  | { score_state: "scored_final" }
  | { score_state: "scored_provisional" }
  | { score_state: "not_scored_short"; reason: string }
  | { score_state: "not_scored_data"; reason: string };

const SHORT_MANDATE_REASON = "Mandato troppo breve per i dati annuali disponibili.";
const FORECAST_REASON = "L'anno finale disponibile è una previsione e non può entrare nel voto.";

function mandateDurationDays(input: VerifiedGovernmentScorecardV6Input): number {
  const { government } = input;
  if (government.status === "current" && government.end_date !== null) {
    throw new TypeError("un governo corrente non puo' avere una data finale");
  }
  if (government.status === "ended" && government.end_date === null) {
    throw new TypeError("un governo concluso richiede una data finale esclusiva");
  }
  return durationDaysV6(government.start_date, government.end_date ?? input.as_of_date);
}

export function classifyGovernmentScorecardV6Input(
  input: VerifiedGovernmentScorecardV6Input,
): GovernmentScorecardV6Decision {
  if (mandateDurationDays(input) < 365) {
    return { score_state: "not_scored_short", reason: SHORT_MANDATE_REASON };
  }

  if (input.coverage.endpoint_status === "forecast") {
    return { score_state: "not_scored_data", reason: FORECAST_REASON };
  }

  if (
    !input.coverage.mandatory_inputs_complete
    || !input.coverage.scale_complete
    || !input.coverage.comparable
  ) {
    if (!input.coverage.missing_reason?.trim()) {
      throw new TypeError("un input incompleto richiede un motivo verificabile");
    }
    return { score_state: "not_scored_data", reason: input.coverage.missing_reason };
  }

  return {
    score_state: input.government.status === "current" ? "scored_provisional" : "scored_final",
  };
}

const PILLAR_LABELS = {
  purchasing_power: "Potere d'acquisto",
  labour: "Lavoro",
  growth: "Crescita",
  public_finance: "Finanza pubblica",
  future_capacity: "Capacita' futura",
} as const;

const INDICATOR_LABELS = {
  real_compensation: "Compenso reale per dipendente",
  unemployment: "Tasso di disoccupazione",
  real_gdp_per_capita: "PIL reale per abitante",
  debt_ratio: "Debito pubblico sul PIL",
  primary_balance: "Saldo primario sul PIL",
  investment_share: "Investimenti totali sul PIL",
} as const;

export const GOVERNMENT_SCORECARD_V6_SECTION_ORDER = [
  "charts",
  "context",
  "compare",
  "methodology",
] as const;

export const GOVERNMENT_SCORECARD_V6_CAUSAL_DISCLAIMER = "Questo voto descrive come è andata l'economia nel periodo; non misura quanta parte dei risultati sia stata causata dal governo.";

export const GOVERNMENT_SCORECARD_V6_METHOD_STEPS = [
  "Guardiamo come cambia l'Italia.",
  "Guardiamo gli stessi dati in Francia, Germania e Spagna.",
  "Confrontiamo i cambiamenti osservati nello stesso periodo.",
  "Uniamo cinque aree con lo stesso peso.",
  "Otteniamo un numero da 0 a 100: 50 significa che l'andamento dell'Italia è simile a quello di Francia, Germania e Spagna.",
] as const;

export type GovernmentScorecardV6ChartSource = {
  owner: string;
  url: string;
  data_version: string;
  retrieved_at: string;
  raw_sha256: string;
};

export type GovernmentScorecardV6ChartSlide = {
  status: "ready";
  indicator_id: string;
  title: string;
  question: string;
  unit: string;
  frequency: "Annuale" | "Trimestrale" | "Mensile";
  mandate_window: {
    start_year: number;
    end_year: number;
    start_date: string;
    end_date: string;
    end_exclusive: boolean;
  };
  complete_window: {
    start_year: number;
    end_year: number;
    start_date: string;
    end_date: string;
    end_exclusive: false;
  };
  note: string;
  source: GovernmentScorecardV6ChartSource;
  series: readonly {
    id: "IT" | "FR" | "DE" | "ES";
    label: "Italia" | "Francia" | "Germania" | "Spagna";
    points: readonly {
      year: number;
      period: string;
      period_start: string;
      value: number;
      status: "observed" | "provisional" | "estimated";
      quality_notes?: readonly string[];
    }[];
  }[];
};

export type GovernmentScorecardV6ContextCategory =
  | "overview"
  | "inheritance"
  | "geopolitics_crises"
  | "eurozone_ecb"
  | "laws_measures"
  | "chronology";

export type GovernmentScorecardV6ChartCollection = {
  status: "ready";
  default_scope: "mandate";
  slides: readonly GovernmentScorecardV6ChartSlide[];
} | {
  status: "empty";
  message: string;
  slides: readonly [];
};

export type GovernmentScorecardV6ContextSourceFields = {
  source_rank: 1 | 2 | 3 | 4 | null;
  source_owner: string | null;
  source_type: "official" | null;
  persistent_id_or_url: string | null;
  retrieved_at: string | null;
  evidence_sha256: string | null;
};

export type GovernmentScorecardV6ContextSlide = GovernmentScorecardV6ContextSourceFields & {
  id: "overview" | "inheritance" | "geopolitics_crises" | "ecb" | "measures" | "chronology";
  context_item_id: string;
  government_id: string;
  category: GovernmentScorecardV6ContextCategory;
  title: string;
  label: string;
  status: "ready" | "empty";
  badge: "Contesto · non cambia il voto";
  score_impact: "none";
  primary_value: string | null;
  message: string;
  summary: readonly string[];
  period: string;
  start_date: string | null;
  end_date_or_null: string | null;
  date_precision: "day" | "month" | "quarter" | "year";
  economic_channel: string | null;
  mandate_relation: "inherited" | "during" | "cross_government";
  selection_rule: string;
  items: readonly {
    id: string;
    title: string;
    summary: string;
    period: string;
    start_date: string;
    end_date_or_null: string | null;
    date_precision: "day" | "month" | "quarter" | "year";
    economic_channel: string;
    mandate_relation: "inherited" | "during" | "cross_government";
    selection_rule: string;
    score_impact: "none";
    sources: readonly {
      owner: string;
      type: "official";
      url: string;
    }[];
    retrieved_at: string;
    evidence_sha256: string;
  }[];
};

export type GovernmentScorecardV6CompareOption = {
  id: string;
  label: string;
  href: string;
  score_state: GovernmentScorecardV6ScoreState;
  score_display: number | null;
  start_date: string;
  end_date: string | null;
  current: boolean;
};

export type GovernmentScorecardV6ComparisonDetail = GovernmentScorecardV6CompareOption & {
  chart_windows: readonly {
    indicator_id: string;
    start_year: number;
    end_year: number;
    start_date: string;
    end_date: string;
    end_exclusive: boolean;
  }[];
  context: readonly GovernmentScorecardV6ContextSlide[];
};

export type GovernmentScorecardV6Ui = {
  charts: GovernmentScorecardV6ChartCollection;
  context: {
    status: "ready";
    slides: readonly GovernmentScorecardV6ContextSlide[];
  };
  compare: {
    status: "ready";
    message: string;
    current_government_id: string;
    options: readonly GovernmentScorecardV6CompareOption[];
  };
};

const EMPTY_CHARTS: GovernmentScorecardV6ChartCollection = {
  status: "empty",
  message: "Nessuna serie grafica verificata disponibile per questo governo.",
  slides: [],
};
const EMPTY_CONTEXT = {
  status: "ready",
  slides: [],
} as const;
const EMPTY_COMPARE = {
  status: "ready",
  message: "Nessun confronto disponibile.",
  current_government_id: "",
  options: [],
} as const;

type CalculationResult = ReturnType<typeof calculateGovernmentScorecardV6>;
type ScoredState = "scored_final" | "scored_provisional";
type NotScoredState = "not_scored_short" | "not_scored_data";
type StabilityLabel = "Alta" | "Media" | "Bassa" | null;

export type GovernmentScorecardV6Sensitivity = {
  sensitivity_complete: boolean;
  stability_label: StabilityLabel;
  sensitivity_badges: readonly string[];
  comparison_notes: readonly string[];
  stress: GovernmentScorecardV6SensitivityOutput | null;
};

export type GovernmentScorecardV6Gate = {
  minimum_duration_days: 365;
  duration_days: number;
  duration_complete: boolean;
  endpoint_positive: boolean;
  mandatory_inputs_complete: boolean;
  comparable: boolean;
  forecast_free: boolean;
  scales: readonly {
    indicator_id: string;
    rolling_count: number;
    disjoint_capacity: number;
    passes: boolean;
  }[];
};

export type GovernmentScorecardV6StatisticalWindow = {
  reference_date_rule: "july-1";
  assigned_years: readonly number[];
  first_year: number | null;
  last_year: number | null;
  baseline_year: number | null;
  end_year: number | null;
  observed_through: number;
};

type GovernmentScorecardV6PageBase = GovernmentScorecardV6Sensitivity & {
  government: VerifiedGovernmentScorecardV6Input["government"];
  institutional_period: {
    start_date: string;
    end_exclusive: string | null;
    as_of_date: string;
    status: "current" | "ended";
    source_locator: string;
  };
  statistical_window: GovernmentScorecardV6StatisticalWindow;
  gate: GovernmentScorecardV6Gate;
  source: CalculationResult["source"];
  sources: readonly { id: string; label: string; url: string }[];
  methodology: {
    score_formula: {
      formula_id: string;
      expression: string;
      neutral_score: number;
      minimum_score: number;
      maximum_score: number;
    };
  };
  section_order: typeof GOVERNMENT_SCORECARD_V6_SECTION_ORDER;
  causal_disclaimer: typeof GOVERNMENT_SCORECARD_V6_CAUSAL_DISCLAIMER;
  charts: GovernmentScorecardV6ChartCollection;
  context: GovernmentScorecardV6Ui["context"];
  compare: GovernmentScorecardV6Ui["compare"];
};

function displayNumber(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function scoreLabel(score: number): "Molto sotto" | "Sotto" | "In linea" | "Sopra" | "Molto sopra" {
  if (score <= 24) return "Molto sotto";
  if (score <= 44) return "Sotto";
  if (score <= 55) return "In linea";
  if (score <= 75) return "Sopra";
  return "Molto sopra";
}

function formulaView() {
  const formula = GOVERNMENT_SCORECARD_V6_MANIFEST.formula;
  return {
    score_formula: {
      formula_id: formula.formula_id,
      expression: `${formula.neutral_score} × [1 + tanh((gap / scala) / ${formula.tanh_divisor})]`,
      neutral_score: formula.neutral_score,
      minimum_score: formula.minimum_score,
      maximum_score: formula.maximum_score,
    },
  };
}

function sourceLinks(
  government: VerifiedGovernmentScorecardV6Input["government"],
  source: CalculationResult["source"],
) {
  return [
    { id: "institutional-period", label: government.source_owner, url: government.source_url },
    { id: "ameco-landing", label: `${source.source_owner} · ${source.vintage}`, url: source.landing_url },
    { id: "ameco-raw", label: "Snapshot AMECO upstream", url: source.raw_url },
  ] as const;
}

function pageWindowFromCalculation(result: CalculationResult): GovernmentScorecardV6StatisticalWindow {
  return {
    reference_date_rule: result.window.reference_date_rule,
    assigned_years: result.window.assigned_years,
    first_year: result.window.first_year,
    last_year: result.window.last_year,
    baseline_year: result.window.baseline_year,
    end_year: result.window.end_year,
    observed_through: result.window.observed_through,
  };
}

function assertGateConsistent(
  input: VerifiedGovernmentScorecardV6Input,
  window: GovernmentScorecardV6StatisticalWindow,
  gate: GovernmentScorecardV6Gate,
): boolean {
  const duration = mandateDurationDays(input);
  const durationComplete = duration >= gate.minimum_duration_days;
  const endpointPositive = window.baseline_year !== null
    && window.end_year !== null
    && window.end_year > window.baseline_year;
  const forecastFree = window.end_year === null || window.end_year <= window.observed_through;
  const expectedScaleIds = GOVERNMENT_SCORECARD_V6_MANIFEST.indicators.map((indicator) => indicator.id);
  const actualScaleIds = gate.scales.map((scale) => scale.indicator_id);
  const scaleShapeValid = endpointPositive
    ? actualScaleIds.length === expectedScaleIds.length
      && new Set(actualScaleIds).size === expectedScaleIds.length
      && expectedScaleIds.every((id) => actualScaleIds.includes(id))
    : actualScaleIds.length === 0;
  const scalesReconciled = gate.scales.every((scale) => {
    const countsValid = Number.isInteger(scale.rolling_count)
      && Number.isInteger(scale.disjoint_capacity)
      && scale.rolling_count >= 0
      && scale.disjoint_capacity >= 0
      && scale.disjoint_capacity <= scale.rolling_count;
    const expectedPass = scale.rolling_count >= GOVERNMENT_SCORECARD_V6_MANIFEST.scale.minimum_rolling_windows
      && scale.disjoint_capacity >= GOVERNMENT_SCORECARD_V6_MANIFEST.scale.minimum_disjoint_windows;
    return countsValid && scale.passes === expectedPass;
  });
  const scaleComplete = gate.scales.length === 6 && gate.scales.every((scale) => scale.passes);
  if (
    gate.minimum_duration_days !== 365
    || gate.duration_days !== duration
    || gate.duration_complete !== durationComplete
    || gate.endpoint_positive !== endpointPositive
    || gate.mandatory_inputs_complete !== input.coverage.mandatory_inputs_complete
    || gate.comparable !== input.coverage.comparable
    || gate.forecast_free !== (input.coverage.endpoint_status === "observed")
    || gate.forecast_free !== forecastFree
    || !scaleShapeValid
    || !scalesReconciled
  ) {
    throw new Error("gate v6 non riconciliato con input e finestra");
  }
  return scaleComplete;
}

function economicContent(result: CalculationResult) {
  const manifestPillars = new Map(GOVERNMENT_SCORECARD_V6_MANIFEST.pillars.map((pillar) => [pillar.id, pillar]));
  const pillarWeights = new Map(result.pillars.map((pillar) => [pillar.id, pillar.weight_basis_points]));
  const indicators = result.indicators.map((indicator) => {
    const italy = indicator.country_changes.find((country) => country.geography === "IT");
    const pillar = manifestPillars.get(indicator.pillar_id);
    const member = pillar?.indicators.find((candidate) => candidate.indicator_id === indicator.id);
    const pillarWeight = pillarWeights.get(indicator.pillar_id);
    if (!italy || !member || pillarWeight === undefined) {
      throw new Error(`riconciliazione v6 incompleta per ${indicator.id}`);
    }
    const totalWeight = (pillarWeight / 10_000) * (member.weight_basis_points / 10_000);
    const contributionRaw = indicator.score_raw * totalWeight;
    return {
      id: indicator.id,
      pillar_id: indicator.pillar_id,
      label: INDICATOR_LABELS[indicator.id],
      unit: indicator.unit,
      definition: indicator.definition,
      direction: indicator.direction,
      transformation: indicator.transformation,
      series_selectors: italy.series_selectors,
      source_series: indicator.source_series,
      italy: {
        inputs: {
          baseline: { year: italy.baseline_reference_period, value: italy.baseline_value },
          final: { year: italy.end_reference_period, value: italy.end_value },
        },
        raw_change: italy.raw_change,
        oriented_change: italy.oriented_change,
        display: {
          baseline: displayNumber(italy.baseline_value),
          final: displayNumber(italy.end_value),
          raw_change: displayNumber(italy.raw_change),
        },
      },
      peer_median_oriented_change: indicator.peer_median,
      peer_gap: indicator.peer_gap,
      scale: indicator.scale,
      display: {
        peer_median: displayNumber(indicator.peer_median),
        peer_gap: displayNumber(indicator.peer_gap),
        scale: displayNumber(indicator.scale),
      },
      score: { raw: indicator.score_raw, display: displayNumber(indicator.score_raw) },
      internal_weight_basis_points: member.weight_basis_points,
      contribution_to_total: { raw: contributionRaw, display: displayNumber(contributionRaw) },
    };
  });
  const pillars = result.pillars.map((pillar) => {
    const members = indicators.filter((indicator) => indicator.pillar_id === pillar.id);
    const memberContributions = members.map(
      (indicator) => indicator.score.raw * indicator.internal_weight_basis_points / 10_000,
    );
    const contributionRaw = pillar.score_raw * pillar.weight_basis_points / 10_000;
    return {
      id: pillar.id,
      label: PILLAR_LABELS[pillar.id],
      weight_basis_points: pillar.weight_basis_points,
      score: { raw: pillar.score_raw, display: displayNumber(pillar.score_raw) },
      contribution_to_total: { raw: contributionRaw, display: displayNumber(contributionRaw) },
      members,
      reconciliation: {
        internal_weights_basis_points: members.map((member) => member.internal_weight_basis_points),
        internal_weights_display: members.map((member) => `${member.internal_weight_basis_points / 100}%`),
        member_contributions_raw: memberContributions,
      },
    };
  });
  return { pillars, indicators };
}

type EconomicContent = ReturnType<typeof economicContent>;

export type GovernmentScorecardV6ScoredView<TState extends ScoredState = ScoredState> =
  GovernmentScorecardV6PageBase & EconomicContent & {
    score_state: TState;
    score: {
      raw: number;
      display: number;
      label: ReturnType<typeof scoreLabel> | "Variabile";
      status: string;
      description: "Andamento economico relativo nel periodo";
    };
    stability: {
      evidence_scope: "government-scorecard-stress-suite";
      operational_combined_width: number;
      method_audit_width: number;
      label: Exclude<StabilityLabel, null>;
      source: "deterministic-runtime-audit";
    };
  };

export type GovernmentScorecardV6NotScoredView<TState extends NotScoredState = NotScoredState> =
  GovernmentScorecardV6PageBase & {
    score_state: TState;
    score_heading: "Voto non calcolabile";
    not_scored_reason: string;
    score?: never;
    pillars: readonly {
      id: keyof typeof PILLAR_LABELS;
      label: (typeof PILLAR_LABELS)[keyof typeof PILLAR_LABELS];
      unavailable_reason: string;
    }[];
    indicators: readonly {
      id: keyof typeof INDICATOR_LABELS;
      label: (typeof INDICATOR_LABELS)[keyof typeof INDICATOR_LABELS];
      unavailable_reason: string;
    }[];
  };

export type GovernmentScorecardV6PageView =
  | GovernmentScorecardV6ScoredView<"scored_final">
  | GovernmentScorecardV6ScoredView<"scored_provisional">
  | GovernmentScorecardV6NotScoredView<"not_scored_short">
  | GovernmentScorecardV6NotScoredView<"not_scored_data">;

type ExactType<Left, Right> =
  [Left] extends [Right] ? ([Right] extends [Left] ? true : false) : false;
type AssertType<Condition extends true> = Condition;
export type GovernmentScorecardV6PageStateCoverage = AssertType<ExactType<
  GovernmentScorecardV6ScoreState,
  GovernmentScorecardV6PageView["score_state"]
>>;

export function buildScoredGovernmentScorecardV6View<TState extends ScoredState>(
  result: CalculationResult,
  scoreState: TState,
  sensitivity: GovernmentScorecardV6Sensitivity,
  gate: GovernmentScorecardV6Gate,
): GovernmentScorecardV6ScoredView<TState> {
  if (!sensitivity.stress) {
    throw new Error("un voto v6 richiede stress suite calcolata");
  }
  const stress = sensitivity.stress;
  const input = {
    government: result.government,
    as_of_date: result.as_of_date,
    coverage: {
      mandatory_inputs_complete: gate.mandatory_inputs_complete,
      scale_complete: gate.scales.length === 6 && gate.scales.every((scale) => scale.passes),
      comparable: gate.comparable,
      endpoint_status: gate.forecast_free ? "observed" as const : "forecast" as const,
    },
  };
  const scaleComplete = assertGateConsistent(input, pageWindowFromCalculation(result), gate);
  if (!gate.endpoint_positive || !scaleComplete) {
    throw new Error("un voto v6 richiede endpoint positivo e scale complete");
  }
  const gateDecision = classifyGovernmentScorecardV6Input({
    ...input,
    coverage: { ...input.coverage, missing_reason: "gate v6 incompleto" },
  });
  if (gateDecision.score_state !== scoreState) {
    throw new Error(`stato scored incompatibile: atteso ${gateDecision.score_state}, ricevuto ${scoreState}`);
  }
  const status = scoreState === "scored_provisional"
    ? "Provvisorio"
    : `Storico — versione dei dati ${result.source.vintage}`;
  return {
    score_state: scoreState,
    government: result.government,
    score: {
      raw: result.score_raw,
      display: result.display_score,
      label: stress.sensitivity_badges.includes("Variabile")
        ? "Variabile"
        : scoreLabel(result.display_score),
      status,
      description: "Andamento economico relativo nel periodo",
    },
    ...sensitivity,
    stability: {
      evidence_scope: "government-scorecard-stress-suite",
      operational_combined_width: stress.operational_width,
      method_audit_width: stress.method_audit_width,
      label: stress.stability,
      source: "deterministic-runtime-audit",
    },
    institutional_period: {
      start_date: result.government.start_date,
      end_exclusive: result.government.end_date,
      as_of_date: result.as_of_date,
      status: result.government.status,
      source_locator: result.government.source_locator,
    },
    statistical_window: pageWindowFromCalculation(result),
    gate,
    source: result.source,
    sources: sourceLinks(result.government, result.source),
    methodology: formulaView(),
    ...economicContent(result),
    section_order: GOVERNMENT_SCORECARD_V6_SECTION_ORDER,
    causal_disclaimer: GOVERNMENT_SCORECARD_V6_CAUSAL_DISCLAIMER,
    charts: EMPTY_CHARTS,
    context: EMPTY_CONTEXT,
    compare: EMPTY_COMPARE,
  };
}

export function buildNotScoredGovernmentScorecardV6View<TState extends NotScoredState>(
  input: VerifiedGovernmentScorecardV6Input,
  expectedState: TState,
  source: CalculationResult["source"],
  statisticalWindow: GovernmentScorecardV6StatisticalWindow,
  gate: GovernmentScorecardV6Gate,
): GovernmentScorecardV6NotScoredView<TState> {
  assertGateConsistent(input, statisticalWindow, gate);
  const decision = classifyGovernmentScorecardV6Input(input);
  if (decision.score_state !== expectedState || !Object.hasOwn(decision, "reason")) {
    throw new Error(`stato non scored incompatibile: atteso ${expectedState}, ricevuto ${decision.score_state}`);
  }
  const unavailableReason = decision.reason;
  return {
    score_state: expectedState,
    government: input.government,
    score_heading: "Voto non calcolabile",
    not_scored_reason: unavailableReason,
    sensitivity_complete: false,
    stability_label: null,
    sensitivity_badges: ["Stress non applicabile senza voto base"],
    comparison_notes: [unavailableReason],
    stress: null,
    institutional_period: {
      start_date: input.government.start_date,
      end_exclusive: input.government.end_date,
      as_of_date: input.as_of_date,
      status: input.government.status,
      source_locator: input.government.source_locator,
    },
    statistical_window: statisticalWindow,
    gate,
    source,
    sources: sourceLinks(input.government, source),
    methodology: formulaView(),
    pillars: GOVERNMENT_SCORECARD_V6_MANIFEST.pillars.map((pillar) => ({
      id: pillar.id,
      label: PILLAR_LABELS[pillar.id],
      unavailable_reason: unavailableReason,
    })),
    indicators: GOVERNMENT_SCORECARD_V6_MANIFEST.indicators.map((indicator) => ({
      id: indicator.id,
      label: INDICATOR_LABELS[indicator.id],
      unavailable_reason: unavailableReason,
    })),
    section_order: GOVERNMENT_SCORECARD_V6_SECTION_ORDER,
    causal_disclaimer: GOVERNMENT_SCORECARD_V6_CAUSAL_DISCLAIMER,
    charts: EMPTY_CHARTS,
    context: EMPTY_CONTEXT,
    compare: EMPTY_COMPARE,
  };
}

export function withGovernmentScorecardV6Ui<TView extends GovernmentScorecardV6PageView>(
  view: TView,
  ui: GovernmentScorecardV6Ui,
): TView {
  return {
    ...view,
    charts: ui.charts,
    context: ui.context,
    compare: ui.compare,
  };
}

function exhaustiveState(value: never): never {
  throw new Error(`stato pagina v6 non gestito: ${JSON.stringify(value)}`);
}

export function presentGovernmentScorecardV6View(view: GovernmentScorecardV6PageView) {
  const shared = {
    stability: view.stability_label ?? "Non disponibile",
    section_order: view.section_order,
    causal_disclaimer: view.causal_disclaimer,
  };
  switch (view.score_state) {
    case "scored_final":
      return {
        ...shared,
        headline: `${view.score.display}/100`,
        label: view.score.label,
        status: `Voto indicativo · ${view.score.status}`,
      };
    case "scored_provisional":
      return {
        ...shared,
        headline: `${view.score.display}/100`,
        label: view.score.label,
        status: `Voto indicativo · ${view.score.status}`,
      };
    case "not_scored_short":
      return {
        ...shared,
        headline: view.score_heading,
        label: view.not_scored_reason,
        status: "Nessun voto prodotto",
      };
    case "not_scored_data":
      return {
        ...shared,
        headline: view.score_heading,
        label: view.not_scored_reason,
        status: "Nessun voto prodotto",
      };
    default:
      return exhaustiveState(view);
  }
}
