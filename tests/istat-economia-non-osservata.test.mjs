import assert from "node:assert/strict";
import test from "node:test";
import "./helpers/register-ts-alias.mjs";

const { selectIntegratedDataset } = await import("../src/lib/integrated-public-view.ts");
const { queryPublicDataset } = await import("../src/lib/mcp/datasets.ts");
const { GET } = await import("../src/app/api/dati/[dataset]/route.ts");

const componentsId = "istat-economia-non-osservata-componenti";
const branchesId = "istat-economia-sommersa-branche";

test("ISTAT non-observed economy rows keep source precision, units and denominators through API and MCP", async () => {
  const cases = [
    [componentsId, 104, "2023", (row) => row.cells.Anno === "2023"],
    [branchesId, 624, "Agricoltura, silvicoltura e pesca", (row) => row.cells.Branca === "Agricoltura, silvicoltura e pesca"],
  ];
  for (const [datasetId, rows, query, matches] of cases) {
    const selected = await selectIntegratedDataset({ datasetId, q: query, limit: 100 });
    assert.equal(selected.dataset.publicRows, rows);
    assert.equal(selected.dataset.licenseStatus, "verified-open-cc-by-4.0");
    assert.equal(selected.dataset.sourceMetadata.publicationDate, "2025-10-17");
    assert.equal(selected.dataset.sourceMetadata.acquisitionDate, "2026-09-12");
    assert.match(selected.dataset.sourceMetadata.referencePeriod, /2011-2023/);
    assert.match(selected.dataset.caveats.join(" "), /non (?:sono )?evasione fiscale accertata/i);
    assert.match(selected.dataset.caveats.join(" "), /nessun valore è distribuito|non esiste geografia/i);
    assert.ok(selected.rows.length > 0);
    assert.ok(selected.rows.every(matches));
    assert.ok(selected.rows.every((row) => row.sourceUrls.length === 1));
    assert.ok(selected.rows.every((row) => Object.values(row.cells).every((value) => value === null || typeof value === "string")));

    const response = await GET(
      new Request(`http://localhost/api/dati/${datasetId}?q=${encodeURIComponent(query)}&limit=100`),
      { params: Promise.resolve({ dataset: datasetId }) },
    );
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).rows, selected.rows);

    const mcp = await queryPublicDataset({
      dataset: "spesa_pa_dettaglio",
      code: datasetId,
      query,
      limit: 100,
    });
    assert.deepEqual(mcp.rows, selected.rows);
    assert.deepEqual(mcp.dataset.sourceMetadata, selected.dataset.sourceMetadata);
  }
});

test("national components preserve missing incidence separately from observed zero", async () => {
  const denominators = await selectIntegratedDataset({ datasetId: componentsId, q: "Valore aggiunto", limit: 20 });
  assert.equal(denominators.rows.length, 13);
  assert.ok(denominators.rows.every((row) => row.cells["Incidenza percentuale"] === ""));
  assert.ok(denominators.rows.every((row) => row.cells["Denominatore incidenza"] === ""));

  const branch = await selectIntegratedDataset({
    datasetId: branchesId,
    q: "Sottodichiarazione",
    limit: 100,
  });
  const observedZero = branch.rows.find(
    (row) => row.cells.Anno === "2011" && row.cells.Branca === "Agricoltura, silvicoltura e pesca",
  );
  assert.ok(observedZero);
  assert.equal(observedZero.cells["Incidenza percentuale"], "0");
  assert.equal(observedZero.cells.Denominatore, "valore aggiunto totale della stessa branca");
});

test("shared API and MCP reject unsupported or ambiguous filters", async () => {
  for (const query of ["limit=0", "limit=2&limit=3", "offset=-1", "q=a&q=b"]) {
    const response = await GET(
      new Request(`http://localhost/api/dati/${componentsId}?${query}`),
      { params: Promise.resolve({ dataset: componentsId }) },
    );
    assert.equal(response.status, 400, query);
  }
  await assert.rejects(
    queryPublicDataset({ dataset: "spesa_pa_dettaglio", code: componentsId, year: 2023 }),
    /Filtri non supportati/,
  );
});
