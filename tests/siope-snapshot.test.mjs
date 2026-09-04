import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import test from "node:test";
import { PYTHON_BIN } from "./helpers/python.mjs";
import "./helpers/register-ts-alias.mjs";

const execFileAsync = promisify(execFile);

const snapshotUrl = new URL("../src/data/generated/siope-municipal.json", import.meta.url);
const historicalSnapshotUrls = [
  new URL("../src/data/generated/siope-municipal-2024.json", import.meta.url),
  new URL("../src/data/generated/siope-municipal-2025.json", import.meta.url),
  snapshotUrl,
];

async function loadSnapshot() {
  return JSON.parse(await readFile(snapshotUrl, "utf8"));
}

test("distribution keeps an explicit region-null municipality national but not regional", async () => {
  const code = [
    "import json",
    "from scripts.etl.siope_municipal_snapshot import build_distribution",
    "rows = [",
    "    {'region': 'Nord', 'population': 100, 'totalCents': 200_000, 'titleCents': 100_000},",
    "    {'region': 'Sud', 'population': 300, 'totalCents': 1_200_000, 'titleCents': 600_000},",
    "    {'region': None, 'population': 500, 'totalCents': 1_000_000, 'titleCents': 500_000},",
    "]",
    "validators = {k: {'lastModified': 'now', 'sha256': letter * 64} for k, letter in (('movements', 'a'), ('registry', 'b'), ('ipa', 'c'))}",
    "result = build_distribution(rows=rows, year=2026, latest_month=8, observed_at='2026-08-21T00:00:00+00:00', validators=validators)",
    "print(json.dumps(result))",
  ].join("\n");
  const { stdout } = await execFileAsync(PYTHON_BIN, ["-c", code], {
    cwd: new URL("..", import.meta.url),
  });
  const result = JSON.parse(stdout);

  assert.equal(result.coverage.municipalitiesWithMovements, 3);
  assert.equal(result.coverage.municipalitiesWithRegion, 2);
  assert.equal(result.coverage.municipalitiesWithoutRegion, 1);
  assert.equal(result.coverage.municipalitiesWithValidPopulationAndRegion, 2);
  assert.equal(result.coverage.populationCovered, 900);
  assert.equal(result.coverage.populationRegionalized, 400);
  assert.equal(result.coverage.paymentsWithoutRegion, 10_000);
  assert.equal(result.coverage.paymentsWithPopulationWithoutRegion, 10_000);
  assert.deepEqual(result.regions.map((item) => item.region), ["Nord", "Sud"]);
  assert.equal(result.regions.reduce((total, item) => total + item.municipalities, 0), 2);
  assert.equal(result.populationBands.reduce((total, item) => total + item.municipalities, 0), 3);
  assert.equal(result.nationalShareAll, 0.5);
});

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

  assert.equal(data.schemaVersion, 3);
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
  assert.ok(data.source.siopeMovementsEtag);
  assert.ok(data.source.siopeRegistryEtag);
  assert.ok(data.source.ipaEtag);
  assert.match(data.methodology.populationReference, /non dichiarata/i);
  assert.equal(
    data.methodology.populationSourceLastModified,
    data.source.siopeRegistryLastModified,
  );
});

test("SIOPE refresh manifest and imported snapshot years stay aligned", async () => {
  const workflow = await readFile(
    new URL("../.github/workflows/siope-refresh.yml", import.meta.url),
    "utf8",
  );
  const manifest = workflow.match(/years=\(([^)]+)\)/);
  assert.ok(manifest, "the refresh workflow must declare its snapshot year manifest");
  const workflowYears = manifest[1]
    .trim()
    .split(/\s+/)
    .map((year) => Number(year));
  const snapshotYears = historicalSnapshotUrls
    .map((url) => Number(url.pathname.match(/siope-municipal(?:-(\d{4}))?\.json$/)?.[1] ?? "2026"))
    .sort((left, right) => left - right);
  assert.deepEqual(workflowYears, snapshotYears);
});

test("monthly flows, regional totals and headline total reconcile", async () => {
  const data = await loadSnapshot();
  const monthlyTotal = sum(data.monthly.map((point) => point.flow));
  const regionalTotal = sum(data.regions.map((region) => region.value));
  const lastCumulative = data.monthly.at(-1)?.cumulative;

  assertMoneyClose(monthlyTotal, data.totalPaid);
  assertMoneyClose(regionalTotal + data.coverage.paymentsWithoutRegion, data.totalPaid);
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
  for (const municipality of data.topMunicipalitiesByPerCapita) {
    assert.match(municipality.province, /\S/);
    assert.match(municipality.region, /\S/);
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
    assert.equal(data.schemaVersion, 3);
    assert.equal(data.topMunicipalitiesByValue.length, 100);
    assert.equal(data.topMunicipalitiesByPerCapita.length, 100);
    assert.ok(data.monthly.length > 0);
    assert.equal(data.latestMonth, data.monthly.at(-1).month);
    assertMoneyClose(sum(data.monthly.map((point) => point.flow)), data.totalPaid);
    assertMoneyClose(
      sum(data.regions.map((region) => region.value)) + data.coverage.paymentsWithoutRegion,
      data.totalPaid,
    );
  }
});

test("full-population distribution artifacts are bounded and reconcile", async () => {
  const snapshots = await Promise.all(
    historicalSnapshotUrls.map(async (url) => JSON.parse(await readFile(url, "utf8"))),
  );

  for (const data of snapshots) {
    const distribution = data.distribution;
    assert.equal(distribution.schemaVersion, 2);
    assert.equal(distribution.period.year, data.year);
    assert.equal(distribution.period.endMonth, data.latestMonth);
    assert.equal(distribution.coverage.municipalitiesWithMovements, data.coverage.withMovements);
    assert.equal(distribution.coverage.municipalitiesWithValidPopulation, data.coverage.withPopulation);
    assert.equal(distribution.coverage.populationCovered, data.populationCovered);
    assert.equal(
      distribution.coverage.municipalitiesWithoutPopulation,
      data.coverage.withoutPopulation,
    );
    assert.equal(distribution.coverage.municipalitiesWithRegion, data.coverage.withRegion);
    assert.equal(distribution.coverage.municipalitiesWithoutRegion, data.coverage.withoutRegion);
    assertMoneyClose(
      distribution.coverage.paymentsWithoutRegion,
      data.coverage.paymentsWithoutRegion,
    );
    assert.match(data.source.siopeMovementsSha256, /^[a-f0-9]{64}$/);
    assert.match(data.source.siopeRegistrySha256, /^[a-f0-9]{64}$/);
    assert.match(data.source.ipaSha256, /^[a-f0-9]{64}$/);
    assert.ok(distribution.nationalShareAll >= 0 && distribution.nationalShareAll <= 1);
    assert.ok(
      distribution.nationalShareCovered >= 0 && distribution.nationalShareCovered <= 1,
    );
    assert.equal(distribution.populationBands.length, 8);
    assert.equal(distribution.regions.length, 20);
    assert.equal(
      sum(distribution.populationBands.map((group) => group.municipalities)),
      distribution.coverage.municipalitiesWithValidPopulation,
    );
    assert.equal(
      sum(distribution.regions.map((group) => group.municipalities)),
      distribution.coverage.municipalitiesWithValidPopulationAndRegion,
    );
    assert.equal(
      sum(distribution.populationBands.map((group) => group.population)),
      distribution.coverage.populationCovered,
    );
    assert.equal(
      sum(distribution.regions.map((group) => group.population)),
      distribution.coverage.populationRegionalized,
    );
    assertMoneyClose(
      sum(distribution.regions.map((group) => group.totalAmount)) +
        distribution.coverage.paymentsWithPopulationWithoutRegion,
      sum(distribution.populationBands.map((group) => group.totalAmount)),
    );
    assertMoneyClose(
      sum(distribution.regions.map((group) => group.titleAmount)) +
        distribution.coverage.titlePaymentsWithPopulationWithoutRegion,
      sum(distribution.populationBands.map((group) => group.titleAmount)),
    );

    for (const group of [
      distribution.perCapita,
      ...distribution.populationBands.map((item) => item.perCapita),
      ...distribution.regions.map((item) => item.perCapita),
    ]) {
      for (const weighted of [group.municipalityWeighted, group.residentWeighted]) {
        const values = [weighted.p10, weighted.p25, weighted.p50, weighted.p75, weighted.p90]
          .filter((value) => value !== null);
        assert.deepEqual(values, [...values].sort((left, right) => left - right));
      }
    }
  }
});

test("runtime validation rejects missing or divergent distribution metadata", async () => {
  const { assertSiopeDistributionIntegrity } = await import("../src/lib/siope-snapshot.ts");
  const source = await loadSnapshot();

  const missingDistribution = structuredClone(source);
  delete missingDistribution.distribution;
  assert.throws(
    () => assertSiopeDistributionIntegrity(missingDistribution, source.year),
    /distribution/i,
  );

  const invalidHash = structuredClone(source);
  invalidHash.source.siopeMovementsSha256 = "not-a-sha256";
  assert.throws(
    () => assertSiopeDistributionIntegrity(invalidHash, source.year),
    /SHA-256/i,
  );

  const divergentShare = structuredClone(source);
  divergentShare.distribution.nationalShareAll += 0.01;
  assert.throws(
    () => assertSiopeDistributionIntegrity(divergentShare, source.year),
    /quota nazionale/i,
  );

  const divergentMethod = structuredClone(source);
  divergentMethod.distribution.measure.quantileMethod = "interpolazione arbitraria";
  assert.throws(
    () => assertSiopeDistributionIntegrity(divergentMethod, source.year),
    /semantica della distribuzione/i,
  );

  const missingQuantile = structuredClone(source);
  missingQuantile.distribution.regions[0].perCapita.residentWeighted.p50 = null;
  assert.throws(
    () => assertSiopeDistributionIntegrity(missingQuantile, source.year),
    /presenza dei quantili/i,
  );
});
