import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { parse } from "yaml";

const WORKFLOWS = path.join(import.meta.dirname, "..", ".github", "workflows");
const CANONICAL = "github.repository == 'Italian-Builders-Org/DoveVannoINostriSoldi' && github.ref == 'refs/heads/main'";
const SCHEDULE_OR_DISPATCH = "(github.event_name == 'schedule' || github.event_name == 'workflow_dispatch')";
const PUSH_OR_SCHEDULE_OR_DISPATCH = "(github.event_name == 'push' || github.event_name == 'schedule' || github.event_name == 'workflow_dispatch')";

function workflow(filename) {
  return parse(fs.readFileSync(path.join(WORKFLOWS, filename), "utf8"));
}

test("every source-operations job has a canonical repository gate", () => {
  for (const filename of fs.readdirSync(WORKFLOWS).filter((name) => name.endsWith(".yml"))) {
    for (const [jobName, job] of Object.entries(workflow(filename).jobs ?? {})) {
      if (job.environment === "source-operations") {
        assert.match(
          job.if ?? "",
          /^github\.repository == 'Italian-Builders-Org\/DoveVannoINostriSoldi' && github\.ref == 'refs\/heads\/main' && /,
          `${filename} job ${jobName}`,
        );
      }
    }
  }
});

test("production monitors only run for canonical main schedule or dispatch", () => {
  for (const [filename, jobName] of [
    ["runtime-health.yml", "probe"],
    ["source-health.yml", "probe"],
    ["parlamento-giudiziario-recheck.yml", "recheck"],
  ]) {
    assert.equal(
      workflow(filename).jobs[jobName].if,
      `${CANONICAL} && ${SCHEDULE_OR_DISPATCH}`,
      filename,
    );
  }
});

test("publisher and internal refresh jobs never enter operational environments in forks", () => {
  for (const filename of [
    "budget-law-refresh.yml",
    "company-atlas-refresh.yml",
    "consulenti-refresh.yml",
    "education-atlas-refresh.yml",
    "government-scorecard-refresh.yml",
    "mef-participations-refresh.yml",
    "opencivitas-refresh.yml",
    "opencoesione-refresh.yml",
    "public-debt-refresh.yml",
    "siope-nonmunicipal-refresh.yml",
    "siope-refresh.yml",
  ]) {
    assert.equal(
      workflow(filename).jobs.refresh.if,
      `${CANONICAL} && ${SCHEDULE_OR_DISPATCH}`,
      filename,
    );
  }
  assert.equal(
    workflow("source-refresh.yml").jobs.refresh.if,
    `${CANONICAL} && github.event_name == 'workflow_dispatch'`,
  );
});

test("parliament keeps offline validation separate from the canonical live monitor", () => {
  const jobs = workflow("parliament-sources.yml").jobs;
  assert.ok(jobs["offline-contract"]);
  assert.equal(jobs["offline-contract"].if, undefined);
  assert.ok(jobs["offline-contract"].steps.some((step) => step.run?.includes("test_parliament_sources.py")));
  assert.ok(jobs["offline-contract"].steps.some((step) => step.run?.includes("--check")));
  assert.equal(jobs["source-monitor"].needs, "offline-contract");
  assert.equal(
    jobs["source-monitor"].if,
    `${CANONICAL} && ${PUSH_OR_SCHEDULE_OR_DISPATCH}`,
  );
  assert.ok(jobs["source-monitor"].steps.some((step) => step.run?.includes("exit 1")));
});

test("mixed workflows keep fork push checks but guard live and regeneration jobs", () => {
  for (const filename of ["mef-irpef-refresh.yml", "pnrr-childcare-refresh.yml"]) {
    const jobs = workflow(filename).jobs;
    assert.equal(jobs["offline-contract"].if, "github.event_name == 'push'", filename);
    assert.equal(
      jobs["verify-upstream"].if,
      `${CANONICAL} && ${SCHEDULE_OR_DISPATCH}`,
      filename,
    );
    assert.equal(jobs["regenerate-manually"].needs, "verify-upstream", filename);
    assert.equal(
      jobs["regenerate-manually"].if,
      `${CANONICAL} && github.event_name == 'workflow_dispatch'`,
      filename,
    );
  }
});

test("CI keeps the pull request required check independent of operational jobs", () => {
  const ci = workflow("ci.yml");
  assert.ok(Object.hasOwn(ci.on, "pull_request"));
  assert.deepEqual(
    ci.jobs.required.needs,
    ["static", "security", "node", "etl", "production"],
  );
});
