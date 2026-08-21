import assert from "node:assert/strict";
import test from "node:test";
import { deriveStateSpendingHistoryPoints } from "../src/lib/data/bdap-history-points.ts";

function row(month, cumulativePaid) {
  return {
    dataset: {
      referenceMonth: month,
      releaseKind: "monthly",
      productCode: `M${month}`,
      packageId: `package-${month}`,
      csvUrl: `https://example.test/${month}.csv`,
      metadataModified: null,
    },
    cumulativePaid,
  };
}

test("OpenBDAP history keeps available months and never bridges a missing month", () => {
  const points = deriveStateSpendingHistoryPoints(2026, [
    row(4, 45),
    row(1, 10),
    row(2, 25),
  ]);

  assert.deepEqual(points.map((point) => point.month), [1, 2, 4]);
  assert.deepEqual(points.map((point) => point.monthlyPaid), [10, 15, null]);
  assert.deepEqual(points.map((point) => point.source.releaseKind), ["monthly", "monthly", "monthly"]);
  assert.equal(points[2].cumulativePaid, 45);
});

test("OpenBDAP history rejects an annual release instead of mixing series", () => {
  assert.throws(
    () => deriveStateSpendingHistoryPoints(2025, [{
      dataset: {
        referenceMonth: null,
        releaseKind: "consuntivo",
        productCode: "PBS_SPE_RND_MISS_001",
        packageId: "package-annual",
        csvUrl: "https://example.test/annual.csv",
        metadataModified: null,
      },
      cumulativePaid: 10,
    }]),
    /soltanto rilasci mensili/,
  );
});
