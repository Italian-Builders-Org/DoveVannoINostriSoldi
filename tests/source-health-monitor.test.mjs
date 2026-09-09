import assert from "node:assert/strict";
import test from "node:test";
import { verifySourceHealth } from "../scripts/source-health.mjs";

function payload(reachability = "down") {
  return { ok: true, observedAt: "2026-09-09T12:00:00Z", sources: [{
    sourceId: "openbdap", integration: "active", reachability,
    detail: "short API deadline exceeded",
    snapshot: {
      status: "verified", runtimeFetch: false, check: "offline-source-lock-and-snapshot-contract",
      datasets: Object.fromEntries(Object.entries({ entities: 76124, national: 5, regional: 105 })
        .map(([key, expectedRows]) => [key, { status: "verified", expectedRows, sourceSha256: "a".repeat(64) }])),
      artifact: { bytes: 126487, sha256: "b".repeat(64), lockSha256: "c".repeat(64) },
    },
  }] };
}

test("a public timeout is confirmed directly and both observations are retained", async () => {
  const calls = [];
  const report = await verifySourceHealth(payload(), async (sourceId) => {
    calls.push(sourceId);
    return { sourceId, reachability: "up", latencyMs: 7000 };
  });
  assert.deepEqual(calls, ["openbdap"]);
  assert.equal(report.publicObservations[0].reachability, "down");
  assert.equal(report.confirmed[0].latencyMs, 7000);
});

test("a confirmed outage, failed probe, or mismatched source still fails the monitor", async () => {
  await assert.rejects(verifySourceHealth(payload(), async (sourceId) => ({ sourceId, reachability: "down", detail: "HTTP 503" })), /unreachable: openbdap: HTTP 503/);
  await assert.rejects(verifySourceHealth(payload(), async () => { throw new Error("deadline exceeded"); }), /deadline exceeded/);
  await assert.rejects(verifySourceHealth(payload(), async () => ({ sourceId: "ipa", reachability: "up" })), /unreachable/);
});

test("healthy public observations do not add source requests", async () => {
  const report = await verifySourceHealth(payload("up"), async () => assert.fail("unnecessary source request"));
  assert.deepEqual(report.confirmed, []);
});

test("invalid public payloads and SSN contracts fail before any confirmation", async () => {
  for (const mutate of [
    (p) => { p.ok = false; },
    (p) => { p.sources = []; },
    (p) => { p.sources.push(p.sources[0]); },
    (p) => { p.sources[0].reachability = "unexpected"; },
    (p) => { p.sources[0].snapshot.runtimeFetch = true; },
    (p) => { p.sources[0].snapshot.datasets.entities.expectedRows = 1; },
    (p) => { p.sources[0].snapshot.datasets.regional.sourceSha256 = "invalid"; },
    (p) => { p.sources[0].snapshot.artifact.bytes = 0; },
  ]) {
    const candidate = payload();
    mutate(candidate);
    await assert.rejects(verifySourceHealth(candidate, async () => assert.fail("invalid payload contacted upstream")));
  }
});
