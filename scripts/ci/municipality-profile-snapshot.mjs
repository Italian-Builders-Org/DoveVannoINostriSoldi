import { readFileSync, writeFileSync } from "node:fs";
import { gzipSync, gunzipSync } from "node:zlib";
import "./register-source-alias.mjs";

process.env.DVNS_DATA_BACKEND = "filesystem";
delete process.env.DVNS_BUILD_DATA_BACKEND;
process.env.DVNS_OFFLINE_GUARD = "1";
await import("./node-offline-guard.mjs");

const { loadIntegratedDatasetChunk, loadIntegratedSourceBundle } = await import("../../src/lib/integrated-sources.ts");
const { integratedRowChunkCount, sha256Hex } = await import("../../src/lib/integrated-source-contract.ts");
const { municipalityProfileBucket, municipalityProfileSourceDigest } = await import("../../src/lib/municipality-profile-snapshot.ts");
const { projectMunicipalityRealEstate, realEstateDatasetColumns } = await import("../../src/lib/municipality-real-estate.ts");
const { schoolServicesSource } = await import("../../src/lib/mim-school-services-source.ts");
const directory = new URL("../../src/data/generated/municipality-profile/", import.meta.url);
const bundle = await loadIntegratedSourceBundle();
const shards = Object.fromEntries([...("0123456789abcdef")].map((bucket) =>
  [bucket, { schools: {}, realEstate: {} }]));
const manifest = { sources: {}, shards: {} };

async function groupRows(id, column, requiredHeaders = []) {
  const dataset = bundle.datasetsById.get(id);
  if (!dataset || ![column, ...requiredHeaders].every((header) => dataset.headers.includes(header))) {
    throw new Error(`Schema divergente nello snapshot comunale per ${id}.`);
  }
  manifest.sources[id] = municipalityProfileSourceDigest(bundle, id);
  const groups = new Map();
  for (let ordinal = 0; ordinal < integratedRowChunkCount(dataset.publicRows); ordinal += 1) {
    const { rows } = await loadIntegratedDatasetChunk(bundle, dataset, ordinal);
    for (const row of rows) {
      const key = row.cells[column];
      if (typeof key !== "string") throw new Error(`Identificativo assente in ${id}.`);
      const group = groups.get(key) ?? [];
      group.push(row);
      groups.set(key, group);
    }
  }
  return groups;
}

const schools = await groupRows(schoolServicesSource.datasetId, "Codice ISTAT comune");
for (const [key, rows] of schools) {
  if (!/^\d{6}$/.test(key) || rows.length !== 1) throw new Error(`Identità scolastica non valida: ${key}.`);
  const [{ id, cells }] = rows;
  shards[municipalityProfileBucket(key)].schools[key] = { id, cells };
}

const [beni, contratti, adempimento] = await Promise.all(
  Object.entries(realEstateDatasetColumns).map(([id, columns]) => groupRows(id, "Codice fiscale ente", columns)),
);
for (const key of new Set([...beni.keys(), ...contratti.keys(), ...adempimento.keys()])) {
  if (!/^\d{11}$/.test(key)) continue; // The public municipal profile only joins fiscal codes of legal entities.
  shards[municipalityProfileBucket(key)].realEstate[key] = projectMunicipalityRealEstate(
    key, beni.get(key) ?? [], contratti.get(key) ?? [], adempimento.get(key) ?? [],
  );
}

const write = process.argv.includes("--write");
for (const [bucket, value] of Object.entries(shards)) {
  const file = new URL(`${bucket}.json.gz`, directory);
  const serialized = Buffer.from(`${JSON.stringify(value)}\n`);
  if (serialized.length > 1024 * 1024) throw new Error(`Snapshot comunale troppo grande: ${bucket}.`);
  const bytes = write ? gzipSync(serialized, { level: 9 }) : readFileSync(file);
  if (bytes.length > 128 * 1024 || !gunzipSync(bytes, { maxOutputLength: 1024 * 1024 }).equals(serialized)) {
    throw new Error(`Snapshot comunale divergente: ${bucket}.`);
  }
  if (write) writeFileSync(file, bytes);
  manifest.shards[bucket] = sha256Hex(bytes);
}
const manifestFile = new URL("manifest.json", directory);
const expectedManifest = `${JSON.stringify(manifest)}\n`;
if (write) writeFileSync(manifestFile, expectedManifest);
else if (readFileSync(manifestFile, "utf8") !== expectedManifest) throw new Error("Manifest comunale divergente.");
console.log("Snapshot comunali riconciliati con le righe del rilascio.");
