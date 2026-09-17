import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import "./helpers/register-ts-alias.mjs";

const {
  istatTurnoverSnapshot,
  getIstatTurnoverView,
  queryIstatTurnoverDataset,
  istatTurnoverRegionOptions,
  istatTurnoverSectorOptions,
  istatTurnoverSource,
  isIstatMetric,
  istatMetricOptions,
  ISTAT_METRICS,
  normalizeIstatMetric,
} = await import("../src/lib/istat-turnover.ts");

const {
  validateIstatTurnoverSnapshot,
} = await import("../src/lib/istat-turnover-contract.ts");

const { istatTurnoverSourceMetadata } = await import("../src/lib/istat-turnover-metadata.ts");
const { queryPublicDataset } = await import("../src/lib/mcp/datasets.ts");
const {
  DATASET_IDS,
  BUSINESS_DATASET_IDS,
  businessDatasetCatalog,
  datasetCatalog,
} = await import("../src/lib/mcp/catalog.ts");

test("the generated ISTAT turnover snapshot is valid under Zod contract", () => {
  const snapshot = validateIstatTurnoverSnapshot(istatTurnoverSnapshot);

  assert.equal(snapshot.schemaVersion, 1);
  assert.equal(snapshot.observationType, "aggregate");
  assert.equal(snapshot.geographyLevel, "region");
  assert.equal(snapshot.atecoVersion, "ATECO 2007 agg. 2022");
  assert.equal(snapshot.period, "2024");
  assert.equal(snapshot.unit, "migliaia di euro");
  assert.deepEqual(snapshot.source.archive, {
    bytes: 393392,
    sha256: "d774bcd5862467aa0a7529b8b972f3fd80f85f14f7993aaf355362596960ad04",
  });
  assert.equal(snapshot.regions.length, 20);
  assert.equal(snapshot.macroSectors.length, 3);
  assert.equal(snapshot.observations.length, 60);

  for (const region of snapshot.regions) {
    assert.match(region.code, /^\d{2}$/);
    assert.ok(region.name.length > 0);
  }
});

test("the public ISTAT metrics fail closed on missing fields and broken reconciliations", () => {
  const missingField = structuredClone(istatTurnoverSnapshot);
  delete missingField.observations[0].localUnits;
  assert.throws(() => validateIstatTurnoverSnapshot(missingField));

  const brokenRegion = structuredClone(istatTurnoverSnapshot);
  brokenRegion.observations[0].valueAddedThousandEuro += 2;
  assert.throws(() => validateIstatTurnoverSnapshot(brokenRegion), /valore aggiunto non riconcilia/i);

  const brokenNational = structuredClone(istatTurnoverSnapshot);
  brokenNational.national.localUnits += 1;
  assert.throws(() => validateIstatTurnoverSnapshot(brokenNational), /Unità locali nazionali non riconcilia/i);
});

test("Campania row in Tavola 1 equals exactly 216750478 migliaia di euro and reconciles macro-sectors", () => {
  const campaniaAll = istatTurnoverSnapshot.observations.find(
    (obs) => obs.geographyCode === "15" && obs.macroSector === "ALL",
  );
  assert.ok(campaniaAll, "Campania ALL observation must exist");
  assert.equal(campaniaAll.value, 216_750_478);
  assert.equal(campaniaAll.geographyName, "Campania");
  assert.equal(campaniaAll.period, "2024");
  assert.equal(campaniaAll.unit, "migliaia di euro");
  assert.equal(campaniaAll.atecoVersion, "ATECO 2007 agg. 2022");

  const campaniaInd = istatTurnoverSnapshot.observations.find(
    (obs) => obs.geographyCode === "15" && obs.macroSector === "INDUSTRIA",
  );
  const campaniaSer = istatTurnoverSnapshot.observations.find(
    (obs) => obs.geographyCode === "15" && obs.macroSector === "SERVIZI",
  );

  assert.ok(campaniaInd, "Campania INDUSTRIA observation must exist");
  assert.ok(campaniaSer, "Campania SERVIZI observation must exist");
  assert.equal(campaniaInd.value, 78_917_895);
  assert.equal(campaniaSer.value, 137_832_583);
  assert.equal(campaniaInd.value + campaniaSer.value, campaniaAll.value);
});

test("national turnover matches official ISTAT release aggregates", () => {
  const national = istatTurnoverSnapshot.national;
  assert.equal(national.turnoverThousandEuro, 3_768_464_269);
  assert.equal(national.industryTurnoverThousandEuro, 1_702_409_224);
  assert.equal(national.servicesTurnoverThousandEuro, 2_066_055_045);
  assert.equal(
    national.industryTurnoverThousandEuro + national.servicesTurnoverThousandEuro,
    national.turnoverThousandEuro,
  );
});

test("all observations are strictly non-nominal, aggregate-only and region-level", () => {
  const forbiddenKeys = [
    "companyName", "businessName", "name", "ragioneSociale", "denominazione",
    "vatId", "piva", "partitaIva", "cf", "taxId", "fiscalCode", "codiceFiscale",
    "address", "city", "comune", "cap", "zip",
    "revenue", "profit", "utile", "ebitda",
  ];

  for (const obs of istatTurnoverSnapshot.observations) {
    assert.equal(obs.observationType, "aggregate");
    assert.equal(obs.geographyLevel, "region");
    assert.equal(obs.atecoVersion, "ATECO 2007 agg. 2022");
    assert.equal(obs.metric, "turnover");
    assert.equal(obs.period, "2024");
    assert.equal(obs.unit, "migliaia di euro");
    assert.ok(obs.value >= 0);

    for (const key of forbiddenKeys) {
      assert.ok(!Object.hasOwn(obs, key), `Forbidden key "${key}" found in observation`);
    }
  }
});

test("MCP catalog registers company_turnover_istat and provides verified metadata", () => {
  assert.ok(DATASET_IDS.includes("company_turnover_istat"));
  assert.ok(BUSINESS_DATASET_IDS.includes("company_turnover_istat"));
  assert.ok(businessDatasetCatalog.some((d) => d.id === "company_turnover_istat"));

  const descriptor = datasetCatalog.find((d) => d.id === "company_turnover_istat");
  assert.ok(descriptor, "Descriptor for company_turnover_istat must be in datasetCatalog");
  assert.equal(descriptor.freshness, "snapshot");
  assert.ok(descriptor.sources.length >= 1);
  assert.equal(descriptor.sources[0].owner, "Istituto Nazionale di Statistica (ISTAT)");
  assert.equal(descriptor.sources[0].license, "CC BY 4.0");
  assert.match(descriptor.caveat ?? "", /ATECO 2007 agg\. 2022/);
  assert.match(descriptor.caveat ?? "", /Frame Territoriale/);
});

test("queryPublicDataset and queryIstatTurnoverDataset correctly execute queries and options", async () => {
  const allResult = await queryPublicDataset({
    dataset: "company_turnover_istat",
  });

  assert.equal(allResult.dataset, "company_turnover_istat");
  assert.equal(allResult.observationType, "aggregate");
  assert.equal(allResult.period, "2024");
  assert.equal(allResult.unit, "migliaia di euro");
  assert.equal(allResult.data.length, 50); // Default limit is 50
  assert.equal(allResult.pagination.total, 60);
  assert.equal(allResult.pagination.hasMore, true);

  // Direct query function test
  const directResult = queryIstatTurnoverDataset({
    region: "15",
    sector: "INDUSTRIA",
  });
  assert.equal(directResult.data.length, 1);
  assert.equal(directResult.data[0].value, 78_917_895);

  // Region and sector options
  const regions = istatTurnoverRegionOptions();
  assert.equal(regions.length, 20);

  const sectors = istatTurnoverSectorOptions();
  assert.equal(sectors.length, 3);

  const source = istatTurnoverSource();
  assert.equal(source.id, "istat-frame-territoriale-2024");

  // Filter by region Campania
  const campaniaResult = await queryPublicDataset({
    dataset: "company_turnover_istat",
    region: "15",
  });
  assert.equal(campaniaResult.data.length, 3);
  assert.ok(campaniaResult.data.every((r) => r.geographyCode === "15"));

  // Filter by sector Industria
  const indResult = await queryPublicDataset({
    dataset: "company_turnover_istat",
    sector: "INDUSTRIA",
    limit: 30,
  });
  assert.equal(indResult.data.length, 20);
  assert.ok(indResult.data.every((r) => r.macroSector === "INDUSTRIA"));
});

test("getIstatTurnoverView builds compliant view for dashboard", () => {
  const nationalView = getIstatTurnoverView();
  assert.equal(nationalView.metric, "turnover");
  assert.equal(nationalView.metricLabel, "Fatturato aggregato");
  assert.equal(nationalView.period, "2024");
  assert.equal(nationalView.nationalValue, 3_768_464_269);
  assert.equal(nationalView.regionPoints.length, 20);
  assert.equal(nationalView.ranking.length, 20);
  assert.equal(nationalView.ranking[0].code, "03"); // Lombardia is #1
  assert.equal(nationalView.sectorBreakdown.length, 2);

  const campaniaView = getIstatTurnoverView({ region: "15" });
  assert.equal(campaniaView.selectedRegion?.code, "15");
  assert.equal(campaniaView.selectedRegion?.name, "Campania");
  assert.equal(campaniaView.selectedRegion?.value, 216_750_478);
});

test("turnover sector list shows the ISTAT label once, without the 22px ATECO code column", async () => {
  const pageSource = await readFile(new URL("../src/app/imprese/page.tsx", import.meta.url), "utf8");
  const turnoverBlock = pageSource.slice(
    pageSource.indexOf("isIstatView"),
    pageSource.indexOf("const view = getCompanyAtlasView"),
  );

  assert.match(turnoverBlock, /sectorLabelPlain/);
  assert.doesNotMatch(turnoverBlock, /<b>\{sector\.code\}<\/b>/);
  assert.match(turnoverBlock, /\{sector\.label\}/);
  assert.match(turnoverBlock, /turnoverView\.caveats\.map/);
});

test("fonti lists the lightweight ISTAT turnover source next to the camera sources", async () => {
  const pageSource = await readFile(new URL("../src/app/fonti/page.tsx", import.meta.url), "utf8");

  assert.match(pageSource, /@\/lib\/istat-turnover-metadata/);
  assert.doesNotMatch(pageSource, /@\/lib\/istat-turnover["']/);
  assert.match(pageSource, /Frame Territoriale Anticipato/);
  assert.match(pageSource, /fatturato individuale/);
  assert.deepEqual(istatTurnoverSourceMetadata, istatTurnoverSnapshot.source);
  assert.deepEqual(istatTurnoverSourceMetadata, istatTurnoverSource());
});

test("isIstatMetric recognizes all ISTAT metrics and aliases while leaving InfoCamere metrics untouched", () => {
  // Supported ISTAT metrics
  assert.equal(isIstatMetric("turnover"), true);
  assert.equal(isIstatMetric("company_turnover_istat"), true);
  assert.equal(isIstatMetric("fatturato"), true);
  assert.equal(isIstatMetric("istat_local_units"), true);
  assert.equal(isIstatMetric("local_units_istat"), true);
  assert.equal(isIstatMetric("local_units"), true);
  assert.equal(isIstatMetric("istat_employees"), true);
  assert.equal(isIstatMetric("employees_istat"), true);
  assert.equal(isIstatMetric("istat_value_added"), true);
  assert.equal(isIstatMetric("value_added_istat"), true);
  assert.equal(isIstatMetric("value_added"), true);
  assert.equal(isIstatMetric("istat_value_added_per_employee"), true);
  assert.equal(isIstatMetric("value_added_per_employee"), true);
  assert.equal(isIstatMetric("produttivita"), true);
  assert.equal(isIstatMetric("istat_turnover_per_employee"), true);
  assert.equal(isIstatMetric("turnover_per_employee"), true);
  assert.equal(isIstatMetric("istat_not_a_metric"), false);
  assert.equal(isIstatMetric("random_istat"), false);

  // InfoCamere metrics must NOT be intercepted as ISTAT
  assert.equal(isIstatMetric("active_enterprises"), false);
  assert.equal(isIstatMetric("employees"), false); // InfoCamere workforce metric
  assert.equal(isIstatMetric("active_local_units"), false);
  assert.equal(isIstatMetric("production_value_band_count"), false);
  assert.equal(isIstatMetric(undefined), false);
  assert.equal(isIstatMetric(""), false);
});

test("normalizeIstatMetric maps metric IDs and aliases correctly", () => {
  assert.equal(normalizeIstatMetric("turnover"), "turnover");
  assert.equal(normalizeIstatMetric("company_turnover_istat"), "turnover");
  assert.equal(normalizeIstatMetric("fatturato"), "turnover");
  assert.equal(normalizeIstatMetric("istat_local_units"), "istat_local_units");
  assert.equal(normalizeIstatMetric("local_units_istat"), "istat_local_units");
  assert.equal(normalizeIstatMetric("local_units"), "istat_local_units");
  assert.equal(normalizeIstatMetric("istat_employees"), "istat_employees");
  assert.equal(normalizeIstatMetric("employees_istat"), "istat_employees");
  assert.equal(normalizeIstatMetric("istat_value_added"), "istat_value_added");
  assert.equal(normalizeIstatMetric("value_added"), "istat_value_added");
  assert.equal(normalizeIstatMetric("istat_value_added_per_employee"), "istat_value_added_per_employee");
  assert.equal(normalizeIstatMetric("value_added_per_employee"), "istat_value_added_per_employee");
  assert.equal(normalizeIstatMetric("produttivita"), "istat_value_added_per_employee");
  assert.equal(normalizeIstatMetric("istat_turnover_per_employee"), "istat_turnover_per_employee");
  assert.equal(normalizeIstatMetric("turnover_per_employee"), "istat_turnover_per_employee");
  assert.equal(normalizeIstatMetric(undefined), "turnover");
  assert.equal(normalizeIstatMetric("unknown_xyz"), "turnover");
});

test("istatMetricOptions exposes all 6 metrics with explicit descriptions, units, and formats", () => {
  const options = istatMetricOptions();
  assert.equal(options.length, 6);
  assert.deepEqual(
    options.map((o) => o.id),
    [
      "turnover",
      "istat_local_units",
      "istat_employees",
      "istat_value_added",
      "istat_value_added_per_employee",
      "istat_turnover_per_employee",
    ],
  );

  for (const item of ISTAT_METRICS) {
    assert.ok(item.label.length > 0);
    assert.ok(item.metricLabel.length > 0);
    assert.ok(item.shortLabel.length > 0);
    assert.ok(item.unit.length > 0);
    assert.ok(item.description.length > 0);
    assert.ok(item.caveat.length > 0);
    assert.ok(["thousand-euro", "integer", "decimal", "euro-per-employee"].includes(item.format));
  }
});

test("getIstatTurnoverView correctly calculates and returns local units", () => {
  const nationalView = getIstatTurnoverView({ metric: "istat_local_units" });
  assert.equal(nationalView.metric, "istat_local_units");
  assert.equal(nationalView.metricLabel, "Unità locali (ISTAT)");
  assert.equal(nationalView.metricUnit, "unità locali");
  assert.equal(nationalView.metricFormat, "integer");
  assert.equal(nationalView.nationalValue, 1_972_649);
  assert.equal(nationalView.regionPoints.length, 20);

  // National sector breakdown
  assert.equal(nationalView.sectorBreakdown[0].value, 544_980); // Industria
  assert.equal(nationalView.sectorBreakdown[1].value, 1_427_669); // Servizi
  assert.equal(
    nationalView.sectorBreakdown[0].value + nationalView.sectorBreakdown[1].value,
    nationalView.nationalValue,
  );

  // Campania regional view
  const campaniaView = getIstatTurnoverView({ metric: "istat_local_units", region: "15" });
  assert.equal(campaniaView.selectedRegion?.code, "15");
  assert.equal(campaniaView.selectedRegion?.name, "Campania");
  assert.equal(campaniaView.selectedRegion?.value, 179_367);
  assert.equal(campaniaView.sectorBreakdown[0].value, 48_885); // Industria
  assert.equal(campaniaView.sectorBreakdown[1].value, 130_482); // Servizi
  assert.equal(
    campaniaView.sectorBreakdown[0].value + campaniaView.sectorBreakdown[1].value,
    campaniaView.selectedRegion?.value,
  );
});

test("getIstatTurnoverView correctly calculates and returns employees", () => {
  const nationalView = getIstatTurnoverView({ metric: "istat_employees" });
  assert.equal(nationalView.metric, "istat_employees");
  assert.equal(nationalView.metricLabel, "Addetti (ISTAT)");
  assert.equal(nationalView.metricUnit, "addetti");
  assert.equal(nationalView.metricFormat, "decimal");
  assert.equal(nationalView.nationalValue, 15_332_958.22);
  assert.equal(nationalView.sectorBreakdown[0].value, 5_356_775.67); // Industria
  assert.equal(nationalView.sectorBreakdown[1].value, 9_976_182.55); // Servizi
  assert.equal(
    Math.round((nationalView.sectorBreakdown[0].value + nationalView.sectorBreakdown[1].value) * 100),
    Math.round(nationalView.nationalValue * 100),
  );

  // Campania regional view
  const campaniaView = getIstatTurnoverView({ metric: "istat_employees", region: "15" });
  assert.equal(campaniaView.selectedRegion?.value, 1_087_048.37);
  assert.equal(campaniaView.sectorBreakdown[0].value, 342_967.35); // Industria
  assert.equal(campaniaView.sectorBreakdown[1].value, 744_081.02); // Servizi
  assert.equal(
    Math.round((campaniaView.sectorBreakdown[0].value + campaniaView.sectorBreakdown[1].value) * 100),
    Math.round(campaniaView.selectedRegion.value * 100),
  );
});

test("getIstatTurnoverView correctly calculates and returns value added", () => {
  const nationalView = getIstatTurnoverView({ metric: "istat_value_added" });
  assert.equal(nationalView.metric, "istat_value_added");
  assert.equal(nationalView.metricLabel, "Valore aggiunto aggregato");
  assert.equal(nationalView.metricUnit, "migliaia di euro");
  assert.equal(nationalView.metricFormat, "thousand-euro");
  assert.equal(nationalView.nationalValue, 960_538_669);
  assert.equal(nationalView.sectorBreakdown[0].value, 434_968_295); // Industria
  assert.equal(nationalView.sectorBreakdown[1].value, 525_570_374); // Servizi
  assert.equal(
    nationalView.sectorBreakdown[0].value + nationalView.sectorBreakdown[1].value,
    nationalView.nationalValue,
  );

  // Campania regional view
  const campaniaView = getIstatTurnoverView({ metric: "istat_value_added", region: "15" });
  assert.equal(campaniaView.selectedRegion?.value, 52_725_025);
  assert.equal(campaniaView.sectorBreakdown[0].value, 21_589_486); // Industria
  assert.equal(campaniaView.sectorBreakdown[1].value, 31_135_539); // Servizi
  assert.equal(
    campaniaView.sectorBreakdown[0].value + campaniaView.sectorBreakdown[1].value,
    campaniaView.selectedRegion.value,
  );
});

test("getIstatTurnoverView correctly calculates per-employee derived metrics", () => {
  // Value Added per employee (apparent labour productivity)
  const vaPerEmpNat = getIstatTurnoverView({ metric: "istat_value_added_per_employee" });
  assert.equal(vaPerEmpNat.metric, "istat_value_added_per_employee");
  assert.equal(vaPerEmpNat.metricUnit, "euro per addetto");
  assert.equal(vaPerEmpNat.metricFormat, "euro-per-employee");
  assert.match(vaPerEmpNat.caveats.join(" "), /Indicatore derivato/i);
  const expectedNatVa = (960_538_669 * 1000) / 15_332_958.22;
  assert.ok(Math.abs(vaPerEmpNat.nationalValue - expectedNatVa) < 0.001);

  const vaPerEmpCampania = getIstatTurnoverView({ metric: "istat_value_added_per_employee", region: "15" });
  const expectedCampaniaVa = (52_725_025 * 1000) / 1_087_048.37;
  assert.ok(Math.abs((vaPerEmpCampania.selectedRegion?.value ?? 0) - expectedCampaniaVa) < 0.001);

  // Turnover per employee
  const toPerEmpNat = getIstatTurnoverView({ metric: "istat_turnover_per_employee" });
  assert.equal(toPerEmpNat.metric, "istat_turnover_per_employee");
  assert.equal(toPerEmpNat.metricUnit, "euro per addetto");
  assert.equal(toPerEmpNat.metricFormat, "euro-per-employee");
  const expectedNatTo = (3_768_464_269 * 1000) / 15_332_958.22;
  assert.ok(Math.abs(toPerEmpNat.nationalValue - expectedNatTo) < 0.001);

  const toPerEmpCampania = getIstatTurnoverView({ metric: "istat_turnover_per_employee", region: "15" });
  const expectedCampaniaTo = (216_750_478 * 1000) / 1_087_048.37;
  assert.ok(Math.abs((toPerEmpCampania.selectedRegion?.value ?? 0) - expectedCampaniaTo) < 0.001);
});

test("ranking is strictly descending and valid for every ISTAT metric", () => {
  const metrics = [
    "turnover",
    "istat_local_units",
    "istat_employees",
    "istat_value_added",
    "istat_value_added_per_employee",
    "istat_turnover_per_employee",
  ];

  for (const metric of metrics) {
    const view = getIstatTurnoverView({ metric });
    assert.equal(view.ranking.length, 20);
    assert.equal(view.regionPoints.length, 20);

    for (let i = 1; i < view.ranking.length; i++) {
      const prev = view.ranking[i - 1]?.value ?? 0;
      const curr = view.ranking[i]?.value ?? 0;
      assert.ok(
        prev >= curr,
        `Ranking for ${metric} not descending at index ${i}: ${prev} < ${curr}`,
      );
    }
  }
});
