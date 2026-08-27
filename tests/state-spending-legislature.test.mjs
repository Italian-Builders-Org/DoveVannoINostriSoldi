import assert from "node:assert/strict";
import test from "node:test";
import "./helpers/register-ts-alias.mjs";
import { isOpenBdapReachable } from "./helpers/live-openbdap.mjs";

const { LEGISLATURES, getLegislatureSpendingCycles, fullYearsWithinLegislature } = await import(
  "../src/lib/state-spending-legislature.ts"
);
const { queryPublicDataset } = await import("../src/lib/mcp/datasets.ts");

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

test("fullYearsWithinLegislature returns no years for a legislature still in progress", () => {
  const legislature = { number: "TEST", electionDate: "2022-09-25", startDate: "2022-10-13", endDate: null, source: { label: "", url: "" } };
  assert.deepEqual(fullYearsWithinLegislature(legislature, null), []);
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

test("legislature cycles load all annual totals in one bounded batch", async () => {
  let calls = 0;
  const cycles = await getLegislatureSpendingCycles({
    loadTotals: async (years, options) => {
      calls += 1;
      assert.deepEqual(years, [2014, 2015, 2016, 2017, 2019, 2020, 2021]);
      assert.equal(options.concurrency, 3);
      assert.equal(options.signal.aborted, false);
      return new Map(years.map((year) => [year, {
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
      }]));
    },
  });
  assert.equal(calls, 1);
  assert.deepEqual(cycles[0].years.map((entry) => entry.year), [2014, 2015, 2016, 2017]);
  assert.equal(cycles[1].preElectionYear.year, 2021);
  assert.equal(cycles[1].preElectionYear.source.releaseKind, "consuntivo");
  assert.equal(cycles[1].preElectionYear.source.packageId, "package-2021");
});

test("legislature cycles enforce one global deadline even if a loader ignores abort", async () => {
  await assert.rejects(
    getLegislatureSpendingCycles({
      deadlineMs: 20,
      loadTotals: async () => new Promise(() => {}),
    }),
    /timeout|aborted/i,
  );
});

test(
  "state spending legislature cycles reconcile with live OpenBDAP consuntivo and flag COVID years without asserting causality",
  // Seven sequential live OpenBDAP discovery+fetch calls (2014-2017, 2019-2021); each can take
  // up to ~30s under retry per the openbdap source policy (15s timeout, 1 retry), so this needs
  // real headroom rather than the 120s default.
  { timeout: 300_000 },
  async (context) => {
    if (!(await isOpenBdapReachable())) {
      context.skip("OpenBDAP non raggiungibile — test live saltato");
      return;
    }
    const cycles = await getLegislatureSpendingCycles();
    assert.equal(cycles.length, LEGISLATURES.length);

    const seventeenth = cycles.find((cycle) => cycle.legislature.number === "XVII");
    assert.ok(seventeenth);
    assert.deepEqual(
      seventeenth.years.map((entry) => entry.year),
      [2014, 2015, 2016, 2017],
    );
    assert.equal(seventeenth.preElectionYear.year, 2017);
    assert.ok(seventeenth.years.every((entry) => entry.totalPaid > 0));
    assert.ok(
      seventeenth.years.every((entry) => entry.extraordinaryContext === null),
      "il 2014-2017 non deve avere un contesto straordinario dichiarato",
    );

    const eighteenth = cycles.find((cycle) => cycle.legislature.number === "XVIII");
    assert.ok(eighteenth);
    assert.deepEqual(
      eighteenth.years.map((entry) => entry.year),
      [2019, 2020, 2021],
    );
    assert.equal(eighteenth.preElectionYear.year, 2021);
    // The pre-election year for XVIII is a COVID year: the module must say so explicitly
    // instead of silently folding it into "otherYearsAverage" as if it were ordinary.
    assert.match(eighteenth.preElectionYear.extraordinaryContext ?? "", /COVID/);
    assert.match(eighteenth.preElectionYear.extraordinaryContext ?? "", /non (è|e) isolat/i);

    const nineteenth = cycles.find((cycle) => cycle.legislature.number === "XIX");
    assert.ok(nineteenth);
    assert.deepEqual(nineteenth.years, []);
    assert.equal(nineteenth.preElectionYear, null);
    assert.equal(nineteenth.otherYearsAverage, null);
    assert.equal(nineteenth.differenceFromAverage, null);
  },
);

test("openbdap_spesa_legislature MCP dataset rejects any filter and exposes the same cycles", async (context) => {
  await assert.rejects(
    queryPublicDataset({ dataset: "openbdap_spesa_legislature", year: 2024 }),
    /Filtri non supportati/,
  );
  if (!(await isOpenBdapReachable())) {
    context.skip("OpenBDAP non raggiungibile — test live saltato");
    return;
  }
  const result = await queryPublicDataset({ dataset: "openbdap_spesa_legislature" });
  assert.equal(result.cycles.length, LEGISLATURES.length);
  assert.ok(JSON.stringify(result).length < 750 * 1024);
});
