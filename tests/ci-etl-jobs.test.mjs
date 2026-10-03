import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parse } from "yaml";

const ci = parse(readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8"));

function offlineRuns(job) {
  return ci.jobs[job].steps
    .filter((step) => step.env?.DVNS_OFFLINE_GUARD === "1")
    .map((step) => step.run);
}

test("ETL tests and artifact checks run offline in separate jobs, both required", () => {
  assert.deepEqual(offlineRuns("etl"), ["npm run test:etl"]);
  assert.deepEqual(offlineRuns("etl-snapshots"), ["npm run test:snapshots"]);
  for (const job of ["etl", "etl-snapshots"]) {
    assert.ok(ci.jobs.required.needs.includes(job), job);
    assert.ok(!ci.jobs[job].steps.some((step) => /test:(etl|snapshots)/.test(step.run ?? "") && step.env?.DVNS_OFFLINE_GUARD !== "1"), job);
  }
});
