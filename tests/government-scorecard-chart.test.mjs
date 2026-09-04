import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import "./helpers/register-ts-alias.mjs";

const {
  getClosestGovernmentChartPointIndex,
  GOVERNMENT_SCORECARD_V6_CHART_VIEWBOX,
} = await import("../src/app/governi/_components/chart-geometry.ts");
const {
  formatGovernmentChartPeriod,
  formatGovernmentChartPublicationStatus,
  formatGovernmentChartPointStatus,
  GOVERNMENT_CHART_COLORS,
  hasGovernmentChartTrend,
  isGovernmentChartPointInWindow,
  isGovernmentChartStartBoundaryPeriod,
  splitGovernmentChartAtMissingPeriods,
} = await import("../src/app/governi/_components/chart-utils.ts");

test("pointer positions map to the closest bounded chart period", () => {
  assert.equal(getClosestGovernmentChartPointIndex(0, 100), null);
  assert.equal(getClosestGovernmentChartPointIndex(1, 100), 0);
  assert.equal(getClosestGovernmentChartPointIndex(5, -100), 0);
  assert.equal(getClosestGovernmentChartPointIndex(5, 10_000), 4);
  assert.equal(getClosestGovernmentChartPointIndex(5, GOVERNMENT_SCORECARD_V6_CHART_VIEWBOX.left), 0);
});

test("missing observations break lines instead of inventing intermediate values", () => {
  const points = [
    { period: "2020", value: 1 },
    { period: "2021", value: 2 },
    { period: "2023", value: 4 },
  ];
  assert.deepEqual(splitGovernmentChartAtMissingPeriods(points, ["2020", "2021", "2022", "2023"]), [
    points.slice(0, 2),
    points.slice(2),
  ]);
  assert.equal(formatGovernmentChartPeriod("2024-Q3"), "2024 T3");
  assert.equal(formatGovernmentChartPeriod("2024-06"), "2024-06");
  assert.equal(formatGovernmentChartPublicationStatus("observed"), "");
  assert.equal(formatGovernmentChartPublicationStatus("provisional"), " · provvisorio");
  assert.equal(formatGovernmentChartPublicationStatus("estimated"), " · stimato");
  assert.equal(formatGovernmentChartPointStatus({ status: "observed", quality_notes: ["interruzione nella serie"] }), " · interruzione nella serie");
  assert.equal(formatGovernmentChartPointStatus({ status: "provisional", quality_notes: ["definizione diversa", "bassa affidabilità"] }), " · provvisorio, definizione diversa, bassa affidabilità");
  assert.equal(hasGovernmentChartTrend(["2024"]), false);
  assert.equal(hasGovernmentChartTrend(["2024", "2025"]), true);
});

test("mandate windows exclude the successor oath while complete series include their final point", () => {
  assert.equal(isGovernmentChartPointInWindow("2018-05-01", "2016-12-12", "2018-06-01", true), true);
  assert.equal(isGovernmentChartPointInWindow("2018-06-01", "2016-12-12", "2018-06-01", true), false);
  assert.equal(isGovernmentChartPointInWindow("2018-06-01", "2016-12-12", "2018-06-01", false), true);
  assert.equal(isGovernmentChartPointInWindow("2024-01-01", "2022-10-22", "2024-01-01", false, "Annuale"), true);
  assert.equal(isGovernmentChartPointInWindow("2022-01-01", "2022-10-22", "2024-01-01", false, "Annuale"), true);
  assert.equal(isGovernmentChartPointInWindow("2022-10-01", "2022-10-22", "2026-08-01", false, "Mensile"), true);
  assert.equal(isGovernmentChartPointInWindow("2022-09-01", "2022-10-22", "2026-08-01", false, "Mensile"), false);
  assert.equal(isGovernmentChartPointInWindow("2022-10-01", "2022-10-22", "2026-04-01", false, "Trimestrale"), true);
  assert.equal(isGovernmentChartStartBoundaryPeriod("2022-01-01", "2022-10-22", "Annuale"), true);
  assert.equal(isGovernmentChartStartBoundaryPeriod("2022-10-01", "2022-10-22", "Mensile"), true);
  assert.equal(isGovernmentChartStartBoundaryPeriod("2022-09-01", "2022-10-22", "Mensile"), false);
  assert.equal(isGovernmentChartPointInWindow("2021-01-01", "2021-02-13", "2022-10-22", true, "Annuale"), true);
  assert.equal(isGovernmentChartPointInWindow("2022-01-01", "2021-02-13", "2022-10-22", true, "Annuale"), true);
  assert.equal(isGovernmentChartPointInWindow("1996-01-01", "1995-01-17", "1996-05-18", true, "Annuale"), false);
});

test("countries use stable design tokens and accessible chart interactions", () => {
  assert.deepEqual(Object.keys(GOVERNMENT_CHART_COLORS), ["IT", "FR", "DE", "ES"]);
  assert.ok(Object.values(GOVERNMENT_CHART_COLORS).every((value) => value.startsWith("var(--chart-country-")));
  const component = readFileSync(new URL("../src/app/governi/_components/indicator-carousel.tsx", import.meta.url), "utf8");
  assert.match(component, /role="img"/);
  assert.match(component, /tabIndex=\{0\}/);
  assert.match(component, /ArrowLeft/);
  assert.match(component, /ArrowRight/);
  assert.match(component, /aria-live="polite"/);
  assert.doesNotMatch(component, /#[0-9a-f]{3,8}/i);
});
