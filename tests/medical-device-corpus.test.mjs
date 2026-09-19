import assert from "node:assert/strict";
import test from "node:test";
import "./helpers/register-ts-alias.mjs";

const { selectIntegratedDataset } = await import("../src/lib/integrated-public-view.ts");
const { queryPublicDataset } = await import("../src/lib/mcp/datasets.ts");
const { GET } = await import("../src/app/api/dati/[dataset]/route.ts");
const { isInsightCapable } = await import("../src/lib/integrated-dataset-insight-core.ts");

test("medical-device tables retain scope, privacy and canonical selector/API/MCP identities", async () => {
  for (const [id, rows, period] of [
    ["salute-spesa-dispositivi-2018", 718808, "2018"],
    ["salute-spesa-dispositivi-2019", 768233, "2019"],
    ["salute-spesa-dispositivi-2020", 787845, "2020"],
    ["salute-spesa-dispositivi-2021", 846878, "2021"],
    ["salute-dispositivi-bdrdm", 2416708, "2026-09-14"],
    ["salute-classificazione-cnd", 11115, "2026-09-01"],
  ]) {
    const result = await selectIntegratedDataset({ datasetId: id, limit: 5 });
    assert.equal(result.dataset.publicRows, rows);
    assert.equal(result.dataset.sourceMetadata.referencePeriod, period);
    assert.equal(result.dataset.licenseStatus, "verified-open-iodl-2.0");
    assert.equal(result.rows.length, 5);
    assert.equal(isInsightCapable(result.dataset.headers, true, id), false);
    assert.ok(result.rows.every(row => Object.values(row.cells).every(cell => cell === null || typeof cell === "string")));
    const response = await GET(new Request(`http://localhost/api/dati/${id}?limit=5`), { params: Promise.resolve({ dataset: id }) });
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).rows, result.rows);
    assert.deepEqual((await queryPublicDataset({ dataset: "spesa_pa_dettaglio", code: id, limit: 5 })).rows, result.rows);
    const next = await selectIntegratedDataset({ datasetId: id, limit: 5, cursor: result.pagination.nextCursor });
    assert.equal(next.rows[0].sourceRow, 6);
    if (id === "salute-dispositivi-bdrdm") {
      assert.equal(result.dataset.headers.length, 16);
      for (const row of result.rows) {
        assert.ok(row.cells.cod_fiscale === null || row.cells.cod_fiscale === "");
        assert.ok(row.cells.PARTITAIVA_VATNUMBER_MAND === null || row.cells.PARTITAIVA_VATNUMBER_MAND === "");
      }
    } else if (id.startsWith("salute-spesa")) {
      assert.ok(result.rows.every(row => row.cells.Anno === period));
      assert.ok(result.dataset.caveats.some(note => note.includes("non sommare con CE")));
    }
  }
});
