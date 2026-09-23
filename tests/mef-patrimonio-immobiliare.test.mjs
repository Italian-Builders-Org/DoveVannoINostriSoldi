import assert from "node:assert/strict";
import test from "node:test";
import "./helpers/register-ts-alias.mjs";

const { selectIntegratedDataset } = await import("../src/lib/integrated-public-view.ts");
const { queryPublicDataset } = await import("../src/lib/mcp/datasets.ts");
const { GET } = await import("../src/app/api/dati/[dataset]/route.ts");
const { relatedReadingForDataset } = await import("../src/lib/integrated-catalog-views.ts");

const beniId = "mef-patrimonio-beni-2023";
const contrattiId = "mef-patrimonio-contratti-2023";
const roma = "02438750586";

test("MEF beni rows keep provenance, titles and declared use per entity", async () => {
  const selected = await selectIntegratedDataset({ datasetId: beniId, equals: { "Codice fiscale ente": roma }, limit: 100 });
  assert.equal(selected.dataset.publicRows, 125_371);
  assert.equal(selected.dataset.licenseStatus, "verified-open-cc-by-4.0");
  assert.equal(selected.dataset.sourceMetadata.publicationDate, "2026-05-05");
  assert.equal(selected.dataset.sourceMetadata.acquisitionDate, "2026-09-23");
  assert.match(selected.dataset.sourceMetadata.referencePeriod, /31\/12\/2023/);
  assert.match(selected.dataset.caveats.join(" "), /non dice se il bene sia agibile/);
  assert.match(selected.dataset.caveats.join(" "), /un'assenza non è uno zero/);
  assert.equal(selected.rows.length, 60);
  assert.ok(selected.rows.every((row) => row.cells["Codice fiscale ente"] === roma));
  assert.ok(
    selected.rows.every((row) => Object.values(row.cells).every((value) => value === null || typeof value === "string")),
  );

  const vuote = selected.rows.find((row) =>
    row.cells.Titolo === "Proprietà" &&
    row.cells["Utilizzo del bene"] === "Non utilizzato" &&
    row.cells["Tipologia bene"] === "Abitazione");
  assert.ok(vuote);
  assert.equal(vuote.cells.Beni, "1070");
  assert.equal(vuote.cells["Superficie di riferimento (m²)"], "80483.39");
  assert.ok(selected.rows.some((row) => row.cells.Titolo === "in locazione"));
});

test("free-text search matches API and MCP for the same entity", async () => {
  const [first] = (await selectIntegratedDataset({ datasetId: beniId, limit: 1 })).rows;
  const code = first.cells["Codice fiscale ente"];
  const selected = await selectIntegratedDataset({ datasetId: beniId, q: code, limit: 20 });
  assert.ok(selected.rows.length > 0);
  assert.ok(selected.rows.every((row) => row.cells["Codice fiscale ente"] === code));

  const response = await GET(
    new Request(`http://localhost/api/dati/${beniId}?q=${code}&limit=20`),
    { params: Promise.resolve({ dataset: beniId }) },
  );
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).rows, selected.rows);

  const mcp = await queryPublicDataset({ dataset: "spesa_pa_dettaglio", code: beniId, query: code, limit: 20 });
  assert.deepEqual(mcp.rows, selected.rows);
});

test("MEF contracts keep empty and zero rent distinct and expose the ratio inputs", async () => {
  const selected = await selectIntegratedDataset({ datasetId: contrattiId, equals: { "Codice fiscale ente": roma }, limit: 100 });
  assert.equal(selected.dataset.publicRows, 21_034);
  assert.match(selected.dataset.caveats.join(" "), /non misura incassi/);
  assert.match(selected.dataset.caveats.join(" "), /non è confrontabile con il mercato/);

  const erp = selected.rows.find((row) =>
    row.cells["Tipo detenzione"] === "in locazione" &&
    row.cells["Finalità persona fisica"] === "Edilizia residenziale pubblica" &&
    row.cells["Tipologia bene"] === "Abitazione");
  assert.ok(erp);
  assert.deepEqual(
    [
      erp.cells.Contratti,
      erp.cells["Contratti con canone positivo"],
      erp.cells["Contratti con canone zero"],
      erp.cells["Contratti senza canone"],
      erp.cells["Canone annuo per rapporto (EUR)"],
      erp.cells["Superficie per rapporto (m²)"],
    ],
    ["22734", "22524", "210", "0", "24112758", "1555156.62"],
  );
  assert.ok(selected.rows.every((row) => !("Sogg. ricevente (denominaz.)" in row.cells)));
});

test("patrimonio datasets are not framed as oversight signals", () => {
  for (const id of [beniId, contrattiId]) {
    assert.equal(relatedReadingForDataset({ id, domain: "entities" }), null);
  }
});
