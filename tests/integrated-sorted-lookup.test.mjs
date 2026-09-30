import assert from "node:assert/strict";
import test from "node:test";
import "./helpers/register-ts-alias.mjs";

const { selectSortedRows } = await import("../src/lib/integrated-sorted-lookup.ts");
const { loadIntegratedDatasetChunk, loadIntegratedSourceBundle } = await import("../src/lib/integrated-sources.ts");
const { integratedRowChunkCount } = await import("../src/lib/integrated-source-contract.ts");

const SORTED = [
  ["mim-scuole-statali-comuni", "Codice ISTAT comune"],
  ["mef-patrimonio-beni-2023", "Codice fiscale ente"],
  ["mef-patrimonio-contratti-2023", "Codice fiscale ente"],
  ["mef-patrimonio-adempimento-2023", "Codice fiscale ente"],
  ["mef-patrimonio-fabbricati-fermi-2023", "Codice regione del bene"],
];

async function allRows(datasetId) {
  const bundle = await loadIntegratedSourceBundle();
  const dataset = bundle.datasetsById.get(datasetId);
  const chunks = [];
  for (let ordinal = 0; ordinal < integratedRowChunkCount(dataset.publicRows); ordinal += 1) {
    chunks.push((await loadIntegratedDatasetChunk(bundle, dataset, ordinal)).rows);
  }
  return chunks;
}

for (const [datasetId, column] of SORTED) {
  test(`${datasetId} is published sorted by ${column} and the lookup matches a full scan`, async () => {
    const chunks = await allRows(datasetId);
    const keys = chunks.flat().map((row) => row.cells[column]);
    for (let index = 1; index < keys.length; index += 1) {
      assert.ok(keys[index - 1] <= keys[index], `ordine rotto alla riga ${index + 1}`);
    }
    // A key that spans two chunks, the extremes, and keys outside or between the published ones.
    const spanning = chunks.findIndex((rows, ordinal) => ordinal > 0 && rows[0].cells[column] === chunks[ordinal - 1].at(-1).cells[column]);
    const candidates = [keys[0], keys.at(-1), `${keys[0].slice(0, -1)}!`, `${keys.at(-1)}~`, `${keys[Math.floor(keys.length / 2)]}!`];
    if (spanning > 0) candidates.push(chunks[spanning][0].cells[column]);
    const limit = Math.ceil(Math.log2(chunks.length)) + 3;
    for (const key of candidates) {
      const result = await selectSortedRows(datasetId, column, key);
      assert.deepEqual(
        result.rows.map((row) => row.sourceRow),
        chunks.flat().filter((row) => row.cells[column] === key).map((row) => row.sourceRow),
        `righe diverse per ${key}`,
      );
      assert.ok(result.chunksRead <= limit + Math.ceil(result.rows.length / 1_000), `${result.chunksRead} chunk letti per ${key}`);
    }
  });
}

test("the lookup rejects unknown datasets and columns", async () => {
  await assert.rejects(selectSortedRows("inesistente", "Codice fiscale ente", "1"), /assente/);
  await assert.rejects(selectSortedRows("mef-patrimonio-beni-2023", "Colonna", "1"), /colonna/);
});


test("public sorted lookups preserve provenance and reject unproven ordering", async () => {
  const { selectIntegratedSortedDatasetRows, selectIntegratedDataset } = await import("../src/lib/integrated-public-view.ts");
  const selected = await selectIntegratedSortedDatasetRows("mim-scuole-statali-comuni", "Codice ISTAT comune", "058091");
  const scanned = await selectIntegratedDataset({ datasetId: "mim-scuole-statali-comuni", q: "058091", limit: 100 });
  assert.deepEqual(selected.rows, scanned.rows);
  assert.deepEqual(selected.dataset, scanned.dataset);
  assert.equal(selected.rows.length, 1);
  assert.equal(selected.rows[0].cells["Sedi scolastiche statali"], "944");
  assert.ok(selected.chunksRead <= 4, "An exact municipality lookup must not scan the national registry");
  await assert.rejects(selectIntegratedSortedDatasetRows("mim-scuole-statali-comuni", "Comune", "Roma"), /ordinamento/);
  await assert.rejects(selectIntegratedSortedDatasetRows("vincitori", "Codice ISTAT comune", "058091"), /ordinamento/);
});
