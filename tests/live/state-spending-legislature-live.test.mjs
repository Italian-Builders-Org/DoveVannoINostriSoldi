import assert from "node:assert/strict";
import test from "node:test";
import "../helpers/register-ts-alias.mjs";
import { runLiveOpenBdap } from "../helpers/live-openbdap.mjs";

const { LEGISLATURES, getLegislatureSpendingCycles } = await import(
  "../../src/lib/state-spending-legislature.ts"
);
const { queryPublicDataset } = await import("../../src/lib/mcp/datasets.ts");

test(
  "state spending legislature cycles reconcile with live OpenBDAP consuntivo and flag COVID years without asserting causality",
  { timeout: 300_000 },
  async (context) => {
    await runLiveOpenBdap(context, async () => {
      const cycles = await getLegislatureSpendingCycles();
      assert.equal(cycles.length, LEGISLATURES.length);

      const seventeenth = cycles.find((cycle) => cycle.legislature.number === "XVII");
      assert.ok(seventeenth);
      assert.deepEqual(seventeenth.years.map((entry) => entry.year), [2014, 2015, 2016, 2017]);
      assert.equal(seventeenth.preElectionYear.year, 2017);
      assert.ok(seventeenth.years.every((entry) => entry.totalPaid > 0));
      assert.ok(seventeenth.years.every((entry) => entry.extraordinaryContext === null));

      const eighteenth = cycles.find((cycle) => cycle.legislature.number === "XVIII");
      assert.ok(eighteenth);
      assert.deepEqual(eighteenth.years.map((entry) => entry.year), [2019, 2020, 2021]);
      assert.equal(eighteenth.preElectionYear.year, 2021);
      assert.match(eighteenth.preElectionYear.extraordinaryContext ?? "", /COVID/);
      assert.match(eighteenth.preElectionYear.extraordinaryContext ?? "", /non (è|e) isolat/i);

      const nineteenth = cycles.find((cycle) => cycle.legislature.number === "XIX");
      assert.ok(nineteenth);
      const nineteenthYears = nineteenth.years.map((entry) => entry.year);
      assert.equal(nineteenthYears[0], 2023, "il 2023 è il primo anno completo della XIX legislatura");
      assert.deepEqual(
        nineteenthYears,
        Array.from({ length: nineteenthYears.length }, (_, index) => 2023 + index),
        "la legislatura in corso non deve saltare anni pubblicati",
      );
      assert.ok(
        nineteenthYears.includes(2023) && nineteenthYears.includes(2024),
        "i consuntivi 2023 e 2024 sono pubblicati e devono comparire",
      );
      assert.ok(nineteenth.years.every((entry) => entry.totalPaid > 0));
      assert.ok(nineteenth.years.every((entry) => entry.source.releaseKind === "consuntivo"));
      assert.ok(nineteenth.years.every((entry) => entry.isPreElectionYear === false));
      assert.equal(nineteenth.preElectionYear, null, "la XIX legislatura non ha ancora un anno pre-elettorale");
      assert.equal(nineteenth.otherYearsAverage, null);
      assert.equal(nineteenth.differenceFromAverage, null);

      // The observed year must be the annual consuntivo the same connector returns for that
      // year, not a monthly cumulative release read as a full year.
      const annual2023 = await queryPublicDataset({ dataset: "openbdap_spesa_stato", year: 2023 });
      assert.equal(annual2023.period.releaseKind, "consuntivo");
      const legislature2023 = nineteenth.years.find((entry) => entry.year === 2023);
      assert.equal(legislature2023.totalPaid, annual2023.totalPaid);
      assert.equal(legislature2023.source.packageId, annual2023.sources.mission.packageId);
    });
  },
);

test("openbdap_spesa_legislature MCP live result preserves the offline filter contract", async (context) => {
  await assert.rejects(
    queryPublicDataset({ dataset: "openbdap_spesa_legislature", year: 2024 }),
    /Filtri non supportati/,
  );
  await runLiveOpenBdap(context, async () => {
    const result = await queryPublicDataset({ dataset: "openbdap_spesa_legislature" });
    assert.equal(result.cycles.length, LEGISLATURES.length);
    assert.ok(JSON.stringify(result).length < 750 * 1024);
  });
});
