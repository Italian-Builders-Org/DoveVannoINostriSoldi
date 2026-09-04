import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { parse } from "yaml";

const workflowDir = path.join(process.cwd(), ".github", "workflows");
const workflows = fs
  .readdirSync(workflowDir)
  .filter((name) => name.endsWith(".yml"))
  .map((name) => {
    const source = fs.readFileSync(path.join(workflowDir, name), "utf8");
    return { name, source, document: parse(source) };
  });

// `on` is a YAML 1.1 boolean; the 1.2 core schema keeps it a string. Read both.
function triggers(document) {
  return document?.on ?? document?.true ?? {};
}

function environmentName(job) {
  const environment = job?.environment;
  return typeof environment === "string" ? environment : environment?.name;
}

test("every job behind source-operations actually needs its credential", () => {
  const gated = [];
  for (const { name, document } of workflows) {
    for (const [jobId, job] of Object.entries(document?.jobs ?? {})) {
      if (environmentName(job) === "source-operations") gated.push({ name, jobId, job });
    }
  }

  assert.ok(gated.length > 0, "expected the refresh workflows to keep the gate");

  for (const { name, jobId, job } of gated) {
    // The environment carries required reviewers, so a scheduled run waits for a
    // human. That trade is only worth making for a job that uses the data-bot
    // credential the environment protects: a credential-free job parked behind
    // it can never run unattended, and a cancelled run raises no alert.
    assert.match(
      JSON.stringify(job),
      /secrets\./,
      `${name}: job "${jobId}" is gated on source-operations but uses no secret`,
    );
  }
});

test("the source health monitor can run unattended", () => {
  const workflow = workflows.find(({ name }) => name === "source-health.yml");
  assert.ok(workflow, "source-health.yml is missing");

  assert.ok(triggers(workflow.document).schedule, "the monitor must stay scheduled");

  for (const [jobId, job] of Object.entries(workflow.document.jobs ?? {})) {
    assert.equal(
      environmentName(job),
      undefined,
      `job "${jobId}" must not sit behind an approval gate it cannot obtain on a schedule`,
    );
  }

  // A newer schedule must never cancel a probe that is already running or
  // waiting: a cancelled run reports no conclusion, so the outage it was meant
  // to observe passes unnoticed.
  assert.equal(workflow.document.concurrency?.["cancel-in-progress"], false);
});
