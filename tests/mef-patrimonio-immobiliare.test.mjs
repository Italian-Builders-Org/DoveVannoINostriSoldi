import assert from "node:assert/strict";
import test from "node:test";
import "./helpers/register-ts-alias.mjs";

const { selectIntegratedDataset } = await import("../src/lib/integrated-public-view.ts");
const { queryPublicDataset } = await import("../src/lib/mcp/datasets.ts");
const { GET } = await import("../src/app/api/dati/[dataset]/route.ts");
const { relatedReadingForDataset } = await import("../src/lib/integrated-catalog-views.ts");

const beniId = "mef-patrimonio-beni-2023";
const contrattiId = "mef-patrimonio-contratti-2023";
const adempimentoId = "mef-patrimonio-adempimento-2023";
const roma = "02438750586";

// Pages are capped at 100 rows: follow the cursor, as the entity profile will.
async function allRows(datasetId, equals) {
  const rows = [];
  let cursor;
  let result;
  do {
    result = await selectIntegratedDataset({ datasetId, equals, limit: 100, cursor });
    rows.push(...result.rows);
    cursor = result.pagination.nextCursor;
  } while (cursor);
  return { dataset: result.dataset, rows };
}

test("MEF beni rows keep provenance, titles and declared use per entity", async () => {
  const selected = await allRows(beniId, { "Codice fiscale ente": roma });
  assert.equal(selected.dataset.publicRows, 140_712);
  assert.equal(selected.dataset.licenseStatus, "verified-open-cc-by-4.0");
  assert.equal(selected.dataset.sourceMetadata.publicationDate, "2026-05-05");
  assert.equal(selected.dataset.sourceMetadata.acquisitionDate, "2026-09-23");
  assert.match(selected.dataset.sourceMetadata.referencePeriod, /comunicazioni precedenti/);
  assert.match(selected.dataset.caveats.join(" "), /non hanno inviato la comunicazione 2023/);
  assert.match(selected.dataset.caveats.join(" "), /una pagina vuota non significa/);
  assert.match(selected.dataset.caveats.join(" "), /non dice se il bene sia agibile/);
  assert.match(selected.dataset.caveats.join(" "), /un'assenza non è uno zero/);
  assert.equal(selected.rows.length, 129);
  assert.ok(selected.rows.every((row) => row.cells["Codice fiscale ente"] === roma));
  assert.ok(
    selected.rows.every((row) => Object.values(row.cells).every((value) => value === null || typeof value === "string")),
  );

  const vuote = selected.rows.filter((row) =>
    row.cells.Titolo === "Proprietà" &&
    row.cells["Utilizzo del bene"] === "Non utilizzato" &&
    row.cells["Tipologia bene"] === "Abitazione");
  assert.equal(vuote.reduce((sum, row) => sum + Number(row.cells.Beni), 0), 1070);
  const inRoma = vuote.filter((row) => row.cells["Codice catastale comune del bene"] === "H501");
  assert.equal(inRoma.reduce((sum, row) => sum + Number(row.cells.Beni), 0), 872);
  assert.deepEqual(inRoma.map((row) => row.cells["Dato a terzi"]).sort(), ["No", "Parzialmente"]);
  const unstated = selected.rows.filter((row) => row.cells.Titolo === "Proprietà" && row.cells["Utilizzo del bene"] === "Non indicato");
  assert.equal(unstated.reduce((sum, row) => sum + Number(row.cells.Beni), 0), 28_039);
  assert.ok(unstated.every((row) => row.cells["Dato a terzi"] !== "No"));
  assert.ok(vuote.some((row) => row.cells["Comune del bene"] === "Guidonia Montecelio"));
  assert.ok(vuote.every((row) => row.cells["Comune ente"] === "Roma"));
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
  const selected = await allRows(contrattiId, { "Codice fiscale ente": roma });
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
  for (const id of [beniId, contrattiId, adempimentoId]) {
    assert.equal(relatedReadingForDataset({ id, domain: "entities" }), null);
  }
});

test("compliance rows tell 2023 communications apart from data carried over in the census", async () => {
  const one = async (code) => {
    const { dataset, rows } = await allRows(adempimentoId, { "Codice fiscale ente": code });
    assert.equal(rows.length, 1, code);
    return { dataset, cells: rows[0].cells };
  };
  const roma = await one("02438750586");
  assert.equal(roma.dataset.publicRows, 7_977);
  assert.equal(roma.dataset.sourceMetadata.acquisitionDate, "2026-09-24");
  assert.match(roma.dataset.caveats.join(" "), /Non vanno letti come situazione al 31\/12\/2023/);
  assert.match(roma.dataset.caveats.join(" "), /Una cella vuota non è un «No»/);
  assert.deepEqual(
    ["Invio comunicazione 2023", "Dichiarazione negativa", "Dichiarazione di completezza", "Presente nel censimento pubblicato"]
      .map((key) => roma.cells[key]),
    ["Si", "No", "No", "Si"],
  );

  // Not sent in 2023, yet 197 assets are in the published census: data from earlier communications.
  const cinquefrondi = (await one("00008010803")).cells;
  assert.equal(cinquefrondi["Invio comunicazione 2023"], "No");
  assert.equal(cinquefrondi["Presente nel censimento pubblicato"], "Si");
  assert.equal(cinquefrondi["Beni in proprietà dichiarati"], "197");
  // Without a communication there is no declaration: the cell stays empty, never "No".
  assert.equal(cinquefrondi["Dichiarazione negativa"], "");
  assert.equal(cinquefrondi["Dichiarazione di completezza"], "");

  const cerchio = (await one("00185810660")).cells;
  assert.deepEqual([cerchio["Dichiarazione negativa"], cerchio["Presente nel censimento pubblicato"]], ["Si", "No"]);

  // Every body of the census has a compliance row, joined on the fiscal code.
  const censimento = await allRows(beniId, { "Codice fiscale ente": "00008010803" });
  assert.ok(censimento.rows.length > 0);
});
