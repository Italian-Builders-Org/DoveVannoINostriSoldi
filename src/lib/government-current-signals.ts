import snapshotJson from "@/data/generated/government-current-signals.json";
import {
  parseGovernmentCurrentSignalsSnapshot,
  type GovernmentCurrentSignalIndicator,
  type GovernmentCurrentSignalsSnapshot,
} from "@/lib/data/government-current-signals-contract";

let cachedSnapshot: GovernmentCurrentSignalsSnapshot | undefined;

export class GovernmentCurrentSignalsContractError extends Error {
  constructor(cause: unknown) {
    super("Lo snapshot dei segnali correnti non supera il contratto dati", { cause });
    this.name = "GovernmentCurrentSignalsContractError";
  }
}

export function getGovernmentCurrentSignalsSnapshot(): GovernmentCurrentSignalsSnapshot {
  if (cachedSnapshot) return cachedSnapshot;
  try {
    cachedSnapshot = parseGovernmentCurrentSignalsSnapshot(snapshotJson);
    return cachedSnapshot;
  } catch (error) {
    throw new GovernmentCurrentSignalsContractError(error);
  }
}

function rounded(value: number, digits = 1) {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function median(values: readonly number[]) {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]!
    : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

function cumulativeChange(start: number, end: number) {
  return 100 * (end / start - 1);
}

function indicatorView(indicator: GovernmentCurrentSignalIndicator) {
  const italyStart = indicator.countries.italy[0]!.index;
  const peerStarts = {
    france: indicator.countries.france[0]!.index,
    germany: indicator.countries.germany[0]!.index,
    spain: indicator.countries.spain[0]!.index,
  };
  const latest = indicator.countries.italy.at(-1)!;
  const latestIndex = indicator.countries.italy.length - 1;
  const series = indicator.countries.italy.map((point, index) => ({
    period: point.period,
    italy: rounded(cumulativeChange(italyStart, point.index), 2),
    peer: rounded(median([
      cumulativeChange(peerStarts.france, indicator.countries.france[index]!.index),
      cumulativeChange(peerStarts.germany, indicator.countries.germany[index]!.index),
      cumulativeChange(peerStarts.spain, indicator.countries.spain[index]!.index),
    ]), 2),
  }));
  const peerCumulativeChange = series.at(-1)!.peer;
  const peerAnnualRate = median([
    indicator.countries.france[latestIndex]!.annualRate,
    indicator.countries.germany[latestIndex]!.annualRate,
    indicator.countries.spain[latestIndex]!.annualRate,
  ]);
  const italyCumulativeChange = series.at(-1)!.italy;
  return {
    id: indicator.id,
    label: indicator.label,
    question: indicator.question,
    limitations: indicator.limitations,
    latestAnnualRate: rounded(latest.annualRate),
    peerMedianAnnualRate: rounded(peerAnnualRate),
    cumulativeChange: rounded(italyCumulativeChange),
    peerMedianCumulativeChange: rounded(peerCumulativeChange),
    cumulativeDistanceFromPeers: rounded(italyCumulativeChange - peerCumulativeChange),
    series,
  };
}

export function getGovernmentCurrentSignalsView() {
  const snapshot = getGovernmentCurrentSignalsSnapshot();
  return {
    ok: true as const,
    methodologyVersion: snapshot.methodologyVersion,
    generatedAt: snapshot.generatedAt,
    startPeriod: snapshot.governmentStartPeriod,
    latestPeriod: snapshot.source.referencePeriodThrough,
    source: snapshot.source,
    indicators: snapshot.indicators.map(indicatorView),
    caveats: snapshot.caveats,
    scoringStatus: "not-scored" as const,
  };
}

export type GovernmentCurrentSignalsView = ReturnType<typeof getGovernmentCurrentSignalsView>;
