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
    pageSource.indexOf("isTurnover"),
    pageSource.indexOf("const view = getCompanyAtlasView"),
  );

  assert.match(turnoverBlock, /sectorLabelPlain/);
  assert.doesNotMatch(turnoverBlock, /<b>\{sector\.code\}<\/b>/);
  assert.match(turnoverBlock, /\{sector\.label\}/);
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
