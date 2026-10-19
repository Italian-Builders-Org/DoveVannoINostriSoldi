import assert from "node:assert/strict";
import test from "node:test";
await import("./helpers/register-ts-alias.mjs");
const {
  computeStaffPeakSummary,
  formatStaffAxisTick,
  staffChartAxisTicks,
  staffChartFlexibleAxisWidth,
  staffChartPermanentAxisWidth,
  staffChartUsesDualAxis,
} = await import("../src/lib/staff-series-chart.ts");

test("axis ticks use integer labels without clipping placeholders", () => {
  const ticks = staffChartAxisTicks(25_523, 5);
  assert.ok(ticks.includes(0));
  assert.ok(ticks.at(-1) >= 25_523);
  for (const tick of ticks) {
    const label = formatStaffAxisTick(tick, "permanent");
    assert.doesNotMatch(label, /NaN|undefined/);
    assert.match(label, /^\d{1,3}(\.\d{3})*$/);
  }
});

test("dual axis when permanent dwarfs flexible", () => {
  const roma = Array.from({ length: 15 }, (_, index) => ({
    year: 2010 + index,
    permanent: 25_523 - index * 200,
    flexible: 1_700 + index,
  }));
  assert.equal(staffChartUsesDualAxis(roma), true);
  const tiny = [{ year: 2024, permanent: 3, flexible: 1 }];
  assert.equal(staffChartUsesDualAxis(tiny), false);
});

test("peak summary is not always 2010", () => {
  const ade = [
    { year: 2010, permanent: 40_000, flexible: 0 },
    { year: 2014, permanent: 41_088, flexible: 0 },
    { year: 2024, permanent: 38_000, flexible: 0 },
  ];
  const peak = computeStaffPeakSummary(ade);
  assert.equal(peak.peakYear, 2014);
  assert.equal(peak.peakPermanent, 41_088);
  assert.equal(peak.deltaPeak, -3_088);
});

test("flexible axis allows decimals from 2021", () => {
  assert.equal(formatStaffAxisTick(1729.51, "flexible"), "1.729,51");
  assert.equal(formatStaffAxisTick(1729, "flexible"), "1.729");
});

test("axis widths scale with national totals", () => {
  assert.ok(staffChartPermanentAxisWidth(3_388_794) >= staffChartPermanentAxisWidth(25_523));
  assert.ok(staffChartFlexibleAxisWidth(128_115) >= staffChartFlexibleAxisWidth(1_729));
});
