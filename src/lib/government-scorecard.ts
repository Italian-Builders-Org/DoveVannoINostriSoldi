import snapshotJson from "@/data/generated/government-scorecard.json";
import {
  GOVERNMENT_SCORECARD_COUNTRY_IDS,
  getGovernmentScorecardForecastCoverage,
  parseGovernmentScorecardSnapshot,
  type GovernmentScorecardCountryId,
  type GovernmentScorecardGovernment,
  type GovernmentScorecardIndicator,
  type GovernmentScorecardSnapshot,
} from "@/lib/data/government-scorecard-contract";

type IndicatorCalculation = Readonly<{
  id: GovernmentScorecardIndicator["id"];
  area: GovernmentScorecardIndicator["area"];
  label: string;
  unit: string;
  limitations: string;
  direction: GovernmentScorecardIndicator["direction"];
  transformation: GovernmentScorecardIndicator["transformation"];
  weightBasisPoints: number;
  baselineValue: number;
  endValue: number;
  rawChange: number;
  orientedChange: number;
  peerMedianChange: number;
  relativeChange: number;
  historicalScore: number;
  relativeScore: number;
  historicalWindowCount: number;
  score: number;
  contributionPoints: number;
  sourceCodes: GovernmentScorecardIndicator["sourceCodes"];
  series: readonly Readonly<{
    year: number;
    italy: number;
    france: number;
    germany: number;
    spain: number;
  }>[];
}>;

type ScoreCalculation = Readonly<{
  status: "scored";
  baselineYear: number;
  endYear: number;
  windowYears: number;
  observedScore: number;
  relativeScore: number;
  score: number;
  indicators: readonly IndicatorCalculation[];
  categories: readonly {
    id: GovernmentScorecardIndicator["area"];
    label: string;
    weightBasisPoints: number;
    score: number;
  }[];
  robustness: Readonly<{
    minimumScore: number;
    maximumScore: number;
    maximumDeviation: number;
    label: "stabile" | "sensibile" | "molto sensibile";
    checks: readonly Readonly<{
      id: string;
      label: string;
      score: number;
    }>[];
  }>;
}> | Readonly<{
  status: "not-scored";
  baselineYear: number;
  endYear: number;
  windowYears: number;
  reason: string;
}>;

const AREA_LABELS: Readonly<Record<GovernmentScorecardIndicator["area"], string>> = {
  "purchasing-power": "Potere d’acquisto",
  labour: "Lavoro",
  growth: "Crescita",
  "public-finance": "Finanza pubblica",
  "future-capacity": "Capacità futura",
};

let cachedSnapshot: GovernmentScorecardSnapshot | undefined;

export class GovernmentScorecardContractError extends Error {
  constructor(cause: unknown) {
    super("Lo snapshot della pagella economica non supera il contratto dati", { cause });
    this.name = "GovernmentScorecardContractError";
  }
}

export function getGovernmentScorecardSnapshot(): GovernmentScorecardSnapshot {
  if (cachedSnapshot) return cachedSnapshot;
  try {
    cachedSnapshot = parseGovernmentScorecardSnapshot(snapshotJson);
    return cachedSnapshot;
  } catch (error) {
    throw new GovernmentScorecardContractError(error);
  }
}

function rounded(value: number, digits = 1) {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function median(values: readonly number[]) {
  if (values.length === 0) throw new Error("mediana senza osservazioni");
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

function robustScore(value: number, distribution: readonly number[], scale: number, cap: number) {
  const center = median(distribution);
  const mad = median(distribution.map((item) => Math.abs(item - center)));
  if (mad === 0) throw new Error("dispersione storica nulla");
  const z = Math.max(-cap, Math.min(cap, (value - center) / (scale * mad)));
  return 100 * normalCdf(z);
}

// Abramowitz-Stegun 7.1.26: deterministic and sufficiently accurate for display scores.
function normalCdf(value: number) {
  const absolute = Math.abs(value);
  const t = 1 / (1 + 0.2316419 * absolute);
  const density = Math.exp(-(absolute * absolute) / 2) / Math.sqrt(2 * Math.PI);
  const polynomial = t * (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  const positive = 1 - density * polynomial;
  return value >= 0 ? positive : 1 - positive;
}

function valueAt(indicator: GovernmentScorecardIndicator, countryId: GovernmentScorecardCountryId, year: number) {
  const point = indicator.countries[countryId][year - 1960];
  return point?.year === year ? point.value : null;
}

function transformedChange(indicator: GovernmentScorecardIndicator, countryId: GovernmentScorecardCountryId, startYear: number, endYear: number) {
  const start = valueAt(indicator, countryId, startYear);
  const end = valueAt(indicator, countryId, endYear);
  if (start == null || end == null) return null;
  const direction = indicator.direction === "higher" ? 1 : -1;
  if (indicator.transformation === "log-change") {
    if (start <= 0 || end <= 0) return null;
    return direction * 100 * (Math.log(end) - Math.log(start));
  }
  return direction * (end - start);
}

function rawChange(indicator: GovernmentScorecardIndicator, startValue: number, endValue: number) {
  if (indicator.transformation === "log-change") return 100 * (Math.log(endValue) - Math.log(startValue));
  return endValue - startValue;
}

function peerChange(indicator: GovernmentScorecardIndicator, startYear: number, endYear: number, peerIds: readonly GovernmentScorecardCountryId[]) {
  const changes = peerIds.map((countryId) => transformedChange(indicator, countryId, startYear, endYear));
  if (changes.some((value) => value == null)) return null;
  return median(changes as number[]);
}

function calculateIndicators(
  snapshot: GovernmentScorecardSnapshot,
  baselineYear: number,
  endYear: number,
  peers: readonly GovernmentScorecardCountryId[],
) {
  const windowYears = endYear - baselineYear;
  return snapshot.indicators.map((indicator): IndicatorCalculation => {
      const baselineValue = valueAt(indicator, "italy", baselineYear);
      const endValue = valueAt(indicator, "italy", endYear);
      const oriented = transformedChange(indicator, "italy", baselineYear, endYear);
      const peersNow = peerChange(indicator, baselineYear, endYear, peers);
      if (baselineValue == null || endValue == null || oriented == null || peersNow == null) throw new Error(`dato mancante: ${indicator.id}`);

      const historicalWindows: number[] = [];
      const relativeWindows: number[] = [];
      for (let start = snapshot.method.firstScoreYear; start + windowYears <= snapshot.sources.ameco.observedThrough; start += 1) {
        const finish = start + windowYears;
        // No positive-duration overlap: the evaluated period must not help
        // define the distribution used to score itself.
        if (start < endYear && finish > baselineYear) continue;
        const italy = transformedChange(indicator, "italy", start, finish);
        const peer = peerChange(indicator, start, finish, peers);
        if (italy != null && peer != null) {
          historicalWindows.push(italy);
          relativeWindows.push(italy - peer);
        }
      }
      if (historicalWindows.length < 10 || relativeWindows.length < 10) throw new Error(`confronti insufficienti: ${indicator.id}`);
      const relative = oriented - peersNow;
      const historicalScore = robustScore(oriented, historicalWindows, snapshot.method.robustScale, snapshot.method.winsorizedZ);
      const relativeScore = robustScore(relative, relativeWindows, snapshot.method.robustScale, snapshot.method.winsorizedZ);
      const score = historicalScore * snapshot.method.historicalWeightBasisPoints / 10_000
        + relativeScore * snapshot.method.peerWeightBasisPoints / 10_000;
      const series = Array.from({ length: windowYears + 1 }, (_, index) => baselineYear + index).map((year) => {
        const italy = valueAt(indicator, "italy", year);
        const france = valueAt(indicator, "france", year);
        const germany = valueAt(indicator, "germany", year);
        const spain = valueAt(indicator, "spain", year);
        if (italy == null || france == null || germany == null || spain == null) throw new Error(`serie grafico incompleta: ${indicator.id}`);
        return { year, italy, france, germany, spain };
      });
      return {
        id: indicator.id,
        area: indicator.area,
        label: indicator.label,
        unit: indicator.unit,
        limitations: indicator.limitations,
        direction: indicator.direction,
        transformation: indicator.transformation,
        weightBasisPoints: indicator.weightBasisPoints,
        baselineValue,
        endValue,
        rawChange: rawChange(indicator, baselineValue, endValue),
        orientedChange: oriented,
        peerMedianChange: peersNow,
        relativeChange: relative,
        historicalScore: rounded(historicalScore),
        relativeScore: rounded(relativeScore),
        historicalWindowCount: historicalWindows.length,
        score: rounded(score),
        contributionPoints: rounded((score - 50) * indicator.weightBasisPoints / 10_000, 2),
        sourceCodes: indicator.sourceCodes,
        series,
      };
    });
}

function weightedScore(indicators: readonly IndicatorCalculation[]) {
  const weight = indicators.reduce((sum, indicator) => sum + indicator.weightBasisPoints, 0);
  if (weight <= 0) throw new Error("pesi del paniere non validi");
  return indicators.reduce((sum, indicator) => sum + indicator.score * indicator.weightBasisPoints, 0) / weight;
}

function robustnessChecks(
  snapshot: GovernmentScorecardSnapshot,
  baselineYear: number,
  endYear: number,
  indicators: readonly IndicatorCalculation[],
) {
  const peers = snapshot.method.peerCountryIds as readonly GovernmentScorecardCountryId[];
  const checks = [
    {
      id: "equal-weights",
      label: "Pesi uguali",
      score: indicators.reduce((sum, indicator) => sum + indicator.score, 0) / indicators.length,
    },
    ...indicators.map((excluded) => ({
      id: `without-indicator-${excluded.id}`,
      label: `Senza ${excluded.label}`,
      score: weightedScore(indicators.filter((indicator) => indicator.id !== excluded.id)),
    })),
    ...peers.map((excludedPeer) => ({
      id: `without-peer-${excludedPeer}`,
      label: `Senza ${excludedPeer === "france" ? "Francia" : excludedPeer === "germany" ? "Germania" : "Spagna"}`,
      score: weightedScore(calculateIndicators(
        snapshot,
        baselineYear,
        endYear,
        peers.filter((peer) => peer !== excludedPeer),
      )),
    })),
  ].map((check) => ({ ...check, score: rounded(check.score) }));
  const baseScore = weightedScore(indicators);
  const scores = [baseScore, ...checks.map((check) => check.score)];
  const maximumDeviation = Math.max(...scores.map((score) => Math.abs(score - baseScore)));
  return {
    minimumScore: rounded(Math.min(...scores)),
    maximumScore: rounded(Math.max(...scores)),
    maximumDeviation: rounded(maximumDeviation),
    label: maximumDeviation <= 5 ? "stabile" as const : maximumDeviation <= 10 ? "sensibile" as const : "molto sensibile" as const,
    checks,
  };
}

function scoreForWindow(snapshot: GovernmentScorecardSnapshot, baselineYear: number, endYear: number): ScoreCalculation {
  const windowYears = endYear - baselineYear;
  if (baselineYear < snapshot.method.firstScoreYear) {
    return { status: "not-scored", baselineYear, endYear, windowYears, reason: "La serie completa del Core parte dal 1995." };
  }
  if (windowYears < snapshot.method.minimumWindowYears) {
    return {
      status: "not-scored",
      baselineYear,
      endYear,
      windowYears,
      reason: "I dati annuali non contengono ancora un intervallo osservabile per questo mandato: la scheda resta disponibile, il risultato arriverà con le serie trimestrali.",
    };
  }
  const peers = snapshot.method.peerCountryIds as readonly GovernmentScorecardCountryId[];
  try {
    const indicators = calculateIndicators(snapshot, baselineYear, endYear, peers);
    const observedScore = indicators.reduce((sum, indicator) => sum + indicator.historicalScore * indicator.weightBasisPoints / 10_000, 0);
    const relativeScore = indicators.reduce((sum, indicator) => sum + indicator.relativeScore * indicator.weightBasisPoints / 10_000, 0);
    const score = indicators.reduce((sum, indicator) => sum + indicator.score * indicator.weightBasisPoints / 10_000, 0);
    const areas = [...new Set(indicators.map((indicator) => indicator.area))];
    const categories = areas.map((area) => {
      const members = indicators.filter((indicator) => indicator.area === area);
      const weightBasisPoints = members.reduce((sum, indicator) => sum + indicator.weightBasisPoints, 0);
      return {
        id: area,
        label: AREA_LABELS[area],
        weightBasisPoints,
        score: rounded(members.reduce((sum, indicator) => sum + indicator.score * indicator.weightBasisPoints, 0) / weightBasisPoints),
      };
    });
    return {
      status: "scored",
      baselineYear,
      endYear,
      windowYears,
      observedScore: rounded(observedScore),
      relativeScore: rounded(relativeScore),
      score: rounded(score),
      indicators,
      categories,
      robustness: robustnessChecks(snapshot, baselineYear, endYear, indicators),
    };
  } catch (error) {
    return {
      status: "not-scored",
      baselineYear,
      endYear,
      windowYears,
      reason: error instanceof Error ? error.message : "Dati insufficienti per un risultato difendibile.",
    };
  }
}

function endpointYears(government: GovernmentScorecardGovernment, observedThrough: number) {
  const startYear = Number(government.startDate.slice(0, 4));
  const startMonth = Number(government.startDate.slice(5, 7));
  const baselineYear = startMonth >= 7 ? startYear : startYear - 1;
  const endYear = government.endDate
    ? Number(government.endDate.slice(0, 4)) - (Number(government.endDate.slice(5, 7)) >= 7 ? 0 : 1)
    : observedThrough;
  return { baselineYear, endYear };
}

function scoreLabel(score: number) {
  if (score >= 80) return "molto positivo";
  if (score >= 65) return "positivo";
  if (score >= 50) return "misto";
  if (score >= 35) return "debole";
  return "molto debole";
}

function governmentView(snapshot: GovernmentScorecardSnapshot, government: GovernmentScorecardGovernment) {
  const years = endpointYears(government, snapshot.sources.ameco.observedThrough);
  const calculation = scoreForWindow(snapshot, years.baselineYear, years.endYear);
  const startYear = Number(government.startDate.slice(0, 4));
  const governmentEndYear = government.endDate ? Number(government.endDate.slice(0, 4)) : snapshot.sources.ameco.forecastThrough;
  const contexts = snapshot.contexts.filter((item) => item.startYear <= governmentEndYear && item.endYear >= startYear);
  const measures = snapshot.measures.filter((item) => item.government === government.name);
  const comparability = calculation.status === "not-scored"
    ? { grade: "ND" as const, label: "dati non confrontabili", reason: calculation.reason }
    : calculation.windowYears === 1 || government.status === "current" || contexts.some((item) => item.kind === "external-shock" || item.kind === "financial-shock")
      ? { grade: "C" as const, label: "dati indicativi", reason: calculation.windowYears === 1
        ? "La finestra annuale non isola con precisione i mesi del mandato."
        : "Serie annuali e shock rilevanti rendono il confronto meno preciso." }
      : { grade: "B" as const, label: "dati confrontabili", reason: "Paniere e peer sono completi, ma gli endpoint annuali approssimano le date del mandato." };
  return {
    ...government,
    calculation,
    scoreLabel: calculation.status === "scored" ? scoreLabel(calculation.score) : null,
    comparability,
    attribution: {
      status: "not-estimated" as const,
      label: "non stimata",
      reason: "Il Core descrive risultati osservati: non identifica il contributo causale del governo.",
    },
    contexts,
    measures,
  };
}

function inheritedTrend(snapshot: GovernmentScorecardSnapshot, baselineYear: number): ScoreCalculation {
  if (baselineYear <= snapshot.method.firstScoreYear) {
    return {
      status: "not-scored",
      baselineYear,
      endYear: baselineYear,
      windowYears: 0,
      reason: "La traiettoria precedente non è completa nel Core annuale dal 1995.",
    };
  }
  const startYear = Math.max(snapshot.method.firstScoreYear, baselineYear - 2);
  return scoreForWindow(snapshot, startYear, baselineYear);
}

function baselineIndicators(snapshot: GovernmentScorecardSnapshot, baselineYear: number) {
  return snapshot.indicators.flatMap((indicator) => {
    const value = valueAt(indicator, "italy", baselineYear);
    if (value == null) return [];
    return [{
      id: indicator.id,
      area: indicator.area,
      label: indicator.label,
      unit: indicator.unit,
      value,
      limitations: indicator.limitations,
    }];
  });
}

export function getGovernmentScorecardView() {
  const snapshot = getGovernmentScorecardSnapshot();
  const baseGovernments = snapshot.governments.map((government) => governmentView(snapshot, government));
  const governments = baseGovernments.map((government, index) => {
    const previous = index > 0 ? baseGovernments[index - 1]! : null;
    const successor = index + 1 < baseGovernments.length ? baseGovernments[index + 1]! : null;
    const baselineYear = government.calculation.baselineYear;
    const startYear = Number(government.startDate.slice(0, 4));
    return {
      ...government,
      inheritance: {
        previousGovernment: previous ? {
          id: previous.id,
          name: previous.name,
          endDate: previous.endDate,
        } : null,
        baselineYear,
        indicators: baselineIndicators(snapshot, baselineYear),
        trend: inheritedTrend(snapshot, baselineYear),
        activeContexts: snapshot.contexts.filter((item) => item.startYear < startYear && item.endYear >= startYear),
      },
      successorGovernment: successor ? {
        id: successor.id,
        name: successor.name,
        startDate: successor.startDate,
      } : null,
    };
  });
  const current = governments.find((government) => government.status === "current");
  if (!current) throw new GovernmentScorecardContractError(new Error("governo corrente assente"));
  const currentYears = endpointYears(current, snapshot.sources.ameco.observedThrough);
  const forecastCoverage = getGovernmentScorecardForecastCoverage(snapshot);
  const forecast = forecastCoverage.status === "complete"
    ? scoreForWindow(snapshot, currentYears.baselineYear, forecastCoverage.throughYear)
    : {
      status: "not-scored" as const,
      baselineYear: currentYears.baselineYear,
      endYear: forecastCoverage.throughYear,
      windowYears: forecastCoverage.throughYear - currentYears.baselineYear,
      reason: `Scenario non pubblicabile: copertura previsionale ${forecastCoverage.availableCells}/${forecastCoverage.requiredCells}.`,
    };
  return {
    ok: true as const,
    methodologyVersion: snapshot.methodologyVersion,
    generatedAt: snapshot.generatedAt,
    method: snapshot.method,
    sources: snapshot.sources,
    forecastCoverage,
    current: { ...current, forecast },
    governments,
    historicalContexts: snapshot.contexts.filter((item) => item.endYear < snapshot.method.firstScoreYear),
    caveats: snapshot.caveats,
    peerLabels: GOVERNMENT_SCORECARD_COUNTRY_IDS.filter((id) => id !== "italy").map((id) => ({
      id,
      label: id === "france" ? "Francia" : id === "germany" ? "Germania" : "Spagna",
    })),
  };
}

export function getGovernmentScorecardGovernmentView(id: string) {
  const view = getGovernmentScorecardView();
  if (view.current.id === id) return view.current;
  return view.governments.find((government) => government.id === id);
}

export type GovernmentScorecardView = ReturnType<typeof getGovernmentScorecardView>;
