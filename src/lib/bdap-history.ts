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

export async function getStateSpendingHistory(): Promise<StateSpendingHistory> {
  const latest = await discoverLatestStatePaymentDataset("mission");
  const year = latest.referenceYear;
  const latestMonth = latest.referenceMonth;

  const datasetResults = await Promise.allSettled(
    Array.from({ length: latestMonth }, (_, index) => {
      const month = index + 1;
      return month === latestMonth
        ? Promise.resolve(latest)
        : getStatePaymentDatasetForPeriod("mission", year, month);
    }),
  );

  const datasets = datasetResults
    .map((result) => (result.status === "fulfilled" ? result.value : null))
    .filter((dataset): dataset is MonthlyBdapDataset => dataset !== null);

  const totalResults = await Promise.allSettled(
    datasets.map(async (dataset) => ({
      dataset,
      cumulativePaid: await getStatePaymentDatasetTotal(dataset),
    })),
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
