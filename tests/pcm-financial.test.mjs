import assert from "node:assert/strict";
import test from "node:test";
import data from "../src/data/generated/pcm-financial-2024.data.json" with { type: "json" };
import metadata from "../src/data/generated/pcm-financial-2024.meta.json" with { type: "json" };
import { validatePcmFinancialSnapshot } from "../src/lib/data/pcm-financial-contract.ts";

test("PCM financial account preserves scope, phases and source provenance", () => {
  const snapshot = validatePcmFinancialSnapshot(data, metadata);
  assert.equal(snapshot.data.referenceYear, 2024);
  assert.equal(snapshot.data.totals.paymentsTotalCents, 539_176_988_709);
  assert.equal(snapshot.data.totals.commitmentsCents, 664_400_454_051);
  assert.equal(snapshot.data.coverage.sourceRows, 572);
  assert.equal(snapshot.metadata.asset.sha256, "7944cb81a7e9f151b44bb5577d380cd8adf9671ddbebcc1ad530b91b90615603");
  assert.equal(snapshot.metadata.source.licenseStatus, "not-declared");
});

test("PCM financial account fails closed on reconciliation or provenance drift", () => {
  assert.throws(
    () => validatePcmFinancialSnapshot({
      ...data,
      totals: { ...data.totals, paymentsTotalCents: data.totals.paymentsTotalCents + 1 },
    }, metadata),
    /pagamenti totali non riconciliati/,
  );
  assert.throws(
    () => validatePcmFinancialSnapshot(data, {
      ...metadata,
      source: { ...metadata.source, licenseStatus: "declared" },
    }),
    /licenza non verificata attribuita/,
  );
});
