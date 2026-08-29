import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import "./helpers/register-ts-alias.mjs";

const {
  BudgetLawDatasetUnavailableError,
  BudgetLawInvalidWindowError,
  BudgetLawWindowUnavailableError,
  discoverBudgetLawMissionDataset,
  getBudgetLawMissionSeries,
  MIN_STABLE_MISSION_YEAR,
  missionYearOverYearDelta,
  normalizeBudgetLawPackage,
  resetBudgetLawMissionSeriesCacheForTests,
  validateBudgetLawSnapshotArtifact,
  validateBudgetLawMissionSeries,
} = await import("../src/lib/bdap-legge-bilancio.ts");
const { queryPublicDataset } = await import("../src/lib/mcp/datasets.ts");
const { NextRequest } = await import("next/server.js");
const { GET: getBudgetLawRoute } = await import(
  "../src/app/api/spese/stato/legge-bilancio/route.ts"
);

const packageId = "e0be9f03-134b-446d-8e6c-cb5c14ddc11c";
const EXPECTED_TITLE =
  "Legge di Bilancio Pubblicata - Serie storica - Spese per Amministrazione Missione Programma Macroaggregato";
const PRODUCT_CODE = "LBF_SPE_CRU_AMPMA_001";
const COMMITTED_SNAPSHOT = JSON.parse(
  readFileSync("src/data/generated/openbdap-budget-law-missions.json", "utf8"),
);
const SOURCE_SPEC = JSON.parse(
  readFileSync("scripts/etl/specs/openbdap-budget-law-missions.source.json", "utf8"),
);

function packageFixture(overrides = {}) {
  return {
    id: packageId,
    name: "legge_di_bilancio_pubblicata_serie_storica_spese_per_amministrazione_missione_programma_macroaggregato_new",
    title: EXPECTED_TITLE,
    notes: `Prodotto contenente la serie storica dei dati della Legge di Bilancio Spese aggregati per Amministrazione Missione Programma Macroaggregato - [${PRODUCT_CODE}]`,
    metadata_modified: "2026-01-02T17:37:34.000000",
    license_id: "cc-by",
    license_title: "Creative Commons Attribution",
    license_url: "http://www.opendefinition.org/licenses/cc-by",
    resources: [
      {
        id: "32750",
        url: `http://bdap-opendata.rgs.mef.gov.it/SpodCkanApi/api/3/datastore/dump/${packageId}.csv`,
        format: "csv",
        mimetype: "text/csv",
      },
      {
        id: "32999",
        url: "https://bdap-opendata.rgs.mef.gov.it/metadata.pdf",
        format: "CSV",
        mimetype: "application/pdf",
      },
    ],
    ...overrides,
  };
}

const CSV_HEADER = [
  "Esercizio Finanziario",
  "Stato di Previsione",
  "Amministrazione",
  "Missione",
  "Programma",
  "Unità di voto 1° Livello",
  "Unità di voto 2° Livello",
  "Unità di voto 3° Livello",
  "Macroaggregato",
  "Legge di Bilancio CP A1",
  "Legge di Bilancio CP A2",
  "Legge di Bilancio CP A3",
  "Legge di Bilancio CS A1",
  "Legge di Bilancio CS A2",
  "Legge di Bilancio CS A3",
].join(";");

function csvRow({ year, admin, mission, macro, cpA1 }) {
  return [year, admin, `AMMINISTRAZIONE ${admin}`, mission, "", "", "", "", macro, cpA1, cpA1, cpA1, cpA1, cpA1, cpA1]
    .map((value) => `"${value}"`)
    .join(";");
}

const FIXTURE_ROWS = [
  // Pre-2017: mission taxonomy not yet stable, must be excluded entirely.
  csvRow({ year: 2016, admin: "01", mission: "Istruzione vecchia denominazione", macro: "FUNZIONAMENTO", cpA1: "999" }),
  // 2022
  csvRow({ year: 2022, admin: "01", mission: "Istruzione", macro: "FUNZIONAMENTO", cpA1: "1000" }),
  csvRow({ year: 2022, admin: "02", mission: "Istruzione", macro: "INTERVENTI", cpA1: "500" }),
  csvRow({ year: 2022, admin: "01", mission: "Difesa", macro: "FUNZIONAMENTO", cpA1: "2000" }),
  // 2023
  csvRow({ year: 2023, admin: "01", mission: "Istruzione", macro: "FUNZIONAMENTO", cpA1: "1100" }),
  csvRow({ year: 2023, admin: "02", mission: "Istruzione", macro: "INTERVENTI", cpA1: "600" }),
  csvRow({ year: 2023, admin: "01", mission: "Difesa", macro: "FUNZIONAMENTO", cpA1: "2100" }),
  // 2024: Difesa is missing this year on purpose.
  csvRow({ year: 2024, admin: "01", mission: "Istruzione", macro: "FUNZIONAMENTO", cpA1: "1200" }),
  csvRow({ year: 2024, admin: "02", mission: "Istruzione", macro: "INTERVENTI", cpA1: "700" }),
];

const FIXTURE_CSV = [CSV_HEADER, ...FIXTURE_ROWS].join("\n");

function installFetch(csv) {
  resetBudgetLawMissionSeriesCacheForTests();
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (input) => {
    const url = new URL(input.toString());
    calls.push(url.toString());
    if (url.pathname.endsWith("/package_search")) {
      assert.equal(url.searchParams.get("q"), PRODUCT_CODE);
      return new Response(JSON.stringify({ success: true, result: { results: [packageFixture()] } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (url.pathname.endsWith(`${packageId}.csv`)) {
      return new Response(csv, { status: 200, headers: { "content-type": "text/csv" } });
    }
    throw new Error(`URL non atteso nel test: ${url.toString()}`);
  };
  return { calls, restore: () => { globalThis.fetch = originalFetch; } };
}

test("normalizeBudgetLawPackage accepts the exact product-code and title contract", () => {
  const dataset = normalizeBudgetLawPackage(packageFixture());
  assert.ok(dataset);
  assert.equal(dataset.packageId, packageId);
  assert.equal(dataset.title, EXPECTED_TITLE);
  assert.equal(dataset.license, "Creative Commons Attribution");
  assert.equal(dataset.licenseUrl, "http://www.opendefinition.org/licenses/cc-by");
  assert.equal(dataset.resourceId, "32750");
  assert.equal(dataset.csvUrl, `https://bdap-opendata.rgs.mef.gov.it/SpodCkanApi/api/3/datastore/dump/${packageId}.csv`);
  assert.match(dataset.apiUrl, /package_show\?id=/);
});

test("normalizeBudgetLawPackage rejects title drift, missing code, and duplicated code", () => {
  assert.equal(normalizeBudgetLawPackage(packageFixture({ title: "Titolo diverso" })), null);
  assert.equal(
    normalizeBudgetLawPackage(packageFixture({ notes: "Nessun codice prodotto qui" })),
    null,
  );
  assert.equal(
    normalizeBudgetLawPackage(
      packageFixture({ notes: `[${PRODUCT_CODE}] duplicato [${PRODUCT_CODE}]` }),
    ),
    null,
  );
  assert.equal(normalizeBudgetLawPackage(packageFixture({ id: "not-a-uuid" })), null);
  assert.equal(normalizeBudgetLawPackage(packageFixture({ license_id: "other" })), null);
  assert.equal(normalizeBudgetLawPackage(packageFixture({ license_url: "https://example.test" })), null);
  assert.equal(normalizeBudgetLawPackage(packageFixture({ resources: [] })), null);
  assert.equal(
    normalizeBudgetLawPackage(
      packageFixture({
        resources: [
          {
            id: "32750",
            url: `http://bdap-opendata.rgs.mef.gov.it/SpodCkanApi/api/3/datastore/dump/${packageId}.csv`,
            format: "CSV",
            mimetype: "application/pdf",
          },
        ],
      }),
    ),
    null,
  );
});

test("missionYearOverYearDelta computes the arithmetic delta and guards a zero base", () => {
  const delta = missionYearOverYearDelta(
    { year: 2022, mission: "Istruzione", amountEur: 1500 },
    { year: 2023, mission: "Istruzione", amountEur: 1700 },
  );
  assert.equal(delta.deltaEur, 200);
  assert.ok(Math.abs(delta.deltaPct - (200 / 1500) * 100) < 1e-9);

  const zeroBase = missionYearOverYearDelta(
    { year: 2022, mission: "Istruzione", amountEur: 0 },
    { year: 2023, mission: "Istruzione", amountEur: 500 },
  );
  assert.equal(zeroBase.deltaPct, null);

  assert.throws(
    () =>
      missionYearOverYearDelta(
        { year: 2022, mission: "Istruzione", amountEur: 100 },
        { year: 2023, mission: "Difesa", amountEur: 100 },
      ),
    /stessa missione/,
  );
});

test("discoverBudgetLawMissionDataset rejects zero and multiple matches", async () => {
  const empty = installFetch(FIXTURE_CSV);
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ success: true, result: { results: [] } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  await assert.rejects(discoverBudgetLawMissionDataset(), BudgetLawDatasetUnavailableError);
  empty.restore();

  const duplicated = installFetch(FIXTURE_CSV);
  const secondPackageId = "12345678-1234-4abc-8def-1234567890ab";
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        success: true,
        result: {
          results: [
            packageFixture(),
            packageFixture({
              id: secondPackageId,
              resources: [
                {
                  id: "32751",
                  url: `http://bdap-opendata.rgs.mef.gov.it/SpodCkanApi/api/3/datastore/dump/${secondPackageId}.csv`,
                  format: "csv",
                  mimetype: "text/csv",
                },
              ],
            }),
          ],
        },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  await assert.rejects(discoverBudgetLawMissionDataset(), /più pacchetti/);
  duplicated.restore();
});

test("getBudgetLawMissionSeries aggregates per mission, skips pre-2017 rows, and drops missions absent from any served year", async () => {
  const fetchMock = installFetch(FIXTURE_CSV);
  try {
    const series = await getBudgetLawMissionSeries();
    assert.equal(series.minStableMissionYear, MIN_STABLE_MISSION_YEAR);
    assert.deepEqual(series.years, [2022, 2023, 2024]);
    // Difesa is missing in 2024, so it must not appear even though it exists in 2022/2023.
    assert.deepEqual(series.missions, ["Istruzione"]);

    const byYear = new Map(series.allocations.map((row) => [row.year, row.amountEur]));
    assert.equal(byYear.get(2022), 1500);
    assert.equal(byYear.get(2023), 1700);
    assert.equal(byYear.get(2024), 1900);

    assert.equal(series.yearOverYearDeltas.length, 2);
    const [firstDelta, secondDelta] = series.yearOverYearDeltas;
    assert.equal(firstDelta.fromYear, 2022);
    assert.equal(firstDelta.toYear, 2023);
    assert.equal(firstDelta.deltaEur, 200);
    assert.equal(secondDelta.fromYear, 2023);
    assert.equal(secondDelta.toYear, 2024);
    assert.equal(secondDelta.deltaEur, 200);

    assert.ok(fetchMock.calls.some((call) => call.includes("package_search")));
    assert.ok(fetchMock.calls.some((call) => call.includes(`${packageId}.csv`)));
  } finally {
    fetchMock.restore();
  }
});

test("getBudgetLawMissionSeries caches the aggregate: two calls with different windows share one download", async () => {
  const fetchMock = installFetch(FIXTURE_CSV);
  try {
    const first = await getBudgetLawMissionSeries({ windowYears: 3 });
    const second = await getBudgetLawMissionSeries({ windowYears: 2 });
    const csvCalls = fetchMock.calls.filter((call) => call.includes(`${packageId}.csv`));
    assert.equal(csvCalls.length, 1);
    assert.equal(second.observedAt, first.observedAt);
  } finally {
    fetchMock.restore();
  }
});

test("an aborted caller stops waiting without cancelling the shared aggregate", async () => {
  resetBudgetLawMissionSeriesCacheForTests();
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (input) => {
    const url = new URL(input.toString());
    calls.push(url.toString());
    await new Promise((resolve) => setTimeout(resolve, 30));
    if (url.pathname.endsWith("/package_search")) {
      return new Response(
        JSON.stringify({ success: true, result: { results: [packageFixture()] } }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    if (url.pathname.endsWith(`${packageId}.csv`)) {
      return new Response(FIXTURE_CSV, {
        status: 200,
        headers: { "content-type": "text/csv" },
      });
    }
    throw new Error(`URL non atteso nel test: ${url.toString()}`);
  };

  try {
    const controller = new AbortController();
    const cancelled = getBudgetLawMissionSeries({ signal: controller.signal });
    const survivor = getBudgetLawMissionSeries();
    controller.abort(new DOMException("request cancelled", "AbortError"));

    await assert.rejects(cancelled, (error) => error?.name === "AbortError");
    const series = await survivor;
    assert.deepEqual(series.years, [2022, 2023, 2024]);
    assert.equal(calls.filter((call) => call.includes(`${packageId}.csv`)).length, 1);
  } finally {
    globalThis.fetch = originalFetch;
    resetBudgetLawMissionSeriesCacheForTests();
  }
});

test("a page deadline may explicitly fall back to the committed snapshot", async () => {
  resetBudgetLawMissionSeriesCacheForTests();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = new URL(input.toString());
    await new Promise((resolve) => setTimeout(resolve, 30));
    if (url.pathname.endsWith("/package_search")) {
      return new Response(
        JSON.stringify({ success: true, result: { results: [packageFixture()] } }),
        { headers: { "content-type": "application/json" } },
      );
    }
    return new Response(FIXTURE_CSV, { headers: { "content-type": "text/csv" } });
  };
  try {
    const series = await getBudgetLawMissionSeries({
      signal: AbortSignal.timeout(1),
      fallbackOnAbort: true,
    });
    assert.equal(series.dataMode, "snapshot");
    assert.deepEqual(series.years, [2021, 2022, 2023, 2024, 2025, 2026]);
    await new Promise((resolve) => setTimeout(resolve, 70));
  } finally {
    globalThis.fetch = originalFetch;
    resetBudgetLawMissionSeriesCacheForTests();
  }
});

test("getBudgetLawMissionSeries honours a smaller requested window", async () => {
  const fetchMock = installFetch(FIXTURE_CSV);
  try {
    const series = await getBudgetLawMissionSeries({ windowYears: 2 });
    assert.deepEqual(series.years, [2023, 2024]);
  } finally {
    fetchMock.restore();
  }
});

test("getBudgetLawMissionSeries rejects a window outside [2, 20] before fetching", async () => {
  const fetchMock = installFetch(FIXTURE_CSV);
  fetchMock.restore();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("non deve fare fetch con una finestra non valida");
  };
  try {
    await assert.rejects(getBudgetLawMissionSeries({ windowYears: 1 }), BudgetLawInvalidWindowError);
    await assert.rejects(getBudgetLawMissionSeries({ windowYears: 21 }), BudgetLawInvalidWindowError);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("getBudgetLawMissionSeries throws when fewer than two comparable years are published", async () => {
  const singleYearCsv = [
    CSV_HEADER,
    csvRow({ year: 2017, admin: "01", mission: "Istruzione", macro: "FUNZIONAMENTO", cpA1: "100" }),
  ].join("\n");
  const fetchMock = installFetch(singleYearCsv);
  try {
    await assert.rejects(getBudgetLawMissionSeries(), BudgetLawWindowUnavailableError);
  } finally {
    fetchMock.restore();
  }
});

test("getBudgetLawMissionSeries never labels a gap as a year-over-year change", async () => {
  const gappedCsv = [
    CSV_HEADER,
    csvRow({ year: 2022, admin: "01", mission: "Istruzione", macro: "FUNZIONAMENTO", cpA1: "100" }),
    csvRow({ year: 2024, admin: "01", mission: "Istruzione", macro: "FUNZIONAMENTO", cpA1: "120" }),
  ].join("\n");
  const fetchMock = installFetch(gappedCsv);
  try {
    await assert.rejects(getBudgetLawMissionSeries(), BudgetLawWindowUnavailableError);
  } finally {
    fetchMock.restore();
  }
});

test("the committed fallback snapshot is complete, consecutive and reconciled", () => {
  const artifact = validateBudgetLawSnapshotArtifact(COMMITTED_SNAPSHOT);
  const series = artifact.series;
  assert.deepEqual(series.years, [2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026]);
  assert.equal(series.missions.length, 34);
  assert.equal(series.allocations.length, 340);
  assert.equal(series.yearOverYearDeltas.length, 306);
  assert.match(COMMITTED_SNAPSHOT.source.catalogSha256, /^sha256:[0-9a-f]{64}$/);
  assert.match(COMMITTED_SNAPSHOT.source.csvSha256, /^sha256:[0-9a-f]{64}$/);
  assert.equal(
    COMMITTED_SNAPSHOT.source.catalogSha256,
    `sha256:${SOURCE_SPEC.source.catalog.sha256}`,
  );
  assert.equal(COMMITTED_SNAPSHOT.source.csvSha256, `sha256:${SOURCE_SPEC.source.csv.sha256}`);
  assert.equal(COMMITTED_SNAPSHOT.source.catalogBytes, SOURCE_SPEC.source.catalog.bytes);
  assert.equal(COMMITTED_SNAPSHOT.source.csvBytes, SOURCE_SPEC.source.csv.bytes);
  assert.deepEqual(
    Object.fromEntries(
      series.years.map((year) => [
        year,
        series.allocations
          .filter((row) => row.year === year)
          .reduce((sum, row) => sum + row.amountEur, 0),
      ]),
    ),
    SOURCE_SPEC.expectedAnnualTotalsEur,
  );

  const drifted = structuredClone(series);
  drifted.allocations[0].amountEur += 1;
  assert.throws(
    () => validateBudgetLawMissionSeries(drifted, { expectedDataMode: "snapshot" }),
    /variazione non riconciliata/,
  );

  const balancedDrift = structuredClone(COMMITTED_SNAPSHOT);
  balancedDrift.series.allocations[0].amountEur += 1;
  const allocationMap = new Map(
    balancedDrift.series.allocations.map((row) => [`${row.year}::${row.mission}`, row.amountEur]),
  );
  for (const delta of balancedDrift.series.yearOverYearDeltas) {
    delta.fromAmountEur = allocationMap.get(`${delta.fromYear}::${delta.mission}`);
    delta.toAmountEur = allocationMap.get(`${delta.toYear}::${delta.mission}`);
    delta.deltaEur = delta.toAmountEur - delta.fromAmountEur;
    delta.deltaPct =
      delta.fromAmountEur === 0 ? null : (delta.deltaEur / delta.fromAmountEur) * 100;
  }
  assert.throws(
    () => validateBudgetLawSnapshotArtifact(balancedDrift),
    /totale 2017 non riconciliato/,
  );

  const sourceDrift = structuredClone(COMMITTED_SNAPSHOT);
  sourceDrift.source.csvSha256 = `sha256:${"0".repeat(64)}`;
  assert.throws(
    () => validateBudgetLawSnapshotArtifact(sourceDrift),
    /provenienza sorgente inattesa/,
  );
});

test("source-contract drift fails closed instead of being hidden by the snapshot", async () => {
  resetBudgetLawMissionSeriesCacheForTests();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        success: true,
        result: { results: [packageFixture({ license_id: "license-changed" })] },
      }),
      { headers: { "content-type": "application/json" } },
    );
  try {
    await assert.rejects(getBudgetLawMissionSeries(), BudgetLawDatasetUnavailableError);
  } finally {
    globalThis.fetch = originalFetch;
    resetBudgetLawMissionSeriesCacheForTests();
  }
});

test("openbdap_legge_bilancio_storico MCP dataset rejects unsupported filters and exposes the series", async () => {
  const fetchMock = installFetch(FIXTURE_CSV);
  try {
    await assert.rejects(
      queryPublicDataset({ dataset: "openbdap_legge_bilancio_storico", code: "x" }),
      /Filtri non supportati/,
    );
    const result = await queryPublicDataset({ dataset: "openbdap_legge_bilancio_storico", years: 2 });
    assert.deepEqual(result.years, [2023, 2024]);
    assert.deepEqual(result.missions, ["Istruzione"]);
  } finally {
    fetchMock.restore();
  }
});

test("the budget-law route validates its query and never caches errors", async () => {
  for (const search of ["?anni=2&anni=3", "?anni=1", "?altro=2"]) {
    const response = await getBudgetLawRoute(
      new NextRequest(`https://example.test/api/spese/stato/legge-bilancio${search}`),
    );
    assert.equal(response.status, 400);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
  }
});

test("the budget-law route exposes the bounded public series with an explicit cache policy", async () => {
  const fetchMock = installFetch(FIXTURE_CSV);
  try {
    const response = await getBudgetLawRoute(
      new NextRequest("https://example.test/api/spese/stato/legge-bilancio?anni=2"),
    );
    assert.equal(response.status, 200);
    assert.equal(
      response.headers.get("cache-control"),
      "public, s-maxage=3600, stale-while-revalidate=21600",
    );
    const body = await response.json();
    assert.equal(body.ok, true);
    assert.deepEqual(body.years, [2023, 2024]);
    assert.equal(body.dataset.resourceId, "32750");
    assert.equal(body.dataset.licenseUrl, "http://www.opendefinition.org/licenses/cc-by");
  } finally {
    fetchMock.restore();
  }
});

test("the budget-law route falls back to the verified snapshot when OpenBDAP is unavailable", async () => {
  resetBudgetLawMissionSeriesCacheForTests();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response("internal source detail", { status: 502, statusText: "Bad Gateway" });
  try {
    const response = await getBudgetLawRoute(
      new NextRequest("https://example.test/api/spese/stato/legge-bilancio"),
    );
    assert.equal(response.status, 200);
    assert.equal(
      response.headers.get("cache-control"),
      "public, s-maxage=3600, stale-while-revalidate=21600",
    );
    const body = await response.json();
    assert.equal(body.dataMode, "snapshot");
    assert.deepEqual(body.years, [2021, 2022, 2023, 2024, 2025, 2026]);
    assert.equal(body.error, undefined);
    assert.doesNotMatch(JSON.stringify(body), /Bad Gateway|internal source detail/);
  } finally {
    globalThis.fetch = originalFetch;
    resetBudgetLawMissionSeriesCacheForTests();
  }
});

test("the known OpenBDAP attachment-conversion outage uses the snapshot", async () => {
  resetBudgetLawMissionSeriesCacheForTests();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = new URL(input.toString());
    if (url.pathname.endsWith("/package_search")) {
      return new Response(
        JSON.stringify({ success: true, result: { results: [packageFixture()] } }),
        { headers: { "content-type": "application/json" } },
      );
    }
    return new Response(
      JSON.stringify({
        success: false,
        error: { message: "Cannot convert data to csv. Attachment not found" },
      }),
      { headers: { "content-type": "application/json" } },
    );
  };
  try {
    const response = await getBudgetLawRoute(
      new NextRequest("https://example.test/api/spese/stato/legge-bilancio?anni=20"),
    );
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.dataMode, "snapshot");
    assert.deepEqual(body.years, [2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026]);
  } finally {
    globalThis.fetch = originalFetch;
    resetBudgetLawMissionSeriesCacheForTests();
  }
});
