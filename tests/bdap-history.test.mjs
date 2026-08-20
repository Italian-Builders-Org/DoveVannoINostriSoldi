import assert from "node:assert/strict";
import test from "node:test";
import { deriveStateSpendingHistoryPoints } from "../src/lib/data/bdap-history-points.ts";

function row(month, cumulativePaid) {
  return {
    dataset: {
      referenceMonth: month,
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
  assert.equal(points[2].cumulativePaid, 45);
});
