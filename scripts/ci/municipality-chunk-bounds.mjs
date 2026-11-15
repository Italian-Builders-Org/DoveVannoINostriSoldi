import { readFileSync, writeFileSync } from "node:fs";
import "./register-source-alias.mjs";

// Derive only from the offline, hash-verified public release.
process.env.DVNS_DATA_BACKEND = "filesystem";
delete process.env.DVNS_BUILD_DATA_BACKEND;
process.env.DVNS_OFFLINE_GUARD = "1";
await import("./node-offline-guard.mjs");

const { loadIntegratedDatasetChunk, loadIntegratedSourceBundle } = await import("../../src/lib/integrated-sources.ts");
const { integratedRowChunkCount, integratedRowChunkName } = await import("../../src/lib/integrated-source-contract.ts");
const columns = {
  "mim-scuole-statali-comuni": "Codice ISTAT comune",
  "mef-patrimonio-beni-2023": "Codice fiscale ente",
  "mef-patrimonio-contratti-2023": "Codice fiscale ente",
  "mef-patrimonio-adempimento-2023": "Codice fiscale ente",
};
const bundle = await loadIntegratedSourceBundle();
const index = {};
for (const [id, column] of Object.entries(columns)) {
  const dataset = bundle.datasetsById.get(id);
  if (!dataset?.headers.includes(column)) throw new Error(`Colonna di ordinamento assente per ${id}.`);
  const chunks = [];
  let previous;
  for (let ordinal = 0; ordinal < integratedRowChunkCount(dataset.publicRows); ordinal += 1) {
    const { rows } = await loadIntegratedDatasetChunk(bundle, dataset, ordinal);
    const keys = rows.map((row) => {
      const key = row.cells[column];
      if (typeof key !== "string" || (previous !== undefined && previous > key)) {
        throw new Error(`Ordinamento divergente per ${id}, riga ${row.sourceRow}.`);
      }
      previous = key;
      return key;
    });
    const artifactKey = `src/data/generated/integrated/rows/${integratedRowChunkName(id, ordinal)}`;
    chunks.push({ first: keys[0], last: keys.at(-1), sha256: bundle.datasetProof.artifactSha256[artifactKey] });
  }
  index[id] = { column, chunks };
}
const file = new URL("../../src/data/generated/municipality-chunk-bounds.json", import.meta.url);
const expected = `${JSON.stringify(index)}\n`;
if (process.argv.includes("--write")) writeFileSync(file, expected);
else if (readFileSync(file, "utf8") !== expected) {
  throw new Error("Indice dei blocchi comunali divergente: eseguire npm run municipality-chunk-bounds:generate.");
}
console.log("Confini dei blocchi comunali riconciliati con il rilascio.");
