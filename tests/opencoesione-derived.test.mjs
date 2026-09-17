import assert from "node:assert/strict";
import test from "node:test";
import "./helpers/register-ts-alias.mjs";

const { deriveOpenCoesioneDimension, openCoesioneSnapshot } = await import(
  "../src/lib/opencoesione-snapshot.ts"
);

test("OpenCoesione derived metrics are reconstructible from one dimension", () => {
  const transport = openCoesioneSnapshot.themes.find(
    (item) => item.label === "Trasporti e mobilità",
  );
  assert.ok(transport);
  const metrics = deriveOpenCoesioneDimension(
    transport,
    openCoesioneSnapshot.totals.publicCostCents,
  );
  assert.equal(
    metrics.costPaymentDifferenceCents,
    transport.publicCostCents - transport.paymentsCents,
  );
  assert.equal(
    metrics.averagePublicCostCents,
    Math.round(transport.publicCostCents / transport.projects),
  );
  assert.ok(metrics.publicCostShare > 0.28 && metrics.publicCostShare < 0.29);
  assert.ok(metrics.paymentCostRatio > 0.4 && metrics.paymentCostRatio < 0.41);
});

test("OpenCoesione derived metrics handle zero denominators and ratios over 100%", () => {
  const empty = deriveOpenCoesioneDimension(
    {
      slug: "vuoto",
      label: "Vuoto",
      sourceUrl: null,
      publicCostCents: 0,
      cohesionPublicCostCents: 0,
      paymentsCents: 0,
      cohesionPaymentsCents: 0,
      projects: 0,
    },
    0,
  );
  assert.equal(empty.publicCostShare, 0);
  assert.equal(empty.paymentCostRatio, 0);
  assert.equal(empty.averagePublicCostCents, null);

  const overOne = openCoesioneSnapshot.statuses
    .map((item) => deriveOpenCoesioneDimension(item, openCoesioneSnapshot.totals.publicCostCents))
    .find((item) => item.paymentCostRatio > 1);
  assert.ok(overOne, "a ratio above 100% must be preserved instead of silently capped");
});
