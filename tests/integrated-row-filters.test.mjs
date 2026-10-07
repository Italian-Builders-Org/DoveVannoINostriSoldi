import assert from "node:assert/strict";
import test from "node:test";
import "./helpers/register-ts-alias.mjs";

const { selectIntegratedDataset, IntegratedQueryError } = await import("../src/lib/integrated-public-view.ts");
const datasetId = "consip-winners-2024";

test("public structured filters preserve case, AND/OR precedence and cursor continuation", async () => {
  const unfiltered = await selectIntegratedDataset({ datasetId, limit: 100 });
  const query = {
    datasetId,
    equals: { source_year: "2024" },
    matchAnyEquals: [
      { Ragione_Sociale: "iveco spa", Tipo_Strumento: "convenzione" },
      { Ragione_Sociale: "__absent__" },
    ],
    q: "  AUTOBUS  ",
    limit: 1,
  };
  const first = await selectIntegratedDataset(query);
  assert.deepEqual(first.rows, [unfiltered.rows[0]]);
  assert.equal(first.query, "AUTOBUS");
  assert.equal(first.pagination.scannedRows, 1);
  assert.ok(first.pagination.nextCursor);
  const second = await selectIntegratedDataset({ ...query, cursor: first.pagination.nextCursor });
  assert.equal(second.rows.length, 1);
  assert.notEqual(second.rows[0].id, first.rows[0].id);
  assert.ok(second.rows[0].sourceRow > first.rows[0].sourceRow);
  assert.equal(second.rows[0].cells.Ragione_Sociale, "IVECO SPA");
  assert.equal(second.rows[0].cells.Tipo_Strumento, "Convenzione");

  const impossibleAnd = await selectIntegratedDataset({ ...query, equals: { source_year: "2025" } });
  assert.deepEqual(impossibleAnd.rows, []);
  assert.equal(impossibleAnd.pagination.exhausted, true);
  await assert.rejects(
    selectIntegratedDataset({ ...query, q: "IVECO", cursor: first.pagination.nextCursor }),
    IntegratedQueryError,
  );
});

test("an empty alternative matches all public rows without changing counts or provenance", async () => {
  const plain = await selectIntegratedDataset({ datasetId, limit: 7 });
  const filtered = await selectIntegratedDataset({
    datasetId,
    matchAnyEquals: [{ Ragione_Sociale: "__absent__" }, {}],
    limit: 7,
  });
  assert.deepEqual(filtered.rows, plain.rows);
  assert.deepEqual(filtered.dataset, plain.dataset);
  assert.equal(filtered.pagination.scannedRows, 7);
  assert.equal(filtered.pagination.exhausted, false);
  assert.equal(filtered.matchedRows, null);
  await assert.rejects(
    selectIntegratedDataset({ datasetId, equals: { unknown: "value" } }),
    IntegratedQueryError,
  );
});
