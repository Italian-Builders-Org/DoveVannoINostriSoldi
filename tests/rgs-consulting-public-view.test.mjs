import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import "./helpers/register-ts-alias.mjs";

const {
  validateRgsConsultingSnapshot,
} = await import("../src/lib/rgs-consulting-contract.ts");
const {
  formatRgsEuroCents,
  getRgsConsultingSourceHealth,
  queryRgsConsulting,
  rgsConsultingAdministrations,
  RgsConsultingQueryError,
  rgsConsultingSnapshot,
} = await import("../src/lib/rgs-consulting-snapshot.ts");

const page = fs.readFileSync(
  new URL("../src/app/spese/consulenze/page.tsx", import.meta.url),
  "utf8",
);
const css = fs.readFileSync(
  new URL("../src/app/spese/consulenze/consulenze.module.css", import.meta.url),
  "utf8",
);

test("RGS consulting snapshot preserves exact coverage, source locks and cash reconciliation", () => {
  assert.equal(rgsConsultingSnapshot.rows.length, 268);
  assert.equal(rgsConsultingSnapshot.coverage.sourceRows, 26_226);
  assert.equal(rgsConsultingSnapshot.coverage.paidCashCents, 11_357_039_641);
  assert.equal(rgsConsultingSnapshot.coverage.zeroPaidRows, 153);
  assert.deepEqual(
    rgsConsultingSnapshot.coverage.annual.map((annual) => ({
      year: annual.year,
      rows: annual.selectedRows,
      zero: annual.zeroPaidRows,
      paid: annual.paidCashCents,
    })),
    [
      { year: 2024, rows: 132, zero: 79, paid: 5_057_491_173 },
      { year: 2025, rows: 136, zero: 74, paid: 6_299_548_468 },
    ],
  );
  assert.ok(
    rgsConsultingSnapshot.rows.every(
      (row) => row.paidCashCents === row.paidCurrentCents + row.paidResidualCents,
    ),
  );

  const health = getRgsConsultingSourceHealth();
  assert.deepEqual(health.artifact, {
    schemaVersion: 1,
    bytes: 279_635,
    sha256: "5997f6c02b1e83bd9a8ab9974b0cf0573584b48fc72b8b69633218c3df5e5650",
  });
  assert.equal(health.resources.length, 2);
  assert.deepEqual(health.resources.map((resource) => resource.year), [2024, 2025]);
  assert.ok(health.resources.every((resource) => /^[a-f0-9]{64}$/.test(resource.sourceSha256)));
  assert.ok(health.resources.every((resource) => resource.landingUrl.startsWith("https://bdap-opendata.rgs.mef.gov.it/")));
});

test("RGS consulting queries filter by exact year and administration with bounded pagination", () => {
  const administration = rgsConsultingAdministrations[0];
  const filtered = queryRgsConsulting({
    year: "2024",
    administration,
    limit: "2",
    offset: "0",
  });
  assert.equal(filtered.pagination.limit, 2);
  assert.ok(filtered.pagination.total > 0);
  assert.ok(filtered.rows.every((row) => row.year === 2024));
  assert.ok(filtered.rows.every((row) => row.administration === administration));
  assert.equal(
    filtered.totals.paidCashCents,
    rgsConsultingSnapshot.rows
      .filter((row) => row.year === 2024 && row.administration === administration)
      .reduce((sum, row) => sum + row.paidCashCents, 0),
  );

  assert.throws(
    () => queryRgsConsulting({ year: ["2024", "2025"] }),
    (error) => error instanceof RgsConsultingQueryError && /una sola volta/.test(error.message),
  );
  assert.throws(
    () => queryRgsConsulting({ year: "2026" }),
    (error) => error instanceof RgsConsultingQueryError && /non disponibile/.test(error.message),
  );
  assert.throws(
    () => queryRgsConsulting({ limit: 101 }),
    (error) => error instanceof RgsConsultingQueryError && /tra 1 e 100/.test(error.message),
  );
  assert.throws(
    () => queryRgsConsulting({ administration: "Amministrazione inventata" }),
    (error) => error instanceof RgsConsultingQueryError && /non presente/.test(error.message),
  );
});

test("zero remains observed and cannot be confused with a missing amount", () => {
  const observedZero = rgsConsultingSnapshot.rows.find((row) => row.paidCashCents === 0);
  assert.ok(observedZero);
  assert.equal(observedZero.paidCurrentCents, 0);
  assert.equal(observedZero.paidResidualCents, 0);
  assert.equal(formatRgsEuroCents(0), "0,00 €");
  assert.equal(formatRgsEuroCents(11_357_039_641), "113.570.396,41 €");

  const missingAmount = structuredClone(rgsConsultingSnapshot);
  missingAmount.rows[0].paidCashCents = null;
  assert.throws(() => validateRgsConsultingSnapshot(missingAmount));
});

test("RGS consulting contract fails closed on source, caveat and row drift", () => {
  const sourceDrift = structuredClone(rgsConsultingSnapshot);
  sourceDrift.source.resources[0].sourceSha256 = "0".repeat(64);
  assert.throws(
    () => validateRgsConsultingSnapshot(sourceDrift),
    /identità o hash delle risorse ufficiali divergenti/,
  );

  const reconciliationDrift = structuredClone(rgsConsultingSnapshot);
  reconciliationDrift.rows[0].paidCashCents += 1;
  assert.throws(
    () => validateRgsConsultingSnapshot(reconciliationDrift),
    /Pagato CS non riconciliato/,
  );

  const caveatDrift = structuredClone(rgsConsultingSnapshot);
  caveatDrift.caveats[0] = "Sono incarichi individuali.";
  assert.throws(() => validateRgsConsultingSnapshot(caveatDrift));
});

test("RGS consulting page awaits GET filters and keeps the accounting boundary visible", () => {
  assert.match(page, /searchParams: Promise/);
  assert.match(page, /const params = await searchParams/);
  assert.match(page, /name="anno"/);
  assert.match(page, /name="amministrazione"/);
  assert.match(page, /name="limit"/);
  assert.match(page, /aggregati contabili per capitolo e piano di gestione/i);
  assert.match(page, /non identifica[\s\S]*consulenti, beneficiari, contratti o singole prestazioni/i);
  assert.match(page, /zero osservato/);
  assert.match(page, /non prova efficienza, irregolarità o spreco/i);
  assert.match(page, /resource\.landingUrl/);
  assert.match(page, /resource\.schemaUrl/);
  assert.match(page, /role="region"/);
  assert.match(page, /<caption>/);
  assert.match(page, /<th scope="col">/);
  assert.match(page, /<th scope="row">/);
  assert.match(css, /min-width: 1040px/);
  assert.match(css, /@media \(max-width: 620px\)/);
});
