import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parse } from "yaml";

const runner = readFileSync(new URL("../scripts/ci/run-production-gates.sh", import.meta.url), "utf8");
const ci = parse(readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8"));

function groupsByPart() {
  const parts = { shared: [], main: [], core: [] };
  let part = "shared";
  for (const line of runner.split("\n")) {
    const opened = line.match(/^if run_part (main|core); then$/);
    if (opened) part = opened[1];
    else if (line === "fi") part = "shared";
    const group = line.match(/^\s*echo "::group::(.+)"$/);
    if (group) parts[part].push(group[1]);
  }
  return parts;
}

function gatesStep(job) {
  return ci.jobs[job].steps.find((step) => step.run === "bash scripts/ci/run-production-gates.sh");
}

test("each production gate runs in exactly one CI part", () => {
  const parts = groupsByPart();

  assert.deepEqual(parts.shared, ["Start next start", "Wait for server readiness"]);
  assert.deepEqual(parts.core, ["Browser core suite", "Browser core suite in modalità scura"]);
  assert.ok(parts.main.includes("MCP HTTP smoke"));
  assert.equal(parts.main.at(-1), "Lighthouse budget");
  assert.equal(new Set([...parts.main, ...parts.core]).size, parts.main.length + parts.core.length);
  for (const command of [
    "DVNS_COLOR_SCHEME=dark npm run test:browser:assistant\n",
    "DVNS_COLOR_SCHEME=dark npm run test:browser:assistant-free\n",
    "DVNS_COLOR_SCHEME=dark DVNS_CORE_MODE=theme npm run test:browser:core\n",
    "DVNS_COLOR_SCHEME=dark npm run test:browser:charts\n",
  ]) {
    assert.equal(runner.split(command).length, 2, command);
  }
});

test("CI runs both production parts and requires both", () => {
  assert.equal(gatesStep("production").env.PRODUCTION_GATES, "main");
  assert.equal(gatesStep("production-core").env.PRODUCTION_GATES, "core");
  assert.ok(ci.jobs.required.needs.includes("production"));
  assert.ok(ci.jobs.required.needs.includes("production-core"));
  const aggregate = ci.jobs.required.steps[0];
  assert.equal(aggregate.env.PRODUCTION_CORE_RESULT, "${{ needs.production-core.result }}");
  assert.match(aggregate.run, /"\$PRODUCTION_CORE_RESULT"/);
});
