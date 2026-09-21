import assert from "node:assert/strict";
import test from "node:test";
import "./helpers/register-ts-alias.mjs";

const { queryEurostatArope, eurostatAropeData, eurostatAropeMetadata } = await import(
  "../src/lib/eurostat-arope-snapshot.ts"
);

test("bundle AROPE valida e dichiara soldi assenti", () => {
  assert.equal(eurostatAropeData.datasetId, "eurostat-arope");
  assert.equal(eurostatAropeData.observations.length, 11);
  assert.equal(eurostatAropeMetadata.semantics.soldi.present, false);
  assert.equal(eurostatAropeMetadata.source.licenseId, "CC-BY-4.0");
  assert.equal(eurostatAropeMetadata.source.dataflowId, "ilc_peps01n");
});

test("query richiede un filtro e rifiuta territori non IT", () => {
  assert.throws(() => queryEurostatArope({}), /almeno un filtro/);
  assert.throws(() => queryEurostatArope({ territory: "FR" }), /solo Italia/);
  assert.throws(() => queryEurostatArope({ year: 2010 }), /periodo coperto/);
});

test("query Italia 2025 espone tasso e persone senza 2020-strategy mix", () => {
  const result = queryEurostatArope({ territory: "IT", year: 2025 });
  assert.equal(result.observations.length, 1);
  assert.equal(result.observations[0].rateTenths, 226);
  assert.equal(result.observations[0].personsThousands, 13265);
  assert.match(result.periodNote, /Europa 2030/);
  assert.ok(result.caveats.some((c) => /34_727|povertà assoluta/i.test(c)));
});

test("serie nazionale completa ha 11 anni", () => {
  const result = queryEurostatArope({ territory: "IT" });
  assert.equal(result.pagination.total, 11);
  assert.deepEqual(
    result.observations.map((row) => row.year),
    [2015, 2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025],
  );
});
