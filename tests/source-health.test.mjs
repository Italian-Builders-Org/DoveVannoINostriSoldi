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

test("source health registry covers every operational source, including ANAC, INPS and CPT", () => {
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
  assert.equal(anac?.freshness.sourceTimestamp, "2026-01-16");
  assert.notEqual(anac?.freshness.sourceTimestamp, "2026-08-20");
  const inps = overview.find((entry) => entry.sourceId === "inps");
  assert.equal(inps?.reachability, "not-probed");
  assert.equal(inps?.recordCount, 167);
  assert.match(inps?.detail ?? "", /spesa nazionale 2021-2025/);
  const cpt = overview.find((entry) => entry.sourceId === "cpt");
  assert.equal(cpt?.reachability, "not-probed");
  assert.equal(cpt?.recordCount, 504);
  assert.match(cpt?.detail ?? "", /21 territori/);
  assert.match(cpt?.detail ?? "", /dati 2000-2023/);
  assert.equal(cpt?.freshness.state, "unknown");
  assert.equal(cpt?.freshness.sourceTimestamp, null);
  const consulenti = overview.find((entry) => entry.sourceId === "consulenti");
  const camera = overview.find((entry) => entry.sourceId === "camera");
  const senate = overview.find((entry) => entry.sourceId === "senato");
  assert.equal(consulenti?.freshness.sourceTimestamp, null);
  assert.equal(camera?.freshness.sourceTimestamp, null);
  assert.match(consulenti?.detail ?? "", /Snapshot estratto il/);
  assert.match(camera?.detail ?? "", /Snapshot verificato il/);
  assert.equal(senate?.recordCount, 2);
  assert.match(senate?.detail ?? "", /importi esclusi/);
  const mefIrpef = overview.find((entry) => entry.sourceId === "mef-irpef");
  assert.equal(mefIrpef?.reachability, "not-probed");
  assert.equal(mefIrpef?.recordCount, 7_896);
  assert.equal(mefIrpef?.freshness.sourceTimestamp, "2026-04-23");
  assert.match(mefIrpef?.detail ?? "", /7\.897 righe fonte/);
  assert.match(mefIrpef?.detail ?? "", /Mancante\/errata separata/);
  const pnrr = overview.find((entry) => entry.sourceId === "italiadomani");
  assert.equal(pnrr?.reachability, "not-probed");
  assert.equal(pnrr?.recordCount, 3_841);
  assert.equal(pnrr?.freshness.sourceTimestamp, "2026-06-13");
  assert.match(pnrr?.detail ?? "", /18\.851 gare/);
});

test("source health registry fails closed when an adapter is omitted", () => {
  const incomplete = getSnapshotManagedSourceHealth().filter(
    (entry) => entry.sourceId !== "anac",
  );
  assert.throws(() => orderSourceHealth(incomplete), /Adapter operativo senza probe/);
});
