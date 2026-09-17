const MONTH_NAMES = [
  "GENNAIO", "FEBBRAIO", "MARZO", "APRILE", "MAGGIO", "GIUGNO",
  "LUGLIO", "AGOSTO", "SETTEMBRE", "OTTOBRE", "NOVEMBRE", "DICEMBRE",
] as const;

export type HistoryDatasetWithTotal = {
  dataset: {
    releaseKind: "monthly";
    referenceMonth: number;
    productCode: string;
    packageId: string;
    csvUrl: string;
    metadataModified: string | null;
  };
  cumulativePaid: number;
};

export function deriveStateSpendingHistoryPoints(
  year: number,
  values: HistoryDatasetWithTotal[],
) {
  if (values.some(({ dataset }) => dataset.releaseKind !== "monthly")) {
    throw new Error("Lo storico OpenBDAP accetta soltanto rilasci mensili");
  }

  const ordered = [...values].sort(
    (left, right) => left.dataset.referenceMonth - right.dataset.referenceMonth,
  );

  return ordered.map(({ dataset, cumulativePaid }, index) => {
    const previous = ordered[index - 1];
    const isJanuary = dataset.referenceMonth === 1;
    const followsPreviousMonth =
      previous?.dataset.referenceMonth === dataset.referenceMonth - 1;
    const monthlyPaid = isJanuary
      ? cumulativePaid
      : followsPreviousMonth
        ? cumulativePaid - previous.cumulativePaid
        : null;
    const monthName =
      MONTH_NAMES[dataset.referenceMonth - 1] ?? `MESE ${dataset.referenceMonth}`;

    return {
      year,
      month: dataset.referenceMonth,
      monthName,
      label: monthName.slice(0, 3),
      cumulativePaid,
      monthlyPaid,
      source: {
        releaseKind: "monthly" as const,
        productCode: dataset.productCode,
        packageId: dataset.packageId,
        csvUrl: dataset.csvUrl,
        metadataModified: dataset.metadataModified,
      },
    };
  });
}
