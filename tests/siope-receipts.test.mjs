import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import "./helpers/register-ts-alias.mjs";

const {
  availableSiopeReceiptsYears,
  getSiopeMunicipalReceiptsSnapshot,
  getSiopeMunicipalityReceipts,
  getSiopeMunicipalityCashComparison,
  areSiopeCashPeriodsComparable,
  querySiopeMunicipalReceipts,
} = await import("../src/lib/siope-receipts.ts");
const { validateSiopeReceiptsArtifacts, siopeReceiptsPeriod } = await import("../src/lib/data/siope-receipts-contract.ts");
const { GET } = await import("../src/app/api/entrate/comuni/route.ts");
const { queryPublicDataset } = await import("../src/lib/mcp/datasets.ts");
const { datasetCatalog } = await import("../src/lib/mcp/catalog.ts");
const raw = (kind, year = 2025) => JSON.parse(fs.readFileSync(new URL(`../src/data/generated/siope-municipal-receipts${kind === "detail" ? "-detail" : ""}-${year}.json`, import.meta.url), "utf8"));
const request = (search = "") => GET(new Request(`http://localhost/api/entrate/comuni${search}`));

for (const year of [2024, 2025, 2026]) {
  test(`receipts ${year} are genuine, distinct cash snapshots with reconciled complete municipal detail`, () => {
    const { snapshot, detail } = validateSiopeReceiptsArtifacts(raw("summary", year), raw("detail", year), year);
    assert.ok(snapshot.totalCollected > 0);
    assert.equal(snapshot.source.publicationDate, null);
    assert.equal(snapshot.source.license, "not-declared");
    assert.equal(snapshot.accountingBasis, "cash");
    assert.equal(detail.accountingBasis, "cash");
    assert.match(snapshot.source.siopeMovementsUrl, new RegExp(`SIOPE_ENTRATE\\.${year}\\.zip$`));
    assert.ok(detail.municipalities.length > 7_000);
    assert.equal(snapshot.regions.length, 20);
    assert.equal(snapshot.coverage.malformedRows, 0);
    assert.equal(Object.hasOwn(snapshot, "totalPaid"), false);
    const result = querySiopeMunicipalReceipts({ year, limit: 1 });
    assert.equal(result.pagination.total, detail.municipalities.length);
    assert.equal(result.selection.totalCents, Math.round(snapshot.totalCollected * 100));
    assert.equal(result.pagination.returned, 1);
    assert.equal(result.period.endMonth, snapshot.latestMonth);
    assert.equal(result.national.source.siopeMovementsSha256, snapshot.source.siopeMovementsSha256);
  });
}

test("receipts contract rejects schema, provenance, identity and reconciliation drift", () => {
  const mutations = [
    (s) => { s.flow = "uscite"; },
    (s) => { s.unit = "EUR-cent"; },
    (s) => { s.accountingBasis = "accrual"; },
    (s) => { s.totalCollected += 0.01; },
    (s) => { s.totalCollected += 0.001; },
    (s) => { s.regions[0].value += 0.0001; },
    (s) => { s.source.siopeMovementsUrl = s.source.siopeMovementsUrl.replace("2025", "2024"); },
    (s) => { s.source.siopeRegistryUrl += ".evil.example"; },
    (s) => { s.source.siopeMovementsSha256 = "not-a-hash"; },
    (s) => { s.source.publicationDate = s.source.acquisitionDate; },
    (s) => { s.source.license = "CC-BY-4.0"; },
    (s) => { s.source.checkedAt = "yesterday"; },
    (s) => { s.source.checkedAt = "2020-01-01T00:00:00Z"; },
    (s) => { s.source.observedAt = "2020-01-01T00:00:00Z"; },
    (s) => { s.monthly[0].cumulative += 0.01; },
    (s) => { s.monthly[0].month = 2; },
    (s) => { s.monthly[0].label = "Dicembre"; },
    (s) => { s.latestMonthLabel = "Mese sconosciuto"; },
    (s) => { s.titles[0].code = "8"; },
    (s) => { s.titles.push(s.titles[0]); },
    (s) => { s.regions[0].region = s.regions[1].region; },
    (s) => { s.regions[0].value += 0.01; },
    (s) => { s.coverage.malformedRows = 1; },
    (s) => { s.coverage.includedMovementRows = s.coverage.movementRows + 1; },
    (s) => { s.coverage.withoutRegion += 1; },
    (_s, d) => { d.municipalities.push(d.municipalities[0]); },
    (_s, d) => { d.municipalities[0][1] = d.municipalities.find((r, i) => i > 0 && r[1] !== null)[1]; },
    (_s, d) => { d.municipalities[0][0] = "123"; },
    (_s, d) => { d.municipalities[0][5] = 1; },
    (_s, d) => { d.municipalities.find((r) => r[6] !== null)[7][0] += 1; },
    (_s, d) => { d.municipalities.find((r) => r[6] !== null)[6] = null; },
    (_s, d) => { d.titleOrder.reverse(); },
    (_s, d) => { d.latestMonth = d.latestMonth === 12 ? 11 : 12; },
    (_s, d) => { d.coverage.withIpaIdentifier += 1; },
  ];
  for (const [index, mutate] of mutations.entries()) {
    const s = raw("summary");
    const d = raw("detail");
    mutate(s, d);
    assert.throws(() => validateSiopeReceiptsArtifacts(s, d, 2025), undefined, `mutation ${index}`);
  }
});

test("receipts query preserves national context and computes selection before pagination", () => {
  assert.deepEqual(availableSiopeReceiptsYears, [2026, 2025, 2024]);
  const full = querySiopeMunicipalReceipts({ year: 2025 });
  const region = querySiopeMunicipalReceipts({ year: 2025, region: "Emilia Romagna", limit: 2, offset: 2 });
  assert.equal(region.national.totalCollected, full.national.totalCollected);
  assert.equal(region.filters.region, "Emilia-Romagna");
  assert.equal(region.pagination.returned, 2);
  assert.ok(region.municipalities.every((row) => row.region === "Emilia-Romagna"));
  assert.equal(region.selection.totalCents, Math.round(full.national.regions.find((row) => row.region === "Emilia-Romagna").value * 100));
  assert.equal(region.selection.municipalities, region.pagination.total);
  const first = region.municipalities.find((row) => row.codiceIpa);
  assert.ok(first);
  for (const code of [first.taxCode, first.codiceIpa]) {
    const single = querySiopeMunicipalReceipts({ year: 2025, code });
    assert.equal(single.pagination.total, 1);
    assert.deepEqual(single.municipalities[0], first);
  }
  assert.deepEqual(getSiopeMunicipalityReceipts(first.taxCode, 2025), first);
  const search = querySiopeMunicipalReceipts({ year: 2025, query: first.name.toLowerCase() });
  assert.ok(search.municipalities.some((row) => row.taxCode === first.taxCode));
  const none = querySiopeMunicipalReceipts({ year: 2025, code: "not_an_ipa_code" });
  assert.equal(none.pagination.total, 0);
  assert.equal(none.selection.totalCents, null);
  const beyond = querySiopeMunicipalReceipts({ year: 2025, offset: 100_000 });
  assert.deepEqual(beyond.municipalities, []);
  assert.equal(beyond.selection.totalCents, full.selection.totalCents);
});

test("missing receipts stay null while observed zero is preserved", () => {
  const missing = raw("detail").municipalities.find((row) => row[6] === null);
  assert.ok(missing);
  const row = getSiopeMunicipalityReceipts(missing[0], 2025);
  assert.equal(row.totalCents, null);
  assert.equal(row.perCapitaCents, null);
  assert.deepEqual(row.titles, []);
  assert.equal(querySiopeMunicipalReceipts({ year: 2025, code: row.taxCode }).selection.totalCents, null);
  for (const year of availableSiopeReceiptsYears) {
    for (const zero of raw("detail", year).municipalities.filter((item) => item[6] === 0)) {
      assert.equal(getSiopeMunicipalityReceipts(zero[0], year).totalCents, 0);
      assert.equal(querySiopeMunicipalReceipts({ year, code: zero[0] }).selection.totalCents, 0);
    }
  }
});

test("receipts contract retains observed zero, distinct from missing movements", () => {
  const s = raw("summary");
  const d = raw("detail");
  s.totalCollected = s.receiptsWithPopulation = s.coverage.receiptsWithoutRegion = 0;
  if (s.nationalPerCapita !== null) s.nationalPerCapita = 0;
  for (const row of s.regions) {
    row.value = row.perCapitaValue = 0;
    if (row.perCapita !== null) row.perCapita = 0;
  }
  for (const row of s.monthly) row.flow = row.cumulative = 0;
  for (const row of s.titles) row.value = 0;
  for (const row of d.municipalities) {
    if (row[6] !== null) {
      row[6] = 0;
      row[7].fill(0);
    }
  }
  const { detail } = validateSiopeReceiptsArtifacts(s, d, 2025);
  assert.equal(detail.municipalities.filter((row) => row[6] === 0).length, s.coverage.withMovements);
  assert.equal(detail.municipalities.filter((row) => row[6] === null).length, d.coverage.withoutMovements);
});

test("receipt queries fail closed on malformed filters", () => {
  for (const options of [
    { year: 1999 }, { year: 2025.5 }, { year: "2025" }, { region: "Atlantide" },
    { region: "" }, { query: " " }, { query: "x".repeat(121) }, { code: "x/y" },
    { limit: 0 }, { limit: 101 }, { limit: 1.5 }, { offset: -1 }, { offset: 100_001 },
  ]) assert.throws(() => querySiopeMunicipalReceipts(options), undefined, JSON.stringify(options));
});

test("cash comparisons require the same full period or the same partial release and registry", () => {
  const receipts = structuredClone(getSiopeMunicipalReceiptsSnapshot(2025));
  const payments = structuredClone(receipts);
  receipts.latestMonth = payments.latestMonth = 12;
  receipts.generatedAt = payments.generatedAt = "2026-01-15T00:00:00Z";
  assert.equal(areSiopeCashPeriodsComparable(receipts, payments), true);
  payments.generatedAt = "2025-12-31T00:00:00Z";
  assert.equal(areSiopeCashPeriodsComparable(receipts, payments), false);
  payments.generatedAt = receipts.generatedAt;
  payments.year = 2024;
  assert.equal(areSiopeCashPeriodsComparable(receipts, payments), false);
  payments.year = 2025;
  receipts.latestMonth = payments.latestMonth = 8;
  assert.equal(siopeReceiptsPeriod(receipts).completeness, "partial");
  assert.equal(areSiopeCashPeriodsComparable(receipts, payments), true);
  for (const field of ["siopeMovementsLastModified", "siopeRegistrySha256", "ipaSha256"]) {
    const changed = structuredClone(payments);
    changed.source[field] = field.includes("Modified") ? null : "a".repeat(64);
    assert.equal(areSiopeCashPeriodsComparable(receipts, changed), false);
  }
  payments.latestMonth = 7;
  assert.equal(areSiopeCashPeriodsComparable(receipts, payments), false);
  const absent = getSiopeMunicipalityCashComparison("00000000000", 2025);
  assert.equal(absent.comparable, false);
  assert.equal(absent.paymentsCents, null);
  assert.equal(Object.hasOwn(absent, "balance"), false);
});

test("REST and MCP reuse exactly the same receipts query and reject unsupported inputs", async () => {
  const response = request("?anno=2025&regione=Lazio&limit=3&offset=1");
  assert.equal(response.status, 200);
  const api = await response.json();
  const mcp = await queryPublicDataset({ dataset: "siope_entrate_comuni", year: 2025, region: "Lazio", limit: 3, offset: 1 });
  assert.deepEqual(api, mcp);
  const descriptor = datasetCatalog.find((row) => row.id === "siope_entrate_comuni");
  assert.deepEqual(descriptor.filters, ["year", "region", "code", "query", "limit", "offset"]);
  assert.match(descriptor.caveat, /parziale/);
  assert.match(descriptor.caveat, /competenza/);
  for (const search of ["?anno=2025x", "?anno=1999", "?anno=2025&anno=2026", "?year=2025", "?regione=Atlantide", "?limit=101", "?offset=-1", "?q=", "?codice="]) {
    const invalid = request(search);
    assert.equal(invalid.status, 400, search);
    assert.equal(invalid.headers.get("cache-control"), "no-store");
  }
  await assert.rejects(queryPublicDataset({ dataset: "siope_entrate_comuni", ministry: "MEF" }), /Filtri non supportati/);
  await assert.rejects(queryPublicDataset({ dataset: "siope_entrate_comuni", year: 1999 }), /Anno SIOPE entrate/);
});
