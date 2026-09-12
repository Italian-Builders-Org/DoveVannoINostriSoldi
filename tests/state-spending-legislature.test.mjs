import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import "./helpers/register-ts-alias.mjs";

const {
  LEGISLATURES,
  MAX_CONSUNTIVO_YEAR,
  getLegislatureSpendingCycles,
  fullYearsWithinLegislature,
} = await import("../src/lib/state-spending-legislature.ts");
const { queryPublicDataset } = await import("../src/lib/mcp/datasets.ts");

function annualTotal(year) {
  return {
    year,
    totalPaid: year * 1_000_000,
    source: {
      dimension: "mission",
      productCode: "PBS_SPE_RND_MIS_ANN",
      packageId: `package-${year}`,
      name: `package-${year}`,
      title: `Consuntivo ${year}`,
      notes: "",
      referenceYear: year,
      metadataModified: `${year}-12-31T00:00:00Z`,
      csvUrl: `https://bdap-opendata.rgs.mef.gov.it/${year}.csv`,
      apiUrl: `https://bdap-opendata.rgs.mef.gov.it/${year}`,
      releaseKind: "consuntivo",
      referenceMonth: null,
    },
  };
}

test("legislature page uses the shared persistent OpenBDAP cache", () => {
  const page = readFileSync("src/app/stato/legislature/page.tsx", "utf8");
  assert.match(page, /getCachedLegislatureSpendingCycles\(\)/);
  assert.match(page, /export const maxDuration = 60/);
  assert.match(page, /anni solari completi già pubblicati/);
});

test("legislature dates are chronological and complete legislatures have a known end", () => {
  for (let index = 1; index < LEGISLATURES.length; index += 1) {
    const previous = LEGISLATURES[index - 1];
    const current = LEGISLATURES[index];
    assert.ok(
      new Date(previous.electionDate).getTime() < new Date(current.electionDate).getTime(),
      `${previous.number} -> ${current.number} deve essere in ordine cronologico`,
    );
  }
  const ongoing = LEGISLATURES.filter((legislature) => legislature.endDate === null);
  assert.equal(ongoing.length, 1, "una sola legislatura può essere in corso");
  assert.equal(ongoing[0].number, LEGISLATURES.at(-1).number);
});

test("fullYearsWithinLegislature excludes the partial seating year and the election year that ends it", () => {
  const legislature = { number: "TEST", electionDate: "2013-02-24", startDate: "2013-03-15", endDate: "2018-03-22", source: { label: "", url: "" } };
  assert.deepEqual(fullYearsWithinLegislature(legislature, 2018), [2014, 2015, 2016, 2017]);
});

test("fullYearsWithinLegislature returns published full years for a legislature still in progress", () => {
  const legislature = { number: "TEST", electionDate: "2022-09-25", startDate: "2022-10-13", endDate: null, source: { label: "", url: "" } };
  assert.deepEqual(fullYearsWithinLegislature(legislature, null), []);
  assert.deepEqual(fullYearsWithinLegislature(legislature, null, 2024), [2023, 2024]);
  assert.deepEqual(fullYearsWithinLegislature(legislature, null, MAX_CONSUNTIVO_YEAR), [2023, 2024, 2025]);
});

test("fullYearsWithinLegislature returns no years for a term too short to have a full calendar year", () => {
  // Seated in 2020, its own successor elected the following year: no year is fully its own.
  const legislature = { number: "TEST", electionDate: "2020-01-01", startDate: "2020-06-01", endDate: "2021-01-01", source: { label: "", url: "" } };
  assert.deepEqual(fullYearsWithinLegislature(legislature, 2021), []);
});

test("fullYearsWithinLegislature returns exactly one year for a two-calendar-year term", () => {
  const legislature = { number: "TEST", electionDate: "2020-01-01", startDate: "2020-06-01", endDate: "2022-01-01", source: { label: "", url: "" } };
  assert.deepEqual(fullYearsWithinLegislature(legislature, 2022), [2021]);
});

test("legislature cycles load all annual totals in one bounded batch including the ongoing legislature", async () => {
  let calls = 0;
  const cycles = await getLegislatureSpendingCycles({
    loadTotals: async (years, options) => {
      calls += 1;
      assert.deepEqual(years, [2014, 2015, 2016, 2017, 2019, 2020, 2021, 2023, 2024, 2025]);
      assert.equal(options.concurrency, 3);
      assert.equal(options.signal.aborted, false);
      assert.deepEqual([...options.optionalYears].sort((a, b) => a - b), [2023, 2024, 2025]);
      // Simulate 2025 not yet in catalog: optional years may be omitted.
      return new Map(
        years.filter((year) => year !== 2025).map((year) => [year, annualTotal(year)]),
      );
    },
  });
  assert.equal(calls, 1);
  assert.deepEqual(cycles[0].years.map((entry) => entry.year), [2014, 2015, 2016, 2017]);
  assert.equal(cycles[1].preElectionYear.year, 2021);
  assert.equal(cycles[1].preElectionYear.source.releaseKind, "consuntivo");
  assert.equal(cycles[1].preElectionYear.source.packageId, "package-2021");
  assert.deepEqual(cycles[2].years.map((entry) => entry.year), [2023, 2024]);
  assert.equal(cycles[2].preElectionYear, null);
  assert.equal(cycles[2].otherYearsAverage, null);
  assert.equal(cycles[2].differenceFromAverage, null);
  assert.ok(cycles[2].years.every((entry) => entry.isPreElectionYear === false));
});

test("legislature cycles keep the ongoing legislature empty when no consuntivo years are published yet", async () => {
  const cycles = await getLegislatureSpendingCycles({
    loadTotals: async (years, options) => {
      assert.ok(options.optionalYears.has(2023));
      return new Map(
        years
          .filter((year) => !options.optionalYears.has(year))
          .map((year) => [year, annualTotal(year)]),
      );
    },
  });
  assert.deepEqual(cycles[2].years, []);
  assert.equal(cycles[2].preElectionYear, null);
});

test("legislature cycles enforce one global deadline even if a loader ignores abort", async () => {
  let loaderSignal;
  await assert.rejects(
    getLegislatureSpendingCycles({
      deadlineMs: 20,
      loadTotals: async (_years, options) => {
        loaderSignal = options.signal;
        return new Promise(() => {});
      },
    }),
    /timeout|aborted/i,
  );
  assert.equal(loaderSignal?.aborted, true);
});

test("openbdap_spesa_legislature MCP dataset rejects any filter offline", async () => {
  await assert.rejects(
    queryPublicDataset({ dataset: "openbdap_spesa_legislature", year: 2024 }),
    /Filtri non supportati/,
  );
});
