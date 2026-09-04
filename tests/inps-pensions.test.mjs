import assert from "node:assert/strict";
import test from "node:test";
import "./helpers/register-ts-alias.mjs";

const {
  inpsPensionsOsservatorioSnapshot,
  queryInpsPensionsOsservatorio,
} = await import("../src/lib/inps-pensions-snapshot.ts");
const {
  millionTenthsToCents,
  validateInpsPensionsOsservatorioSnapshot,
} = await import("../src/lib/data/inps-pensions-contract.ts");

test("lo snapshot INPS pensioni riconcilia stock, categorie, gestioni e serie 2026", () => {
  const snapshot = inpsPensionsOsservatorioSnapshot;
  assert.equal(snapshot.stock.pensionCount, 21_257_999);
  assert.equal(snapshot.stock.amountMillionTenths, 3_534_803);
  assert.equal(millionTenthsToCents(snapshot.stock.amountMillionTenths), 35_348_030_000_000);
  assert.equal(
    snapshot.nature.items[0].pensionCount + snapshot.nature.items[1].pensionCount,
    snapshot.stock.pensionCount,
  );
  assert.equal(
    snapshot.categories.items.reduce((sum, item) => sum + item.pensionCount, 0),
    snapshot.stock.pensionCount,
  );
  assert.equal(
    snapshot.managementGroups.items.reduce((sum, item) => sum + item.pensionCount, 0),
    snapshot.stock.pensionCount,
  );
  const latest = snapshot.stockSeries.observations.at(-1);
  assert.equal(latest.year, 2026);
  assert.equal(latest.total, snapshot.stock.pensionCount);
  assert.equal(snapshot.awardedIn2025.pensionCount, 1_540_943);
  assert.equal(snapshot.vintageCube.osservatorioId, "388");
});

test("le fonti INPS pensioni sono ufficiali, hashed e senza licenza IODL inventata", () => {
  for (const source of inpsPensionsOsservatorioSnapshot.sources) {
    assert.match(source.url, /^https:\/\/servizi2\.inps\.it\//);
    assert.match(source.sha256, /^[a-f0-9]{64}$/);
    assert.match(source.rightsNote, /non presentato come dataset IODL/i);
  }
  const landing = inpsPensionsOsservatorioSnapshot.sources.find((source) => source.id === "osservatorio-388");
  assert.equal(landing?.url, "https://servizi2.inps.it/servizi/osservatoristatistici/6/37/o/388");
});

test("la query INPS pensioni espone stock, serie e tavola 388 senza filtri inventati", () => {
  const result = queryInpsPensionsOsservatorio();
  assert.equal(result.datasetId, "inps-pensions-osservatorio");
  assert.equal(result.asOf, "2026-01-01");
  assert.equal(result.stock.pensionCount, 21_257_999);
  assert.equal(result.stockSeries.observations.length, 15);
  assert.match(result.vintageCube.url, /\/6\/37\/o\/388$/);
  assert.ok(result.caveats.some((item) => /Casellario ISTAT/.test(item)));
});

test("il contratto INPS pensioni rifiuta uno stock che non quadra", () => {
  const broken = structuredClone(inpsPensionsOsservatorioSnapshot);
  broken.stock.pensionCount = 1;
  assert.throws(
    () => validateInpsPensionsOsservatorioSnapshot(broken),
    /natura non riconcilia lo stock/,
  );
});
