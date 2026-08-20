import assert from "node:assert/strict";
import test from "node:test";
import "./helpers/register-ts-alias.mjs";

const { anacCigSnapshot, getAnacCigSnapshot } = await import(
  "../src/lib/anac-cig-snapshot.ts"
);

test("ANAC CIG snapshot is complete, reconciled and carries source provenance", () => {
  assert.equal(anacCigSnapshot.schemaVersion, 1);
  assert.equal(anacCigSnapshot.referenceYear, 2025);
  assert.equal(anacCigSnapshot.coverage.completeYear, true);
  assert.deepEqual(
    anacCigSnapshot.coverage.observedMonths,
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
  );
  assert.equal(anacCigSnapshot.population.records, anacCigSnapshot.population.uniqueCigs);
  assert.ok(anacCigSnapshot.inputs.every((input) => /^[a-f0-9]{64}$/.test(input.sha256)));
  assert.deepEqual(
    anacCigSnapshot.inputs.map((input) => input.observedMonths[0]),
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
  );
  assert.ok(
    anacCigSnapshot.inputs.every((input) => {
      const page = new URL(input.resourcePageUrl);
      const download = new URL(input.resourceUrl);
      return page.hostname === "dati.anticorruzione.it" &&
        download.hostname === "dati.anticorruzione.it" &&
        input.sourceLastModified === "2026-01-16" &&
        input.sourcePublishedAt === null;
    }),
  );
  assert.match(anacCigSnapshot.provenance.catalogUrl, /^https:\/\/dati\.anticorruzione\.it\//);
  assert.equal(anacCigSnapshot.provenance.license, "CC BY-SA 4.0");
  assert.match(anacCigSnapshot.methodology.screeningOnly, /non provano/i);
});

test("ANAC snapshot lookup fails closed outside the verified year", () => {
  assert.equal(getAnacCigSnapshot(2025), anacCigSnapshot);
  assert.throws(() => getAnacCigSnapshot(2024), /solo per il 2025/);
});
