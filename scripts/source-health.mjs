import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

// The public API has a short request budget. Confirm its negative observations
// with the same source adapters outside that HTTP budget before paging anyone.
export async function verifySourceHealth(payload, probeSource) {
  if (!payload?.ok || !Array.isArray(payload.sources)) throw new Error("Invalid source-health response");
  const active = payload.sources.filter((source) => source.integration === "active");
  if (!active.length || new Set(active.map((source) => source.sourceId)).size !== active.length) {
    throw new Error("Invalid active source registry");
  }
  const ssn = active.find((source) => source.sourceId === "openbdap")?.snapshot;
  if (!ssn || ssn.status !== "verified" || ssn.runtimeFetch !== false || ssn.check !== "offline-source-lock-and-snapshot-contract") {
    throw new Error("SSN Conto Economico snapshot health is not verified");
  }
  const expectedRows = { entities: 76124, national: 5, regional: 105 };
  for (const [name, expected] of Object.entries(expectedRows)) {
    const dataset = ssn.datasets?.[name];
    if (!dataset || dataset.status !== "verified" || dataset.expectedRows !== expected || !/^[a-f0-9]{64}$/.test(dataset.sourceSha256)) {
      throw new Error(`SSN source lock check failed for ${name}`);
    }
  }
  if (!ssn.artifact || ssn.artifact.bytes !== 126487 || !/^[a-f0-9]{64}$/.test(ssn.artifact.sha256) || !/^[a-f0-9]{64}$/.test(ssn.artifact.lockSha256)) {
    throw new Error("SSN snapshot artifact integrity check failed");
  }
  for (const source of active) {
    if (typeof source.sourceId !== "string" || !["up", "down", "not-probed"].includes(source.reachability)) {
      throw new Error("Invalid active source observation");
    }
  }
  const negative = active.filter((source) => source.reachability === "down");
  const confirmed = await Promise.all(negative.map(async (source) => {
    const result = await probeSource(source.sourceId);
    if (result?.sourceId !== source.sourceId || result.reachability !== "up") {
      throw new Error(`Active official sources unreachable: ${source.sourceId}: ${result?.detail ?? "probe not verified"}`);
    }
    return result;
  }));
  return { observedAt: payload.observedAt, publicObservations: active, confirmed, ssnSnapshot: ssn };
}

async function main() {
  const payload = JSON.parse(await readFile(process.argv[2], "utf8"));
  // Preserve the public observations even if confirmation fails.
  console.log(JSON.stringify({ publicResponse: payload }, null, 2));
  const { SOURCE_HEALTH_ADAPTERS } = await import("../src/lib/data/source-health.ts");
  const signal = AbortSignal.timeout(45_000);
  const report = await verifySourceHealth(payload, async (sourceId) => {
    const adapter = SOURCE_HEALTH_ADAPTERS[sourceId];
    if (!Object.hasOwn(SOURCE_HEALTH_ADAPTERS, sourceId) || typeof adapter !== "function") {
      throw new Error(`Adapter operativo senza probe: ${sourceId}`);
    }
    return adapter(signal);
  });
  console.log(JSON.stringify(report, null, 2));
  if (report.confirmed.length) {
    console.log(`::warning::Public source probe was negative; direct confirmation succeeded for ${report.confirmed.map((source) => source.sourceId).join(", ")}. See both observations in the log.`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
