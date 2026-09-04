import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import "./helpers/register-ts-alias.mjs";

const { SOURCE_IDS, SOURCE_POLICIES } = await import("../src/lib/data/source-policy.ts");
const {
  getSnapshotManagedSourceHealth,
  getSourceHealthOverview,
  orderSourceHealth,
  SOURCE_HEALTH_ADAPTERS,
  validateIstatMunicipalityGeographyMetadata,
} = await import(
  "../src/lib/data/source-health.ts"
);

test("source status page uses the persistent five-minute health cache", () => {
  const page = readFileSync("src/app/fonti/stato/page.tsx", "utf8");
  const route = readFileSync("src/app/api/fonti/stato/route.ts", "utf8");
  const cache = readFileSync("src/lib/data/cached-live-views.ts", "utf8");
  assert.match(page, /getCachedSourceHealthOverview\(\)/);
  assert.match(page, /Ultimo controllo delle fonti:/);
  assert.doesNotMatch(page, /raggiungibili ora|Risponde ora\?|risponde in questo\s*\n?\s*momento/);
  assert.match(route, /observedAt:\s*checkedAt/);
  assert.doesNotMatch(route, /const observedAt = new Date\(\)\.toISOString\(\)/);
  assert.match(cache, /SOURCE_HEALTH_CACHE_SECONDS = 300/);
  assert.match(cache, /getSourceHealthOverview\(\{ deadlineMs: 6_000 \}\)/);
  assert.match(cache, /return \{ checkedAt: new Date\(\)\.toISOString\(\), sources \}/);
});

test("source health applies one global deadline and aborts every live probe", async () => {
  const originalFetch = globalThis.fetch;
  const signals = [];
  globalThis.fetch = async (_input, init = {}) => {
    signals.push(init.signal);
    return new Promise((resolve, reject) => {
      // Keep a wide gap between the abort deadline and the synthetic upstream
      // response. The full suite hashes multi-gigabyte fixtures in parallel,
      // so a sub-100ms wall-clock assertion is scheduler-sensitive even when
      // every request is correctly aborted.
      const timer = setTimeout(() => resolve(new Response("upstream slow", { status: 503 })), 2_000);
      const onAbort = () => {
        clearTimeout(timer);
        reject(init.signal.reason);
      };
      if (init.signal.aborted) onAbort();
      else init.signal.addEventListener("abort", onAbort, { once: true });
    });
  };

  try {
    const started = performance.now();
    const overview = await getSourceHealthOverview({ deadlineMs: 5 });
    const elapsed = performance.now() - started;
    assert.deepEqual(overview.map((entry) => entry.sourceId), SOURCE_IDS);
    assert.ok(signals.length > 0);
    assert.ok(signals.every((signal) => signal.aborted));
    assert.ok(elapsed < 1_500, `global source-health deadline was cosmetic: ${elapsed}ms`);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

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

test("source health registry covers every operational source, including ANAC, INPS and CPT", async () => {
  assert.deepEqual(Object.keys(SOURCE_HEALTH_ADAPTERS), SOURCE_IDS);
  assert.ok(Object.values(SOURCE_HEALTH_ADAPTERS).every((adapter) => typeof adapter === "function"));
  const snapshots = getSnapshotManagedSourceHealth();
  for (const snapshot of snapshots) {
    const health = await SOURCE_HEALTH_ADAPTERS[snapshot.sourceId]();
    assert.equal(health.sourceId, snapshot.sourceId);
  }
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
  const pcm = overview.find((entry) => entry.sourceId === "pcm");
  assert.equal(consulenti?.freshness.sourceTimestamp, null);
  assert.equal(camera?.freshness.sourceTimestamp, null);
  assert.match(consulenti?.detail ?? "", /Snapshot estratto il/);
  assert.match(camera?.detail ?? "", /Snapshot verificato il/);
  assert.equal(senate?.recordCount, 2);
  assert.match(senate?.detail ?? "", /importi esclusi/);
  assert.equal(pcm?.recordCount, 572);
  assert.match(pcm?.detail ?? "", /workbook XLSX verificato/);
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
  const istat = overview.find((entry) => entry.sourceId === "istat");
  assert.equal(istat?.reachability, "not-probed");
  assert.equal(istat?.recordCount, 7_894);
  assert.equal(istat?.freshness.sourceTimestamp, "2026-08-25");
  assert.match(istat?.detail ?? "", /SITUAS/);
  assert.match(istat?.detail ?? "", /generato il 2026-08-25/);
  assert.match(istat?.detail ?? "", /dati al 2026-08-25/);
  assert.match(istat?.detail ?? "", /7894 comuni/);
  const istatPensions = overview.find((entry) => entry.sourceId === "istat-casellario-pensioni");
  assert.equal(istatPensions?.reachability, "not-probed");
  assert.equal(istatPensions?.recordCount, 99);
  assert.equal(istatPensions?.freshness.sourceTimestamp, "2026-08-30T17:24:00+02:00");
  assert.match(istatPensions?.detail ?? "", /pensioni e pensionati separati/);
  assert.match(istatPensions?.detail ?? "", /check offline-source-lock-and-snapshot-contract/);
  const eurostat = overview.find((entry) => entry.sourceId === "eurostat");
  assert.equal(eurostat?.freshness.sourceTimestamp, "2025-12-31");
  assert.match(eurostat?.detail ?? "", /interessi e spesa totale 2025/);
  assert.equal(eurostat?.recordCount, 5);
  const eurostatHicp = overview.find((entry) => entry.sourceId === "eurostat-hicp");
  assert.equal(eurostatHicp?.freshness.sourceTimestamp, "2026-09-01T23:00:00+0200");
  assert.match(eurostatHicp?.detail ?? "", /IPCA mensile fino a 2026-08/);
  assert.equal(eurostatHicp?.recordCount, 1_424);
  const ameco = overview.find((entry) => entry.sourceId === "ameco");
  assert.match(ameco?.detail ?? "", /previsioni 2025-2027 escluse dal voto/);
});

test("ISTAT health metadata fails closed on sidecar drift", () => {
  assert.throws(
    () => validateIstatMunicipalityGeographyMetadata({
      schemaVersion: 1,
      datasetId: "istat-municipality-geography",
      generatedAt: "2026-08-25T00:00:00Z",
      availableYears: [2026],
      latest: {
        year: 2025,
        sourceTimestamp: "25/08/2026",
        municipalities: 7_894,
      },
    }),
    /Metadati health ISTAT SITUAS non validi/,
  );
});

test("source health registry fails closed when an adapter is omitted", () => {
  const incomplete = getSnapshotManagedSourceHealth().filter(
    (entry) => entry.sourceId !== "anac",
  );
  assert.throws(() => orderSourceHealth(incomplete), /Adapter operativo senza probe/);
});
