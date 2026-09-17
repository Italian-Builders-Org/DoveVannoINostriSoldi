import assert from "node:assert/strict";
import test from "node:test";
import "../helpers/register-ts-alias.mjs";
import { runLiveOpenBdap } from "../helpers/live-openbdap.mjs";

const { SSN_NATIONAL_HISTORY_YEARS, getSsnNationalHistory } = await import(
  "../../src/lib/ssn-national-history.ts"
);
const { ssnCceSnapshot } = await import("../../src/lib/ssn-cce-snapshot.ts");

test(
  "SSN national history reconciles with the locked 2024 snapshot and is expressed in cents",
  { timeout: 300_000 },
  async (context) => {
    await runLiveOpenBdap(context, async () => {
      const history = await getSsnNationalHistory();
      assert.equal(history.years.length, 13);
      assert.deepEqual(history.years.map((entry) => entry.year), [...SSN_NATIONAL_HISTORY_YEARS]);
      const year2024 = history.years.find((entry) => entry.year === 2024);
      assert.ok(year2024);
      assert.deepEqual(year2024.values, ssnCceSnapshot.national.values);
      for (const entry of history.years) {
        for (const value of Object.values(entry.values)) {
          assert.ok(Number.isSafeInteger(value), `${entry.year}: ${value} non è un intero sicuro`);
          assert.ok(value > 0, `${entry.year}: valore non positivo`);
        }
      }
      const byYear = new Map(history.years.map((entry) => [entry.year, entry.values]));
      assert.ok(byYear.get(2020).healthcareWorkServices > byYear.get(2019).healthcareWorkServices);
    });
  },
);
