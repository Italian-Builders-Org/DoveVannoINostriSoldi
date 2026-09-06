import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";
import "./helpers/register-ts-alias.mjs";

const { monthlyReports } = await import("../src/lib/monthly-reports.ts");
const { monthlyReportWordCount, monthlyReportReadingMinutes } = await import("../src/lib/monthly-reports-contract.ts");
const { searchSiteDocuments } = await import("../src/lib/global-search.ts");
const { PRIMARY_NAV, SITE_MAP_GROUPS } = await import("../src/lib/site-navigation.ts");
const { PUBLISHED_MONTHLY_REPORT_PATHS, PUBLIC_INDEXABLE_PATHS, LLMS_DISCOVERY_PATHS } = await import("../src/lib/public-discovery.ts");

const publishedUrl = new URL("../src/content/monthly-reports/published/2026-08.ts", import.meta.url);

test("articolo Markdown coincide con la capsula e discovery copre ogni edizione", async () => {
  const { monthlyReportMarkdown } = await import("../scripts/reports/export-monthly-report.mjs");
  const report = monthlyReports.getPublished("2026-08");
  assert.equal(await readFile(new URL("../docs/reports/2026-08.md", import.meta.url), "utf8"), monthlyReportMarkdown(report));
  assert.deepEqual([...PUBLISHED_MONTHLY_REPORT_PATHS].sort(), monthlyReports.listPublished().map((r) => r.href).sort());
});

test("agosto 2026 è una capsula pubblicata, congelata e della lunghezza prevista", async () => {
  const reports = monthlyReports.listPublished();
  assert.equal(reports.length, 1);
  assert.equal(reports[0].issueMonth, "2026-08");
  assert.equal(reports[0].href, "/report/2026-08");
  const report = monthlyReports.getPublished("2026-08");
  assert.ok(report);
  assert.equal(report.title, "Imprese e territori");
  assert.equal(report.figures.length, 2);
  assert.equal(report.figures[0].rows.length, 16);
  assert.equal(report.figures[1].rows.length, 20);
  assert.ok(monthlyReportWordCount(report) >= 1_000 && monthlyReportWordCount(report) <= 1_400);
  assert.ok(monthlyReportReadingMinutes(report) >= 5 && monthlyReportReadingMinutes(report) <= 7);
  assert.equal(report.publication.dataCutoff, "2026-09-05");
  assert.equal(report.contentRevision, 1);
  assert.deepEqual(report.corrections, []);

  const source = await readFile(publishedUrl, "utf8");
  assert.doesNotMatch(source, /data\/generated|content\/monthly-reports\/drafts|\/Users\/|localhost|fetch\s*\(/);
});

test("il racconto territoriale coincide con gli stock e le variazioni congelate", () => {
  const report = monthlyReports.getPublished("2026-08");
  const rows = report.figures[1].rows;
  const growing = rows.filter((row) => row.values.delta.value > 0);
  assert.equal(growing.length, 6);
  assert.match(report.rubrics.territories.paragraphs[1].text, /^Sei regioni mostrano/);
  for (const row of rows) {
    const { previous, current, delta, change } = row.values;
    assert.equal(current.value - previous.value, delta.value);
    assert.equal(Math.round(delta.value / previous.value * 10000), change.basisPoints);
  }
  assert.equal(report.publication.publishedOn, "2026-09-06");
});

test("bozze, mesi sconosciuti e dati correnti restano fuori dal pubblico", async () => {
  assert.equal(monthlyReports.getPublished("2026-09"), null);
  const drafts = await readdir(new URL("../src/content/monthly-reports/drafts/", import.meta.url));
  assert.deepEqual(drafts, ["README.md"]);
  const route = await readFile(new URL("../src/app/report/[issueMonth]/page.tsx", import.meta.url), "utf8");
  assert.match(route, /generateStaticParams/);
  assert.match(route, /dynamicParams = false/);
  assert.match(route, /if \(!report\) notFound\(\)/);
  assert.match(route, /type: "article"/);
  assert.match(route, /publishedTime/);
  assert.match(route, /alternates: \{ canonical \}/);
});

test("navigazione, home, ricerca, sitemap e discovery espongono archivio ed edizione", async () => {
  assert.deepEqual(PRIMARY_NAV.slice(0, 2).map((item) => item.href), ["/", "/report"]);
  assert.equal(PRIMARY_NAV[1].icon, "news");
  const reportGroup = SITE_MAP_GROUPS.find((group) => group.title === "Report mensili");
  assert.deepEqual(reportGroup?.links.map((link) => link.href), ["/report", "/report/2026-08"]);

  const navigation = await readFile(new URL("../src/components/navigation.tsx", import.meta.url), "utf8");
  assert.match(navigation, /News01Icon/);
  const home = await readFile(new URL("../src/app/page.tsx", import.meta.url), "utf8");
  assert.ok(home.indexOf("LatestMonthlyReportTeaser") < home.indexOf("rankPanel"));

  const result = searchSiteDocuments("imprese territori").find((item) => item.href === "/report/2026-08");
  assert.equal(result?.title, "Agosto 2026: Imprese e territori");
  assert.deepEqual(PUBLISHED_MONTHLY_REPORT_PATHS, ["/report/2026-08"]);
  for (const path of ["/report", "/report/2026-08"]) {
    assert.equal(PUBLIC_INDEXABLE_PATHS.includes(path), true);
    assert.equal(LLMS_DISCOVERY_PATHS.includes(path), true);
  }
});

test("grafici e tabelle condividono le stesse righe e i fallback accessibili", async () => {
  const report = monthlyReports.getPublished("2026-08");
  assert.ok(report);
  for (const figure of report.figures) {
    for (const row of figure.rows) {
      assert.deepEqual(Object.keys(row.values).sort(), figure.series.map((series) => series.id).sort());
    }
    assert.ok(figure.accessibleSummary.length > 40);
    assert.ok(figure.caveat.length > 20);
  }
  const figureComponent = await readFile(new URL("../src/components/monthly-report-figure.tsx", import.meta.url), "utf8");
  const tableComponent = await readFile(new URL("../src/components/charts/chart-data-table.tsx", import.meta.url), "utf8");
  assert.match(figureComponent, /figure\.rows\.map/);
  assert.match(figureComponent, /ChartDataTable/);
  assert.match(figureComponent, /role="img"/);
  assert.match(tableComponent, /<caption/);
  assert.match(tableComponent, /scope="col"/);
  assert.match(tableComponent, /scope="row"/);
  assert.match(tableComponent, /tabIndex=\{0\}/);
});
