import assert from "node:assert/strict";
import test from "node:test";
import "./helpers/register-ts-alias.mjs";

const { normalizeWorkforce } = await import("../scripts/etl/company_atlas_snapshot.mjs");

const {
  companyAtlasBandOptions,
  companyAtlasMetricOptions,
  companyAtlasPeriodOptions,
  companyAtlasRegionOptions,
  companyAtlasSectorOptions,
  getCompanyAtlasView,
  normalizeCompanyAtlasFilters,
  queryCompanyAtlasDataset,
} = await import("../src/lib/company-atlas.ts");
const { queryPublicDataset } = await import("../src/lib/mcp/datasets.ts");
const {
  BUSINESS_DATASET_IDS,
  businessDatasetCatalog,
} = await import("../src/lib/mcp/catalog.ts");
const { createDvnsMcpServer } = await import("../src/lib/mcp/server.ts");
const { companyAtlasSnapshotSchema } = await import("../src/lib/company-atlas-contract.ts");
const { PRIMARY_NAV, SITE_MAP_GROUPS } = await import("../src/lib/site-navigation.ts");

test("the generated company atlas snapshot is aggregate-only and schema-valid", async () => {
  const snapshot = (await import("../src/data/generated/company-atlas-snapshot.json", { with: { type: "json" } })).default;
  const parsed = companyAtlasSnapshotSchema.parse(snapshot);

  assert.equal(parsed.schemaVersion, 1);
  assert.equal(parsed.observationType, "aggregate");
  assert.equal(parsed.atecoVersion, "ATECO 2025");
  assert.equal(parsed.regions.length, 20);
  assert.ok(parsed.sectors.length >= 10);
  assert.equal(parsed.productionBands.length, 10);
  assert.ok(parsed.observations.length >= 12_880);
  assert.match(parsed.generatedAt, /^\d{4}-\d{2}-\d{2}T/);

  // Assert every region has valid 2-digit code and name
  for (const region of parsed.regions) {
    assert.match(region.code, /^\d{2}$/);
    assert.ok(region.name.length > 0);
  }

  // All observations are aggregate-only and regional
  assert.ok(parsed.observations.every((row) => row.observationType === "aggregate"));
  assert.ok(parsed.observations.every((row) => row.geographyLevel === "region"));
  assert.ok(parsed.observations.every((row) => /^\d{2}$/.test(row.geographyCode)));

  // Strict invariant: no entity-level or unapproved keys exist in any observation
  const forbiddenKeys = [
    "companyName", "businessName", "name", "ragioneSociale", "denominazione",
    "vatId", "piva", "partitaIva", "cf", "taxId", "fiscalCode", "codiceFiscale",
    "address", "city", "comune", "cap", "zip",
    "revenue", "turnover", "fatturato", "ricavi", "profit", "utile", "ebitda",
  ];
  for (const row of parsed.observations) {
    for (const key of forbiddenKeys) {
      assert.ok(!Object.hasOwn(row, key), `Forbidden key "${key}" found in observation`);
    }
  }

  // Provenance check: all 3 sources declare CC BY 4.0 and InfoCamere/Marche publisher
  assert.equal(Object.keys(parsed.sources).length, 3);
  for (const source of Object.values(parsed.sources)) {
    assert.equal(source.license, "CC BY 4.0");
    assert.match(source.publisher, /CCIAA Marche|InfoCamere/i);
    assert.ok(source.url.startsWith("https://opendata.marche.camcom.it/data/"));
    assert.ok(source.caveat.length > 0);
    assert.ok(source.cadence.length > 0);
  }
  assert.match(parsed.sources.workforce.caveat, /posizioni previdenziali attive/i);
  assert.match(parsed.sources.workforce.caveat, /trimestre precedente/i);
  assert.match(parsed.sources.workforce.caveat, /occupazione/i);
  assert.match(parsed.sources.workforce.caveat, /ISTAT\/ASIA/i);
});

test("workforce coverage reconciles every region and preserves explicit source nulls", async () => {
  const snapshot = (await import("../src/data/generated/company-atlas-snapshot.json", { with: { type: "json" } })).default;
  const workforce = snapshot.observations.filter((row) => row.sourceId === "workforce");
  assert.equal(workforce.length, 920);
  assert.equal(new Set(workforce.map((row) => row.geographyCode)).size, 20);
  assert.equal(new Set(workforce.map((row) => row.sectorCode)).size, 23);
  assert.equal(workforce.filter((row) => row.value === null).length, 46);
  assert.equal(snapshot.coverage.workforceRowsRead, 118_673);
  assert.equal(snapshot.coverage.workforceRowsAccepted, snapshot.coverage.workforceRowsRead);
  assert.equal(snapshot.coverage.workforceObservedCells, 437);
  assert.equal(snapshot.coverage.workforceMissingCells, 23);
  assert.equal(snapshot.coverage.workforceEmployeesTotal, 19_490_025);
  assert.equal(snapshot.coverage.workforceLocalUnitsTotal, 6_394_474);
  assert.equal(
    workforce.filter((row) => row.metric === "employees" && row.value !== null).reduce((sum, row) => sum + row.value, 0),
    19_490_025,
  );
  assert.equal(
    workforce.filter((row) => row.metric === "active_local_units" && row.value !== null).reduce((sum, row) => sum + row.value, 0),
    6_394_474,
  );
});

test("workforce ETL sums distinct ATECO buckets and normalizes regional spelling variants", () => {
  const header = "Regione;Provincia;Settore;Divisione;Classe;Sottocategoria;Addetti;Localizzazioni Attive";
  const csv = [
    header,
    "EMILIA ROMAGNA;BOLOGNA;A;01;01;01;2;3",
    "EMILIA–ROMAGNA;BOLOGNA;A;01;011;011;5;7",
    "TRENTINO - ALTO ADIGE;TRENTO;A;01;01;01;11;13",
  ].join("\n");
  const result = normalizeWorkforce(csv, new Map([["A", "Agricoltura"]]), {
    expectedRegionCodes: ["04", "08"],
    expectedSectorCodes: ["A"],
    expectedRows: 3,
    expectedTotals: { employees: 18, localUnits: 23 },
  });
  assert.equal(result.observations.length, 4);
  assert.equal(result.observations.find((row) => row.geographyCode === "08" && row.metric === "employees")?.value, 7);
  assert.equal(result.observations.find((row) => row.geographyCode === "08" && row.metric === "active_local_units")?.value, 10);
  assert.equal(result.observations.find((row) => row.geographyCode === "04" && row.metric === "employees")?.value, 11);
  assert.equal(result.observations.find((row) => row.geographyCode === "04" && row.metric === "active_local_units")?.value, 13);
});

test("workforce ETL fails closed on unknown regions and sectors", () => {
  const header = "Regione;Provincia;Settore;Divisione;Classe;Sottocategoria;Addetti;Localizzazioni Attive";
  const row = "ABRUZZO;CHIETI;A;01;01;01;1;1";
  const options = {
    expectedRegionCodes: ["13"],
    expectedSectorCodes: ["A"],
    expectedRows: 1,
    expectedTotals: { employees: 1, localUnits: 1 },
  };
  assert.throws(
    () => normalizeWorkforce(`${header}\nATLANTIDE;CHIETI;A;01;01;01;1;1`, new Map(), options),
    /Regione CSV non mappata/,
  );
  assert.throws(
    () => normalizeWorkforce(`${header}\n${row.replace(";A;", ";Z;")}`, new Map(), options),
    /Settore ATECO CSV inatteso/,
  );
});

test("metric definitions and filter options are populated and consistent", () => {
  const metricOpts = companyAtlasMetricOptions();
  assert.equal(metricOpts.length, 4);
  assert.deepEqual(metricOpts.map((m) => m.id), [
    "active_enterprises",
    "employees",
    "active_local_units",
    "production_value_band_count",
  ]);

  const regionOpts = companyAtlasRegionOptions();
  assert.equal(regionOpts.length, 20);

  const sectorOpts = companyAtlasSectorOptions();
  assert.ok(sectorOpts.length >= 20);

  const bandOpts = companyAtlasBandOptions();
  assert.equal(bandOpts.length, 10);
  assert.ok(bandOpts.some((b) => b.code === "50M_OVER"));
  assert.ok(bandOpts.some((b) => b.code === "NEG"));

  const activePeriods = companyAtlasPeriodOptions("active_enterprises");
  assert.ok(activePeriods.length >= 1);
  assert.ok(activePeriods.some((p) => p.id === "2026-07-31"));

  const workforcePeriods = companyAtlasPeriodOptions("employees");
  assert.ok(workforcePeriods.length >= 1);
  assert.ok(workforcePeriods.some((p) => p.id === "2026-Q2"));
});

test("filter normalization handles defaults, casing, whitespace, and invalid values safely", () => {
  const defaults = normalizeCompanyAtlasFilters({});
  assert.equal(defaults.metric, "active_enterprises");
  assert.equal(defaults.region, "all");
  assert.equal(defaults.sector, "all");
  assert.equal(defaults.band, "all");
  assert.equal(defaults.period, "2026-07-31");

  // Lookup region by exact Italian name (case insensitive, trimmed)
  const byName = normalizeCompanyAtlasFilters({ region: "  lombardia  " });
  assert.equal(byName.region, "03");

  const byCode = normalizeCompanyAtlasFilters({ region: "03" });
  assert.equal(byCode.region, "03");

  const invalidRegion = normalizeCompanyAtlasFilters({ region: "NonEsiste" });
  assert.equal(invalidRegion.region, "all");

  // Sector casing and fallback
  const sectorLower = normalizeCompanyAtlasFilters({ sector: "c" });
  assert.equal(sectorLower.sector, "C");

  const invalidSector = normalizeCompanyAtlasFilters({ sector: "ZZZ" });
  assert.equal(invalidSector.sector, "all");

  // Band is only kept for production_value_band_count
  const bandOnEnterprises = normalizeCompanyAtlasFilters({ metric: "active_enterprises", band: "50M_OVER" });
  assert.equal(bandOnEnterprises.band, "all");

  const bandOnProduction = normalizeCompanyAtlasFilters({ metric: "production_value_band_count", band: "50M_OVER" });
  assert.equal(bandOnProduction.band, "50M_OVER");
});

test("metric, sector and region selections change the view and maintain math consistency", () => {
  const national = getCompanyAtlasView();
  const lombardia = getCompanyAtlasView({ region: "03" });
  const manufacturing = getCompanyAtlasView({ sector: "C" });
  const employees = getCompanyAtlasView({ metric: "employees" });
  const localUnits = getCompanyAtlasView({ metric: "active_local_units" });

  assert.equal(national.regionPoints.length, 20);
  assert.ok((national.nationalValue ?? 0) > 0);

  // Sum of 20 regions equals the national total
  const sumOfRegions = national.regionPoints.reduce((sum, p) => sum + (p.value ?? 0), 0);
  assert.equal(sumOfRegions, national.nationalValue);

  // Selected region detail
  assert.equal(lombardia.selectedRegion?.code, "03");
  assert.equal(lombardia.selectedRegion?.name, "Lombardia");
  assert.ok((lombardia.selectedRegion?.value ?? 0) > 0);
  assert.ok((lombardia.selectedRegion?.value ?? 0) < (national.nationalValue ?? 0));

  // Sector filtering
  assert.equal(manufacturing.selectedSectorLabel, "Attività manifatturiere");
  assert.notEqual(manufacturing.nationalValue, national.nationalValue);
  assert.ok((manufacturing.nationalValue ?? 0) > 0);

  // Ranking is strictly descending
  for (let i = 1; i < national.ranking.length; i++) {
    const prev = national.ranking[i - 1]?.value ?? 0;
    const curr = national.ranking[i]?.value ?? 0;
    assert.ok(prev >= curr, `Ranking not sorted: index ${i - 1} (${prev}) < index ${i} (${curr})`);
  }

  // Employees & Local Units view
  assert.equal(employees.metric, "employees");
  assert.equal(employees.period, "2026-Q2");
  assert.equal(employees.sources[0].license, "CC BY 4.0");

  assert.equal(localUnits.metric, "active_local_units");
  assert.equal(localUnits.period, "2026-Q2");
  assert.equal(localUnits.sources[0].license, "CC BY 4.0");
});

test("production bands remain bands and MCP pagination is bounded", () => {
  const production = getCompanyAtlasView({ metric: "production_value_band_count", band: "50M_OVER" });
  const first = queryCompanyAtlasDataset({
    dataset: "company_production_value_bands",
    band: "50M_OVER",
    limit: 7,
  });
  const second = queryCompanyAtlasDataset({
    dataset: "company_production_value_bands",
    band: "50M_OVER",
    limit: 7,
    offset: 7,
  });

  assert.equal(production.band, "50M_OVER");
  assert.equal(first.pagination.limit, 7);
  assert.equal(first.data.length, 7);
  assert.equal(second.data.length, 7);
  assert.equal(first.provenance[0].license, "CC BY 4.0");
  assert.match(first.caveat, /non sono ricavi esatti/i);
  assert.notDeepEqual(first.data[0], second.data[0]);
  assert.ok(first.data.every((row) => row.metric === "production_value_band_count"));
  assert.ok(first.data.every((row) => row.bandCode === "50M_OVER"));

  // Verify pagination clamping
  const clampedLimit = queryCompanyAtlasDataset({
    dataset: "company_production_value_bands",
    limit: 999,
  });
  assert.equal(clampedLimit.pagination.limit, 100);

  const clampedOffset = queryCompanyAtlasDataset({
    dataset: "company_production_value_bands",
    offset: -10,
  });
  assert.equal(clampedOffset.pagination.offset, 0);
});

test("workforce query returns multi-metric observations under declared filters", () => {
  const result = queryCompanyAtlasDataset({
    dataset: "company_workforce",
    region: "03",
    sector: "C",
    limit: 10,
  });

  assert.equal(result.dataset, "company_workforce");
  assert.equal(result.observationType, "aggregate");
  assert.equal(result.geographyLevel, "region");
  assert.ok(result.data.length >= 2);
  const metricsInResult = new Set(result.data.map((r) => r.metric));
  assert.ok(metricsInResult.has("employees"));
  assert.ok(metricsInResult.has("active_local_units"));
  assert.ok(result.data.every((r) => r.geographyCode === "03"));
  assert.ok(result.data.every((r) => r.sectorCode === "C"));
});

test("the public MCP adapter exposes the business datasets with declared filters", async () => {
  assert.deepEqual(BUSINESS_DATASET_IDS, [
    "company_active_enterprises",
    "company_workforce",
    "company_production_value_bands",
    "company_turnover_istat",
  ]);

  const result = await queryPublicDataset({
    dataset: "company_active_enterprises",
    period: "2026-07-31",
    sector: "G",
    limit: 3,
  });
  assert.equal(result.dataset, "company_active_enterprises");
  assert.equal(result.pagination.returned, 3);
  assert.equal(result.data.length, 3);
  assert.equal(result.data[0].geographyLevel, "region");
  assert.equal(result.data[0].sectorCode, "G");
  assert.equal(result.provenance[0].license, "CC BY 4.0");
});

test("business dataset queries fail closed on unknown filters", () => {
  assert.throws(
    () => queryCompanyAtlasDataset({ dataset: "company_active_enterprises", period: "2099-01-01" }),
    /Periodo non disponibile/,
  );
  assert.throws(
    () => queryCompanyAtlasDataset({ dataset: "company_active_enterprises", region: "Atlantide" }),
    /Regione non trovata/,
  );
  assert.throws(
    () => queryCompanyAtlasDataset({ dataset: "company_active_enterprises", sector: "XYZ" }),
    /Settore ATECO non trovato/,
  );
  assert.throws(
    () => queryCompanyAtlasDataset({ dataset: "company_active_enterprises", band: "50M_OVER" }),
    /Filtro band non supportato/,
  );
  assert.throws(
    () => queryCompanyAtlasDataset({ dataset: "company_production_value_bands", band: "UNKNOWN_BAND" }),
    /Fascia di valore della produzione non trovata/,
  );
});

test("MCP server exposes business catalog, resources, and tools", () => {
  assert.equal(businessDatasetCatalog.length, 4);
  assert.deepEqual(
    businessDatasetCatalog.map((d) => d.id),
    [
      "company_active_enterprises",
      "company_workforce",
      "company_production_value_bands",
      "company_turnover_istat",
    ],
  );

  for (const dataset of businessDatasetCatalog) {
    assert.equal(dataset.freshness, "snapshot");
    assert.ok(dataset.sources.length > 0);
    assert.equal(dataset.sources[0].license, "CC BY 4.0");
    assert.ok(dataset.caveat && dataset.caveat.length > 0);
  }

  const server = createDvnsMcpServer();
  assert.ok(server);
});

test("business navigation is additive to the civic navigation", () => {
  const businessSection = PRIMARY_NAV.find((item) => item.href === "/imprese");
  assert.ok(businessSection);
  assert.ok(businessSection.children?.some((child) => child.href.includes("metric=employees")));
  assert.ok(businessSection.children?.some((child) => child.href.includes("metric=turnover")));
  assert.ok(PRIMARY_NAV.some((item) => item.href === "/spese"));
  assert.ok(PRIMARY_NAV.some((item) => item.href === "/territori"));
  assert.ok(PRIMARY_NAV.some((item) => item.href === "/fonti"));

  const businessMapGroup = SITE_MAP_GROUPS.find((group) => group.title === "Imprese");
  assert.ok(businessMapGroup);
  assert.ok(businessMapGroup.links.some((link) => link.href.includes("metric=turnover")));
  assert.ok(SITE_MAP_GROUPS.some((group) => group.title === "Soldi"));
  assert.ok(SITE_MAP_GROUPS.some((group) => group.title === "Fonti e metodo"));
});
