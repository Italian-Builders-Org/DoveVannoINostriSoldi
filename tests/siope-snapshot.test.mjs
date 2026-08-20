import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const snapshotUrl = new URL("../src/data/generated/siope-municipal.json", import.meta.url);
const historicalSnapshotUrls = [
  new URL("../src/data/generated/siope-municipal-2024.json", import.meta.url),
  new URL("../src/data/generated/siope-municipal-2025.json", import.meta.url),
  snapshotUrl,
];

async function loadSnapshot() {
  return JSON.parse(await readFile(snapshotUrl, "utf8"));
}

function sum(values) {
  return values.reduce((total, value) => total + value, 0);
}

function assertMoneyClose(actual, expected, tolerance = 0.25) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `expected ${actual} to be within ${tolerance} of ${expected}`,
  );
}

test("SIOPE snapshot exposes a complete national municipal aggregation", async () => {
  const data = await loadSnapshot();

  assert.equal(data.schemaVersion, 2);
  assert.equal(data.scope, "municipalities");
  assert.equal(data.regions.length, 20);
  assert.ok(data.coverage.activeSiopeMunicipalities > 7_000);
  assert.ok(data.coverage.withMovements > 7_000);
  assert.ok(data.coverage.withMovements <= data.coverage.activeSiopeMunicipalities);
  assert.equal(data.coverage.malformedRows, 0);
  assert.equal(
    data.coverage.withPopulation + data.coverage.withoutPopulation,
    data.coverage.withMovements,
  );
  assert.ok(data.source.siopeMovementsLastModified);
  assert.ok(data.source.siopeRegistryLastModified);
  assert.ok(data.source.ipaLastModified);
  assert.match(data.methodology.populationReference, /non dichiarata/i);
  assert.equal(
    data.methodology.populationSourceLastModified,
    data.source.siopeRegistryLastModified,
  );
});

test("monthly flows, regional totals and headline total reconcile", async () => {
  const data = await loadSnapshot();
  const monthlyTotal = sum(data.monthly.map((point) => point.flow));
  const regionalTotal = sum(data.regions.map((region) => region.value));
  const lastCumulative = data.monthly.at(-1)?.cumulative;

  assertMoneyClose(monthlyTotal, data.totalPaid);
  assertMoneyClose(regionalTotal, data.totalPaid);
  assertMoneyClose(lastCumulative, data.totalPaid);
  assert.equal(data.latestMonth, Math.max(...data.monthly.map((point) => point.month)));
  assertMoneyClose(
    data.nationalPerCapita,
    data.paymentsWithPopulation / data.populationCovered,
    0.01,
  );
});

test("regional and independent municipal rankings are sorted and numerically sane", async () => {
  const data = await loadSnapshot();

  for (let index = 1; index < data.regions.length; index += 1) {
    assert.ok(data.regions[index - 1].value >= data.regions[index].value);
  }

  assert.deepEqual(data.topMunicipalities, data.topMunicipalitiesByValue);
  for (let index = 1; index < data.topMunicipalitiesByValue.length; index += 1) {
    assert.ok(
      data.topMunicipalitiesByValue[index - 1].value >=
        data.topMunicipalitiesByValue[index].value,
    );
  }
  for (let index = 1; index < data.topMunicipalitiesByPerCapita.length; index += 1) {
    assert.ok(
      data.topMunicipalitiesByPerCapita[index - 1].perCapita >=
        data.topMunicipalitiesByPerCapita[index].perCapita,
    );
  }
  assert.ok(
    data.topMunicipalitiesByPerCapita.some(
      (item) => !data.topMunicipalitiesByValue.some(
        (volumeItem) => volumeItem.codiceFiscale === item.codiceFiscale,
      ),
    ),
    "the national per-capita ranking must not be a reordering of the volume top 100",
  );

  for (const region of data.regions) {
    assert.ok(region.value >= 0);
    assert.ok(region.municipalities > 0);
    if (region.perCapita !== null) {
      assert.ok(region.perCapita >= 0);
      assertMoneyClose(region.perCapita, region.perCapitaValue / region.population, 0.01);
    }
    assert.ok(region.municipalitiesWithPopulation <= region.municipalities);
  }
});

test("the period selector is backed by three reconciled SIOPE years", async () => {
  const snapshots = await Promise.all(
    historicalSnapshotUrls.map(async (url) => JSON.parse(await readFile(url, "utf8"))),
  );

  assert.deepEqual(snapshots.map((data) => data.year), [2024, 2025, 2026]);
  for (const data of snapshots) {
    assert.equal(data.regions.length, 20);
    assert.equal(data.schemaVersion, 2);
    assert.equal(data.topMunicipalitiesByValue.length, 100);
    assert.equal(data.topMunicipalitiesByPerCapita.length, 100);
    assert.ok(data.monthly.length > 0);
    assert.equal(data.latestMonth, data.monthly.at(-1).month);
    assertMoneyClose(sum(data.monthly.map((point) => point.flow)), data.totalPaid);
    assertMoneyClose(sum(data.regions.map((region) => region.value)), data.totalPaid);
  }
});
