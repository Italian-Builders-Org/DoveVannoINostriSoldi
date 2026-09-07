import assert from "node:assert/strict";
import test from "node:test";
import "./helpers/register-ts-alias.mjs";
const { selectIntegratedDataset } = await import("../src/lib/integrated-public-view.ts");
const { queryPublicDataset } = await import("../src/lib/mcp/datasets.ts");
const { GET } = await import("../src/app/api/dati/[dataset]/route.ts");

const ids = [
  "istat-misura-comune-vecchiaia",
  "istat-misura-comune-dipendenza-anziani",
  "istat-misura-comune-dipendenza-strutturale",
];

test("ISTAT municipal series retain all years and exact strings through API and MCP", async () => {
  for (const datasetId of ids) {
    const selected = await selectIntegratedDataset({ datasetId, limit: 2 });
    assert.equal(selected.dataset.publicRows, 7896);
    assert.equal(selected.dataset.domain, "demography");
    assert.equal(selected.dataset.licenseStatus, "not-declared");
    assert.match(selected.dataset.sourceMetadata.referencePeriod, /31 dicembre.*2024/);
    assert.equal(selected.dataset.sourceMetadata.publicationDate, null);
    assert.equal(selected.dataset.sourceMetadata.acquisitionDate, "2026-09-06");
    assert.match(selected.dataset.caveats.join(" "), /statistica sperimentale/);
    assert.match(selected.dataset.caveats.join(" "), /non spesa pubblica/);
    assert.match(selected.dataset.caveats.join(" "), /Non sommare o mediare/);
    assert.equal(selected.rows[0].cells["Codice comune Istat"], "001001");
    for (let year = 2014; year <= 2024; year++) {
      assert.equal(typeof selected.rows[0].cells[String(year)], "string");
    }
    const api = await GET(new Request(`http://localhost/api/dati/${datasetId}?limit=2`), {
      params: Promise.resolve({ dataset: datasetId }),
    });
    assert.equal(api.status, 200);
    assert.deepEqual((await api.json()).rows, selected.rows);
    const mcp = await queryPublicDataset({ dataset: "spesa_pa_dettaglio", code: datasetId, limit: 2 });
    assert.deepEqual(mcp.rows, selected.rows);
    assert.deepEqual(mcp.dataset.sourceMetadata, selected.dataset.sourceMetadata);
  }
});

test("municipal gaps and a zero denominator stay distinct from observed zero", async () => {
  const missing = await selectIntegratedDataset({ datasetId: ids[0], q: "001316", limit: 5 });
  const row = missing.rows.find((item) => item.cells["Codice comune Istat"] === "001316");
  assert.ok(row);
  assert.equal(row.cells["2014"], "..");
  assert.equal(row.cells["2016"], "..");
  assert.match(row.cells["2017"], /^\d/);
  const notComputable = await selectIntegratedDataset({ datasetId: ids[0], q: "002041", limit: 5 });
  assert.equal(notComputable.rows[0].cells["2024"], "N.C.");
  assert.match(notComputable.dataset.caveats.join(" "), /non calcolabile.*zero/);
});

test("shared query limits and unknown dataset rejection also apply to the ISTAT tables", async () => {
  const context = { params: Promise.resolve({ dataset: ids[0] }) };
  for (const query of ["limit=0", "limit=2&limit=3", "offset=-1", "q=a&q=b"]) {
    const response = await GET(new Request(`http://localhost/api/dati/${ids[0]}?${query}`), context);
    assert.equal(response.status, 400, query);
  }
  const unknown = await GET(new Request("http://localhost/api/dati/istat-misura-comune-missing"), {
    params: Promise.resolve({ dataset: "istat-misura-comune-missing" }),
  });
  assert.equal(unknown.status, 404);
  await assert.rejects(queryPublicDataset({ dataset: "spesa_pa_dettaglio", code: ids[0], year: 2024 }), /Filtri non supportati/);
});
