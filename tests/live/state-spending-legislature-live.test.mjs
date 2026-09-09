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
      assert.deepEqual(nineteenth.years, []);
      assert.equal(nineteenth.preElectionYear, null);
      assert.equal(nineteenth.otherYearsAverage, null);
      assert.equal(nineteenth.differenceFromAverage, null);
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
