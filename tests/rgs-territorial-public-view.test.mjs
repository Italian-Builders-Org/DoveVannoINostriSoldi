import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import "./helpers/register-ts-alias.mjs";

const {
  validateRgsTerritorialSnapshot,
} = await import("../src/lib/rgs-territorial-contract.ts");
const {
  formatRgsTerritorialValue,
  getRgsTerritorialSourceHealth,
  queryRgsTerritorial,
  rgsTerritorialSnapshot,
  RgsTerritorialQueryError,
} = await import("../src/lib/rgs-territorial-snapshot.ts");

const page = fs.readFileSync(
  new URL("../src/app/spese/territoriale/page.tsx", import.meta.url),
  "utf8",
);
const css = fs.readFileSync(
  new URL("../src/app/spese/territoriale/territoriale.module.css", import.meta.url),
  "utf8",
);

test("RGS territorial snapshot locks 20,268 measurements and its official source", () => {
  assert.equal(rgsTerritorialSnapshot.rows.length, 5_067);
  assert.equal(rgsTerritorialSnapshot.coverage.dimensionRows, 5_067);
  assert.equal(rgsTerritorialSnapshot.coverage.sourceRows, 20_268);
  assert.equal(rgsTerritorialSnapshot.dimensions.measures.length, 4);
  assert.deepEqual(
    rgsTerritorialSnapshot.coverage.byMeasure.map((measure) => measure.sourceRows),
    [5_067, 5_067, 5_067, 5_067],
  );
  assert.equal(rgsTerritorialSnapshot.coverage.zeroValues, 3_880);

  const health = getRgsTerritorialSourceHealth();
  assert.deepEqual(health.artifact, {
    schemaVersion: 1,
    bytes: 405_199,
    sha256: "e9599e06e61ed09658ba7136dd6fb1fc9f8b13f2e1998fd84b3c8b384433a01e",
  });
  assert.equal(health.source.recordId, "SRS_SPE_BIL_SPESR_001");
  assert.equal(health.source.sourceBytes, 3_933_609);
  assert.equal(
    health.source.sourceSha256,
    "bf37c613ea9d467a95618684b0cd69cf332e276792e67e6c985358173b01cf16",
  );
  assert.equal(health.source.licenseStatus, "not_declared");
});

test("territorial queries decode dimensions and never mix territory levels or measures", () => {
  const regions = queryRgsTerritorial({ level: "region", measure: "absolute", limit: 100 });
  assert.ok(regions.rows.length > 0);
  assert.ok(regions.rows.every((row) => row.level === "region"));
  assert.ok(regions.rows.every((row) => row.measureId === "absolute"));
  assert.ok(regions.rows.every((row) => !/^\d+$/.test(row.category)));
  assert.ok(regions.rows.every((row) => !/^\d+$/.test(row.mission)));
  assert.equal(Object.hasOwn(regions, "total"), false);

  const italy = queryRgsTerritorial({
    level: "national",
    territory: "ITALIA",
    measure: "gdp-share",
    limit: 100,
  });
  assert.ok(italy.rows.length > 0);
  assert.ok(italy.rows.every((row) => row.territory === "ITALIA"));
  assert.ok(italy.rows.every((row) => row.level === "national"));
  assert.ok(italy.rows.every((row) => row.measureId === "gdp-share"));

  assert.throws(
    () => queryRgsTerritorial({ level: "region", territory: "ITALIA" }),
    (error) => error instanceof RgsTerritorialQueryError && /non appartiene/.test(error.message),
  );
  assert.throws(
    () => queryRgsTerritorial({ measure: ["absolute", "gdp-share"] }),
    (error) => error instanceof RgsTerritorialQueryError && /una sola volta/.test(error.message),
  );
  assert.throws(
    () => queryRgsTerritorial({ limit: 101 }),
    (error) => error instanceof RgsTerritorialQueryError && /tra 1 e 100/.test(error.message),
  );
});

test("territorial values keep integer storage and exact scale without float", () => {
  assert.equal(formatRgsTerritorialValue(805_770, "absolute"), "8.057,70 mln €");
  assert.equal(formatRgsTerritorialValue(123, "gdp-share"), "1,23%");
  assert.equal(formatRgsTerritorialValue(0, "per-inhabitant"), "0,00 €");
  assert.equal(formatRgsTerritorialValue(83_080, "per-square-kilometre"), "830,80 €");

  const first = queryRgsTerritorial({ limit: 1 }).rows[0];
  assert.ok(Number.isSafeInteger(first.value));
  assert.equal(typeof first.formattedValue, "string");
});

test("national, macroarea and region reconciliations remain separate", () => {
  const reconciliation = rgsTerritorialSnapshot.reconciliation;
  assert.equal(reconciliation.nationalHundredthsMillionEur, 29_735_168);
  assert.equal(reconciliation.macroareasHundredthsMillionEur, 29_735_164);
  assert.equal(reconciliation.regionsHundredthsMillionEur, 29_735_159);
  assert.equal(reconciliation.macroareaDeltaHundredthsMillionEur, -4);
  assert.equal(reconciliation.regionDeltaHundredthsMillionEur, -9);
  assert.notEqual(
    reconciliation.nationalHundredthsMillionEur + reconciliation.macroareasHundredthsMillionEur,
    reconciliation.regionsHundredthsMillionEur,
  );
});

test("RGS territorial contract fails closed on dimensions, source, caveat and reconciliation drift", () => {
  const sourceDrift = structuredClone(rgsTerritorialSnapshot);
  sourceDrift.source.sourceSha256 = "0".repeat(64);
  assert.throws(() => validateRgsTerritorialSnapshot(sourceDrift));

  const dimensionDrift = structuredClone(rgsTerritorialSnapshot);
  dimensionDrift.rows[0].territory = 99;
  assert.throws(
    () => validateRgsTerritorialSnapshot(dimensionDrift),
    /indice territorio fuori dominio/,
  );

  const reconciliationDrift = structuredClone(rgsTerritorialSnapshot);
  reconciliationDrift.rows[0].values[0] += 1;
  assert.throws(
    () => validateRgsTerritorialSnapshot(reconciliationDrift),
    /non riconciliato|non riconciliate/,
  );

  const caveatDrift = structuredClone(rgsTerritorialSnapshot);
  caveatDrift.caveats[1] = "I livelli possono essere sommati.";
  assert.throws(() => validateRgsTerritorialSnapshot(caveatDrift));
});

test("RGS territorial page awaits GET filters and exposes non-additivity and denominators", () => {
  assert.match(page, /searchParams: Promise/);
  assert.match(page, /const params = await searchParams/);
  assert.match(page, /name="livello"/);
  assert.match(page, /name="territorio"/);
  assert.match(page, /name="misura"/);
  assert.match(page, /name="limit"/);
  assert.match(page, /non\s+devono essere sommati insieme/i);
  assert.match(page, /denominatori calcolati[\s\S]*non versionati/i);
  assert.match(page, /formatRgsTerritorialValue/);
  assert.match(page, /Interessi e debito/i);
  assert.match(page, /8\.057,70 milioni/);
  assert.match(page, /source\.landingUrl/);
  assert.match(page, /source\.csvUrl/);
  assert.match(page, /source\.schemaUrl/);
  assert.match(page, /role="region"/);
  assert.match(page, /<caption>/);
  assert.match(page, /<th scope="col">/);
  assert.match(page, /<th scope="row">/);
  assert.match(css, /min-width: 980px/);
  assert.match(css, /@media \(max-width: 620px\)/);
});
