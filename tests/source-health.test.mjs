import assert from "node:assert/strict";
import test from "node:test";
import "./helpers/register-ts-alias.mjs";

const { SOURCE_IDS, SOURCE_POLICIES } = await import("../src/lib/data/source-policy.ts");
const { getSnapshotManagedSourceHealth, orderSourceHealth } = await import(
  "../src/lib/data/source-health.ts"
);

function fakeLiveHealth(sourceId) {
  const policy = SOURCE_POLICIES[sourceId];
  return {
    sourceId,
    label: policy.label,
    owner: policy.owner,
    integration: "active",
    reachability: "up",
    freshness: {
      state: "unknown",
      sourceTimestamp: null,
      ageSeconds: null,
      staleAfterSeconds: policy.staleAfterSeconds,
      checkedAt: "2026-08-20T00:00:00.000Z",
    },
    checkedAt: "2026-08-20T00:00:00.000Z",
    latencyMs: 0,
    detail: null,
    recordCount: null,
    policy: {
      cadence: policy.cadence,
      cadenceNote: policy.cadenceNote,
      discoveryRevalidateSeconds: policy.discoveryRevalidateSeconds,
      dataRevalidateSeconds: policy.dataRevalidateSeconds,
      staleAfterSeconds: policy.staleAfterSeconds,
      sourceUrl: policy.sourceUrl,
    },
  };
}

test("source health registry covers every operational source, including ANAC", () => {
  const snapshots = getSnapshotManagedSourceHealth();
  const snapshotIds = new Set(snapshots.map((entry) => entry.sourceId));
  const live = SOURCE_IDS
    .filter((sourceId) => !snapshotIds.has(sourceId))
    .map(fakeLiveHealth);
  const overview = orderSourceHealth([...live, ...snapshots]);

  assert.deepEqual(overview.map((entry) => entry.sourceId), SOURCE_IDS);
  const anac = overview.find((entry) => entry.sourceId === "anac");
  assert.equal(anac?.reachability, "not-probed");
  assert.equal(anac?.recordCount, 1_453_918);
  assert.match(anac?.detail ?? "", /12 distribuzioni mensili/);
});

test("source health registry fails closed when an adapter is omitted", () => {
  const incomplete = getSnapshotManagedSourceHealth().filter(
    (entry) => entry.sourceId !== "anac",
  );
  assert.throws(() => orderSourceHealth(incomplete), /Adapter operativo senza probe/);
});
