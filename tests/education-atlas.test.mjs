import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import "./helpers/register-ts-alias.mjs";

const {
  EDUCATION_ATLAS_ALL,
  educationAtlasPathwayOptions,
  educationAtlasPeriodOptions,
  getEducationAtlasView,
  normalizeEducationAtlasFilters,
  queryEducationAtlasDataset,
} = await import("../src/lib/education-atlas.ts");
const { educationDatasetCatalog } = await import("../src/lib/mcp/catalog.ts");
const { validateEducationAtlasSnapshot } = await import("../src/lib/education-atlas-contract.ts");
const { PRIMARY_NAV, SITE_MAP_GROUPS } = await import("../src/lib/site-navigation.ts");

const snapshot = (await import("../src/data/generated/education-atlas-snapshot.json", { with: { type: "json" } })).default;
const sourceFileManifest = (await import("../src/data/generated/education-atlas-source-files.json", { with: { type: "json" } })).default;

function coverage(period, schoolType) {
  return snapshot.coverage.byPeriodSchoolType[period][schoolType];
}

test("the education snapshot is aggregate-only and reconciles the MIM files", () => {
  assert.equal(snapshot.schemaVersion, 1);
  assert.equal(snapshot.observationType, "aggregate");
  assert.equal(snapshot.geographyLevel, "region");
  assert.deepEqual(snapshot.periods.map((period) => period.id), ["202223", "202324", "202425"]);
  assert.equal(snapshot.regions.length, 20);
  assert.equal(snapshot.coverage.observedRegionCount, 18);
  assert.equal(snapshot.coverage.expectedRegionCount, 20);
  assert.deepEqual(snapshot.coverage.missingRegionCodes, ["02", "04"]);
  assert.equal(snapshot.regionalObservations.length, 108);
  assert.equal(snapshot.pathwayObservations.length, 1086);
  assert.equal(snapshot.addressObservations.length, 6677);
  assert.equal(snapshot.sourceFiles.length, 12);
  assert.ok(snapshot.sourceFiles.every((file) => /^[a-f0-9]{64}$/.test(file.sha256)));
  assert.ok(snapshot.sourceFiles.every((file) => file.url.startsWith("https://dati.istruzione.it/")));
  assert.deepEqual(sourceFileManifest.files, snapshot.sourceFiles);
  assert.ok(snapshot.sources.every((source) => source.license === "IODL 2.0"));
  assert.ok(snapshot.sources.every((source) => source.licenseUrl === "http://www.dati.gov.it/iodl/2.0/"));
  assert.ok(snapshot.sources.every((source) => source.verifiedAt === snapshot.verifiedAt));
  assert.equal(snapshot.sources.find((source) => source.id === "students")?.publishedAt, "2026-02-23");
  assert.equal(snapshot.sources.find((source) => source.id === "registry")?.publishedAt, "2026-06-18");
  assert.ok(snapshot.sources.every((source) => source.latestDataAsOf === "2025-08-31"));
  assert.ok(snapshot.sourceFiles.every((file) => file.publishedAt && file.dataAsOf));
  assert.ok(snapshot.sourceFiles.filter((file) => file.period === "202425").every((file) => file.dataAsOf === "2025-08-31"));
  assert.equal(
    snapshot.sourceFiles.find((file) => file.role === "registry" && file.schoolType === "state")?.publishedAt,
    "2026-06-18",
  );
  assert.equal(
    snapshot.sourceFiles.find((file) => file.role === "registry" && file.schoolType === "paritaria")?.publishedAt,
    "2026-06-18",
  );

  for (const schoolType of ["state", "paritaria"]) {
    assert.equal(coverage("202425", schoolType).matchedRows, coverage("202425", schoolType).sourceRows);
    assert.equal(coverage("202425", schoolType).unmatchedRows, 0);
    assert.equal(
      coverage("202425", schoolType).studentCount,
      snapshot.regionalObservations
        .filter((row) => row.period === "202425" && row.schoolType === schoolType)
        .reduce((sum, row) => sum + row.studentCount, 0),
    );
  }

  const forbiddenKeys = [
    "schoolName", "denominazioneScuola", "email", "physicalAddress", "indirizzoFisico",
    "codiceScuola", "cf", "studentName", "studentId",
  ];
  for (const row of [...snapshot.regionalObservations, ...snapshot.pathwayObservations, ...snapshot.addressObservations]) {
    for (const key of forbiddenKeys) assert.ok(!Object.hasOwn(row, key), `Forbidden key ${key}`);
  }
});

test("the education contract rejects taxonomy, source URL and receipt drift", () => {
  const unknownPathway = structuredClone(snapshot);
  unknownPathway.pathwayObservations[0].pathwayCode = "UNKNOWN";
  assert.throws(() => validateEducationAtlasSnapshot(unknownPathway));

  const arbitrarySourceUrl = structuredClone(snapshot);
  arbitrarySourceUrl.sourceFiles[0].url = "https://example.test/source.csv";
  assert.throws(() => validateEducationAtlasSnapshot(arbitrarySourceUrl));

  const arbitraryDatasetUrl = structuredClone(snapshot);
  arbitraryDatasetUrl.sources[0].url = "https://example.test/catalog.csv";
  assert.throws(() => validateEducationAtlasSnapshot(arbitraryDatasetUrl));

  const emptyReceipt = structuredClone(snapshot);
  emptyReceipt.sourceFiles[0].rows = 0;
  assert.throws(() => validateEducationAtlasSnapshot(emptyReceipt));

  const incompleteRegionalCoverage = structuredClone(snapshot);
  incompleteRegionalCoverage.regionalObservations[0].regionCode = "02";
  incompleteRegionalCoverage.regionalObservations[0].regionName = "Valle d'Aosta";
  assert.throws(() => validateEducationAtlasSnapshot(incompleteRegionalCoverage));
});

test("education trend and regional view keep missing territories explicit", () => {
  const national = getEducationAtlasView();
  assert.equal(national.period, "202425");
  assert.equal(national.region, EDUCATION_ATLAS_ALL);
  assert.equal(national.schoolType, EDUCATION_ATLAS_ALL);
  assert.equal(national.pathway, EDUCATION_ATLAS_ALL);
  assert.equal(national.regionPoints.length, 20);
  assert.equal(national.nationalValue, 2_632_660);
  assert.equal(national.regionPoints.find((region) => region.code === "02")?.value, null);
  assert.equal(national.regionPoints.find((region) => region.code === "04")?.value, null);
  assert.equal(national.regionPoints.filter((region) => region.value !== null).length, 18);
  assert.equal(national.trend.length, 3);
  assert.deepEqual(
    national.trend.map(({ period, periodLabel, value }) => ({ period, periodLabel, value })),
    [
      { period: "202223", periodLabel: "2022/23", value: 2_650_266 },
      { period: "202324", periodLabel: "2023/24", value: 2_639_838 },
      { period: "202425", periodLabel: "2024/25", value: 2_632_660 },
    ],
  );
  assert.equal(national.addressRanking.length, 14);
  assert.ok(national.pathwayBreakdown[0].value > 0);

  const campania = getEducationAtlasView({ region: "Campania", schoolType: "state", pathway: "SCIENTIFICO" });
  assert.equal(campania.selectedRegion?.code, "15");
  assert.equal(campania.selectedPathwayLabel, "Scientifico");
  assert.equal(campania.trend.length, 3);
  assert.ok((campania.perimeterValue ?? 0) > 0);
  assert.ok(campania.addressRanking.every((row) => row.pathwayCode === "SCIENTIFICO"));

  const uncovered = getEducationAtlasView({ region: "02" });
  assert.equal(uncovered.perimeterValue, null);
  assert.equal(uncovered.pathwayBreakdown.length, 0);
  assert.equal(uncovered.addressRanking.length, 0);
  assert.ok(uncovered.trend.every((point) => point.value === null));

  const normalized = normalizeEducationAtlasFilters({ schoolType: "statali", pathway: "scientifico", region: "lombardia" });
  assert.deepEqual(normalized, { period: "202425", region: "03", schoolType: "state", pathway: "SCIENTIFICO" });
});

test("education MCP dataset has bounded pagination, provenance and closed filters", () => {
  const result = queryEducationAtlasDataset({
    period: "202425",
    schoolType: "state",
    pathway: "SCIENTIFICO",
    limit: 7,
  });
  assert.equal(result.dataset, "education_students_by_pathway");
  assert.equal(result.pagination.limit, 7);
  assert.equal(result.pagination.returned, 7);
  assert.equal(result.data.length, 7);
  assert.ok(result.data.every((row) => row.period === "202425" && row.pathwayCode === "SCIENTIFICO"));
  assert.equal(result.provenance.length, 12);
  assert.ok(result.provenance.every((file) => file.url && file.role && file.publishedAt && file.dataAsOf && file.sha256 && file.bytes > 0 && file.rows > 0));
  assert.ok(result.sources.every((source) => source.licenseUrl === "http://www.dati.gov.it/iodl/2.0/"));
  assert.equal(result.sources.length, 2);
  assert.match(result.caveat, /non misurano qualità/i);
  assert.throws(() => queryEducationAtlasDataset({ region: "Atlantide" }), /Regione non trovata/);
  assert.throws(() => queryEducationAtlasDataset({ pathway: "inesistente" }), /Percorso non trovato/);
  assert.throws(() => queryEducationAtlasDataset({ schoolType: "privata" }), /Tipo di scuola non valido/);
  assert.ok(educationAtlasPeriodOptions().some((period) => period.id === "202425"));
  assert.ok(educationAtlasPathwayOptions().some((pathway) => pathway.code === "SCIENTIFICO"));
});

test("education is an existing Atlante module in the navigation and MCP catalog", () => {
  assert.equal(educationDatasetCatalog.length, 1);
  assert.equal(educationDatasetCatalog[0].id, "education_students_by_pathway");
  assert.equal(educationDatasetCatalog[0].freshness, "snapshot");
  assert.equal(educationDatasetCatalog[0].sources.length, 12);
  assert.ok(educationDatasetCatalog[0].sources.every((source) => source.url && source.role && source.publishedAt && source.dataAsOf && source.licenseUrl && source.sha256 && source.bytes > 0 && source.rows > 0));
  const businessSection = PRIMARY_NAV.find((item) => item.href === "/imprese");
  assert.ok(!businessSection?.aliases?.includes("/istruzione"));
  assert.ok(!businessSection?.children?.some((child) => child.href === "/istruzione"));
  assert.equal(PRIMARY_NAV.find((item) => item.href === "/istruzione")?.label, "Istruzione");
  const businessMapGroup = SITE_MAP_GROUPS.find((group) => group.title === "Imprese");
  assert.ok(!businessMapGroup?.links.some((link) => link.href === "/istruzione"));
  const educationMapGroup = SITE_MAP_GROUPS.find((group) => group.title === "Istruzione");
  assert.ok(educationMapGroup?.links.some((link) => link.href === "/istruzione"));
});

test("education period choices stay visible and keyboard-operable", async () => {
  const [component, css] = await Promise.all([
    readFile(new URL("../src/components/education-atlas-filters.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/education-atlas-filters.module.css", import.meta.url), "utf8"),
  ]);

  assert.match(component, /<fieldset className=\{styles\.periodFieldset\}>/);
  assert.match(component, /<legend>Anno scolastico<\/legend>/);
  assert.match(component, /aria-pressed=\{filters\.period === option\.id\}/);
  assert.match(component, /data-value=\{option\.id\}/);
  assert.doesNotMatch(component, /<select[\s\S]*?data-education-filter="period"/);
  assert.match(css, /\.periodOptions button \{[\s\S]*?min-height: 42px;/);
  assert.match(css, /\.periodOptions button:focus-visible/);
});

test("education trend exposes the year-over-year series as a chart with an exact data table", async () => {
  const [page, chart, css] = await Promise.all([
    readFile(new URL("../src/app/istruzione/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/app/istruzione/education-trend-chart.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/app/istruzione/education-trend-chart.module.css", import.meta.url), "utf8"),
  ]);

  assert.match(page, /import \{ EducationTrendChart \} from "\.\/education-trend-chart"/);
  assert.match(page, /<EducationTrendChart data=\{view\.trend\} \/>/);
  assert.match(chart, /^"use client";/);
  assert.match(chart, /<LineChart/);
  assert.match(chart, /data=\{chartData\}/);
  assert.match(chart, /dataKey="periodLabel"/);
  assert.match(chart, /dataKey="students"/);
  assert.match(chart, /ChartDataTable/);
  assert.match(chart, /Studenti osservati per anno scolastico/);
  assert.match(chart, /exactStudentLabel\(point\.value\)/);
  assert.match(chart, /value === null \? "n\.d\."/);
  assert.match(chart, /percent\(share\)/);
  assert.match(chart, /isAnimationActive=\{false\}/);
  assert.match(chart, /role="img"/);
  assert.match(chart, /periodRangeLabel\(chartData\)/);
  assert.doesNotMatch(chart, /dal 2022\/23 al 2024\/25/);
  assert.match(chart, /<Tooltip[\s\S]*content=\{<TooltipContent \/>\}/);
  assert.match(chart, /rows=\{chartData\.map/);
  assert.match(chart, /var\(--chart-primary\)/);
  assert.match(css, /var\(--color-on-strong\)/);
  assert.match(css, /\.chart \{[\s\S]*height: 240px;/);
  assert.match(css, /@media \(max-width: 520px\)[\s\S]*\.chart \{[\s\S]*height: 220px;/);
});
