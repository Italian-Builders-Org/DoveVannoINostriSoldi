import assert from "node:assert/strict";
import test from "node:test";
import "./helpers/register-ts-alias.mjs";

const { selectIntegratedDataset } = await import("../src/lib/integrated-public-view.ts");
const { isInsightCapable, amountColumnKeys } = await import("../src/lib/integrated-dataset-insight-core.ts");
const { queryPublicDataset } = await import("../src/lib/mcp/datasets.ts");
const { relatedReadingForDataset } = await import("../src/lib/integrated-catalog-views.ts");
const { GET } = await import("../src/app/api/dati/[dataset]/route.ts");

test("Conto Annuale exposes historical rows, stable administration keys and source scope through the public API", async () => {
  for (const [kind, total] of [["costo", 244566], ["personale", 101546]]) {
    const id = `rgs-conto-annuale-${kind}-2020`;
    const result = await selectIntegratedDataset({ datasetId: id, limit: 5 });
    assert.equal(result.dataset.publicRows, total);
    assert.match(result.dataset.sourceMetadata.referencePeriod, /2020/);
    assert.equal(result.dataset.sourceMetadata.publicationDate, "2022-09-23");
    assert.equal(result.dataset.licenseStatus, "verified-open-cc-by-4.0");
    assert.equal(isInsightCapable(result.dataset.headers, true), false);
    assert.equal(relatedReadingForDataset(result.dataset).href, "/incarichi/personale-organi");
    assert.equal(result.rows[0].cells.Anno, "2020");
    assert.equal(result.rows[0].cells["Codice amministrazione RGS"], "U:11799");
    assert.ok(result.rows.every((row) => row.sourceUrls[0].startsWith("https://dati-coll.dfp.gov.it/")));
    assert.ok(result.rows.every((row) => Object.values(row.cells).every((cell) => cell === null || typeof cell === "string")));
    const response = await GET(new Request(`http://localhost/api/dati/${id}?limit=5`), { params: Promise.resolve({ dataset: id }) });
    assert.equal(response.status, 200);
    const api = await response.json();
    assert.deepEqual(api.rows, result.rows);
    const mcp = await queryPublicDataset({ dataset: "spesa_pa_dettaglio", code: id, limit: 5 });
    assert.deepEqual(mcp.rows, result.rows);
    if (kind === "costo") {
      assert.equal(result.rows[0].cells["Importo euro"], "15000000");
      assert.ok(result.dataset.caveats.some((note) => note.includes("non è SIOPE cassa")));
      assert.ok(amountColumnKeys(result.dataset.headers, result.rows).has("Importo euro"));
    } else {
      assert.ok(result.dataset.caveats.some((note) => note.includes("220 ricorrenze")));
      assert.equal(amountColumnKeys(result.dataset.headers, result.rows).size, 0);
    }
  }
});
