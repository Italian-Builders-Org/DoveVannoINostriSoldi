import {
  discoverLatestStatePaymentDataset,
  getStatePaymentDatasetForPeriod,
  getStatePaymentDatasetTotal,
  type MonthlyBdapDataset,
} from "@/lib/bdap-payments";
import { deriveStateSpendingHistoryPoints } from "@/lib/data/bdap-history-points";

const MONTH_NAMES = [
  "GENNAIO",
  "FEBBRAIO",
  "MARZO",
  "APRILE",
  "MAGGIO",
  "GIUGNO",
  "LUGLIO",
  "AGOSTO",
  "SETTEMBRE",
  "OTTOBRE",
  "NOVEMBRE",
  "DICEMBRE",
] as const;

export type StateSpendingHistoryPoint = {
  year: number;
  month: number;
  monthName: string;
  label: string;
  cumulativePaid: number;
  monthlyPaid: number | null;
  source: {
    releaseKind: "monthly";
    productCode: string;
    packageId: string;
    csvUrl: string;
    metadataModified: string | null;
  };
};

export type StateSpendingHistory = {
  year: number;
  latestMonth: number;
  latestMonthName: string;
  points: StateSpendingHistoryPoint[];
  observedAt: string;
  coverage: {
    requestedMonths: number;
    availableMonths: number;
    monthlyValues: number;
    missingMonths: string[];
  };
  methodology: {
    cumulative: true;
    monthlyDerivation: "difference-between-consecutive-cumulative-snapshots";
    officialSemanticsUrl: string;
  };
};

type DatasetWithTotal = { dataset: MonthlyBdapDataset; cumulativePaid: number };

export const STATE_SPENDING_HISTORY_DEADLINE_MS = 8_000;
export const STATE_SPENDING_HISTORY_MAX_CONCURRENCY = 3;

type StateSpendingHistoryOptions = {
  signal?: AbortSignal;
  deadlineMs?: number;
  concurrency?: number;
  now?: Date;
};

async function mapSettledBounded<T, R>(
  items: readonly T[],
  concurrency: number,
  signal: AbortSignal,
  worker: (item: T, signal: AbortSignal) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
  const results = new Array<PromiseSettledResult<R>>(items.length);
  let cursor = 0;

  async function runWorker(): Promise<void> {
    while (cursor < items.length) {
      signal.throwIfAborted();
      const index = cursor;
      cursor += 1;
      try {
        results[index] = {
          status: "fulfilled",
          value: await worker(items[index], signal),
        };
      } catch (error) {
        if (signal.aborted) throw signal.reason;
        results[index] = { status: "rejected", reason: error };
      }
    }
  }

  const workerCount = Math.min(concurrency, items.length);
  await Promise.all(Array.from({ length: workerCount }, () => runWorker()));
  return results;
}

export async function getStateSpendingHistory(
  options: StateSpendingHistoryOptions = {},
): Promise<StateSpendingHistory> {
  const requestedDeadline = options.deadlineMs ?? STATE_SPENDING_HISTORY_DEADLINE_MS;
  if (!Number.isFinite(requestedDeadline) || requestedDeadline <= 0) {
    throw new Error("Deadline storico OpenBDAP non valida");
  }
  const requestedConcurrency = options.concurrency ?? STATE_SPENDING_HISTORY_MAX_CONCURRENCY;
  if (!Number.isFinite(requestedConcurrency) || requestedConcurrency < 1) {
    throw new Error("Concorrenza storico OpenBDAP non valida");
  }

  const deadline = AbortSignal.timeout(Math.trunc(requestedDeadline));
  const signal = options.signal
    ? AbortSignal.any([options.signal, deadline])
    : deadline;
  signal.throwIfAborted();

  const latest = await discoverLatestStatePaymentDataset("mission", {
    signal,
    ...(options.now ? { now: options.now } : {}),
  });
  const year = latest.referenceYear;
  const latestMonth = latest.referenceMonth;
  const months = Array.from({ length: latestMonth }, (_, index) => index + 1);
  const concurrency = Math.min(
    months.length,
    Math.max(1, Math.trunc(requestedConcurrency)),
  );

  const datasetResults = await mapSettledBounded(
    months,
    concurrency,
    signal,
    async (month, workSignal) => {
      return month === latestMonth
        ? Promise.resolve(latest)
        : getStatePaymentDatasetForPeriod("mission", year, month, { signal: workSignal });
    },
  );

  const datasets = datasetResults
    .map((result) => (result.status === "fulfilled" ? result.value : null))
    .filter((dataset): dataset is MonthlyBdapDataset => dataset !== null);

  const totalResults = await mapSettledBounded(
    datasets,
    Math.min(concurrency, datasets.length),
    signal,
    async (dataset, workSignal) => ({
      dataset,
      cumulativePaid: await getStatePaymentDatasetTotal(dataset, { signal: workSignal }),
    }),
  );

  const values = totalResults
    .filter((result): result is PromiseFulfilledResult<DatasetWithTotal> =>
      result.status === "fulfilled",
    )
    .map((result) => result.value);
  const points = deriveStateSpendingHistoryPoints(year, values);
  const available = new Set(points.map((point) => point.month));
  const missingMonths = Array.from({ length: latestMonth }, (_, index) => index + 1)
    .filter((month) => !available.has(month))
    .map((month) => MONTH_NAMES[month - 1] ?? `MESE ${month}`);

  return {
    year,
    latestMonth,
    latestMonthName: MONTH_NAMES[latestMonth - 1] ?? `MESE ${latestMonth}`,
    points,
    observedAt: new Date().toISOString(),
    coverage: {
      requestedMonths: latestMonth,
      availableMonths: points.length,
      monthlyValues: points.filter((point) => point.monthlyPaid !== null).length,
      missingMonths,
    },
    methodology: {
      cumulative: true,
      monthlyDerivation: "difference-between-consecutive-cumulative-snapshots",
      officialSemanticsUrl: "https://openbdap.rgs.mef.gov.it/it/News/Index/638",
    },
  };
}
