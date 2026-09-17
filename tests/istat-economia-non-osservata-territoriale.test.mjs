import assert from "node:assert/strict";
import test from "node:test";
import "./helpers/register-ts-alias.mjs";

const { selectIntegratedDataset } = await import("../src/lib/integrated-public-view.ts");
const { queryPublicDataset } = await import("../src/lib/mcp/datasets.ts");
const { GET } = await import("../src/app/api/dati/[dataset]/route.ts");

const datasetId = "istat-economia-non-osservata-territori";

test("ISTAT territorial NOE percentages keep lexical precision through API and MCP", async () => {
  const selected = await selectIntegratedDataset({ datasetId, q: "Calabria", limit: 20 });
  assert.equal(selected.dataset.publicRows, 108);
  assert.equal(selected.dataset.licenseStatus, "verified-open-cc-by-4.0");
  assert.equal(selected.dataset.sourceMetadata.publicationDate, "2025-12-22");
  assert.equal(selected.dataset.sourceMetadata.acquisitionDate, "2026-09-13");
  assert.ok(selected.dataset.sourceMetadata.canonicalUrls.includes("https://www.istat.it/comunicato-stampa/conti-economici-territoriali-2022-2024/"));
  assert.match(selected.dataset.caveats.join(" "), /19 regioni, 2 province autonome/);
  assert.match(selected.dataset.sourceMetadata.referencePeriod, /2023/);
  assert.match(selected.dataset.caveats.join(" "), /non (?:sono )?evasione fiscale accertata/i);
  assert.match(selected.dataset.caveats.join(" "), /percentuali/i);
  assert.match(selected.dataset.caveats.join(" "), /non vanno ricostruiti|aggregati pubblicati/i);
  assert.ok(selected.rows.length > 0);
  assert.ok(selected.rows.every((row) => row.cells.Territorio === "Calabria"));
  assert.ok(selected.rows.every((row) => row.cells.Anno === "2023"));
  assert.ok(selected.rows.every((row) => row.cells.Unità === "percentuale"));
  assert.ok(
    selected.rows.every((row) =>
      Object.values(row.cells).every((value) => value === null || typeof value === "string"),
    ),
  );

  const totale = selected.rows.find((row) => row.cells.Componente === "Totale");
  assert.ok(totale);
  assert.equal(totale.cells["Incidenza percentuale"], "19.002945008887309");

  const response = await GET(
    new Request(`http://localhost/api/dati/${datasetId}?q=Calabria&limit=20`),
    { params: Promise.resolve({ dataset: datasetId }) },
  );
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).rows, selected.rows);

  const mcp = await queryPublicDataset({
    dataset: "spesa_pa_dettaglio",
    code: datasetId,
    query: "Calabria",
    limit: 20,
  });
  assert.deepEqual(mcp.rows, selected.rows);
  assert.deepEqual(mcp.dataset.sourceMetadata, selected.dataset.sourceMetadata);
});

test("published aggregates stay distinct and search does not invent comuni", async () => {
  const italia = await selectIntegratedDataset({ datasetId, q: "Italia", limit: 10 });
  assert.equal(italia.rows.length, 4);
  assert.ok(italia.rows.every((row) => row.cells.Territorio === "Italia"));

  const ripartizione = await selectIntegratedDataset({
    datasetId,
    q: "Mezzogiorno",
    limit: 10,
  });
  assert.equal(ripartizione.rows.length, 4);
  assert.ok(ripartizione.rows.every((row) => row.cells.Territorio === "Mezzogiorno"));

  const empty = await selectIntegratedDataset({ datasetId, q: "Milano", limit: 10 });
  assert.equal(empty.rows.length, 0);
});

test("shared API and MCP reject unsupported filters for territorial NOE", async () => {
  for (const query of ["limit=0", "limit=2&limit=3", "offset=-1", "q=a&q=b"]) {
    const response = await GET(
      new Request(`http://localhost/api/dati/${datasetId}?${query}`),
      { params: Promise.resolve({ dataset: datasetId }) },
    );
    assert.equal(response.status, 400, query);
  }
  await assert.rejects(
    queryPublicDataset({ dataset: "spesa_pa_dettaglio", code: datasetId, year: 2023 }),
    /Filtri non supportati/,
  );
});
