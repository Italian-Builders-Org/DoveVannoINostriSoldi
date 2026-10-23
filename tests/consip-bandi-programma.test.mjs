import assert from "node:assert/strict";
import test from "node:test";
import "./helpers/register-ts-alias.mjs";

const { selectIntegratedDataset } = await import("../src/lib/integrated-public-view.ts");
const {
  CONSIP_BANDI_DATASET,
  consipBandiOpenStatus,
  getConsipBandiPage,
  parseConsipBandiRow,
} = await import("../src/lib/consip-bandi-programma.ts");

test("Consip open status stays fail-closed without Data_Termine", () => {
  assert.equal(consipBandiOpenStatus(""), "senza-scadenza");
  assert.equal(consipBandiOpenStatus("2027-01-01"), "aperto");
  assert.equal(consipBandiOpenStatus("2020-01-01"), "scaduto");
});

test("Consip bandi page exposes instrument and dataset provenance", async () => {
  const page = await getConsipBandiPage({});
  assert.equal(page.dataset.publicRows, 1839);
  assert.ok(page.bandi.length > 0);
  assert.equal(page.bandi[0].datasetUrl, "https://dati.consip.it/dataset/dataset-bandi-e-gare");
  const parsed = parseConsipBandiRow(page.rows[0]);
  assert.equal(parsed.lotId, page.bandi[0].lotId);
  const openPage = await getConsipBandiPage({ soloAperti: "1" });
  assert.ok(openPage.bandi.every((row) => row.openStatus === "aperto"));
});

test("strumento filter scans the full dataset before paginating", async () => {
  const firstChunk = await selectIntegratedDataset({ datasetId: CONSIP_BANDI_DATASET, limit: 25 });
  const mepaBeyondFirstChunk = firstChunk.rows
    .map((row) => parseConsipBandiRow(row))
    .every((row) => row.instrument !== "MePA");
  const mepaPage = await getConsipBandiPage({ strumento: "mepa" });
  assert.ok(mepaPage.matchedRows > 0);
  assert.ok(mepaPage.bandi.every((row) => row.instrument === "MePA"));
  if (mepaBeyondFirstChunk) {
    assert.ok(mepaPage.bandi.length > 0, "expected MePA rows on page 1 after full-dataset filter");
  }
});
