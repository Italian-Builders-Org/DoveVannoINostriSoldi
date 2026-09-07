import assert from "node:assert/strict";
import test from "node:test";
import "./helpers/register-ts-alias.mjs";
import { aggregateHospitalBeds, HOSPITAL_BEDS_DATASET, HOSPITAL_BEDS_HEADERS } from "../src/lib/data/salute-hospital-beds-contract.ts";
const { amountColumnKeys } = await import("../src/lib/integrated-dataset-insight-core.ts");

const { getHospitalBeds } = await import("../src/lib/salute-hospital-beds.ts");
const { selectIntegratedDataset } = await import("../src/lib/integrated-public-view.ts");
const { GET } = await import("../src/app/api/dati/[dataset]/route.ts");
const { queryPublicDataset } = await import("../src/lib/mcp/datasets.ts");
const { datasetCatalog } = await import("../src/lib/mcp/catalog.ts");

const rows = [];
for (let offset = 0; offset < 1_019; offset += 100) {
  const result = await selectIntegratedDataset({ datasetId: HOSPITAL_BEDS_DATASET, offset, limit: 100 });
  rows.push(...result.rows);
}

test("hospital capacity retains all 2023 territories, disjoint disciplines and IODL provenance", async () => {
  const { dataset, regions } = await getHospitalBeds();
  assert.equal(dataset.sourceMetadata.referencePeriod, "2023-01-01");
  assert.equal(dataset.sourceMetadata.publicationDate, "2025-07-29");
  assert.equal(dataset.sourceMetadata.acquisitionDate, "2026-09-06");
  assert.equal(dataset.licenseStatus, "verified-open-iodl-2.0");
  assert.match(dataset.reuseNote, /IODL/);
  assert.doesNotMatch(dataset.reuseNote, /CC BY|non dichiarate/);
  assert.equal(regions.length, 21);
  assert.deepEqual(regions.map((region) => region.code), [...regions.map((region) => region.code)].sort());
  assert.ok(regions.find((region) => region.code === "041"));
  assert.ok(regions.find((region) => region.code === "042"));
  assert.equal(regions.reduce((sum, region) => sum + region.total, 0), 212_768);
  for (const region of regions) assert.equal(region.total, region.acute + region.rehabilitation + region.longTerm);
  assert.equal(rows[0].cells["Posti letto degenza ordinaria"], "0");
  assert.equal(rows[0].cells["Totale posti letto"], "1");
});

test("hospital counts are never formatted as euro amounts in the generic dataset table", () => {
  assert.deepEqual(amountColumnKeys(HOSPITAL_BEDS_HEADERS, rows), new Set());
});

for (const [label, mutate, error] of [
  ["missing row", (r) => r.pop(), /copertura/],
  ["duplicate discipline", (r) => { r[1] = structuredClone(r[0]); }, /duplicati/],
  ["wrong reference year", (r) => { r[0].cells.Anno = "2024"; }, /periodo/],
  ["unknown region", (r) => { r[0].cells["Codice Regione"] = "040"; }, /territorio/],
  ["missing count", (r) => { r[0].cells["Posti letto degenza ordinaria"] = null; }, /conteggio/],
  ["negative count", (r) => { r[0].cells["N° Reparti"] = "-1"; }, /conteggio/],
  ["fractional count", (r) => { r[0].cells["N° Reparti"] = "1.5"; }, /conteggio/],
  ["unsafe count", (r) => { r[0].cells["N° Reparti"] = "9007199254740992"; }, /conteggio/],
  ["unreconciled total", (r) => { r[0].cells["Totale posti letto"] = "2"; }, /riconciliato/],
  ["wrong discipline group", (r) => { r[0].cells["Tipo di Disciplina"] = "LUNGODEGENZA"; }, /disciplina/],
]) {
  test(`hospital capacity rejects ${label}`, () => {
    const changed = structuredClone(rows);
    mutate(changed);
    assert.throws(() => aggregateHospitalBeds(HOSPITAL_BEDS_HEADERS, changed), error);
  });
}

test("hospital API uses the shared selector and retains numeric codes and units", async () => {
  const result = await GET(new Request(`http://localhost/api/dati/${HOSPITAL_BEDS_DATASET}?q=PIEMONTE&limit=5`), {
    params: Promise.resolve({ dataset: HOSPITAL_BEDS_DATASET }),
  });
  assert.equal(result.status, 200);
  const body = await result.json();
  const expected = await selectIntegratedDataset({ datasetId: HOSPITAL_BEDS_DATASET, q: "PIEMONTE", limit: 5 });
  assert.deepEqual(body, expected);
  assert.equal(body.rows[0].cells["Codice Regione"], "010");
  assert.equal(body.rows[0].cells["Codice disciplina"], "01");
});

test("MCP exposes hospital capacity through the same canonical integrated dataset", async () => {
  const descriptor = datasetCatalog.find((dataset) => dataset.id === "salute_posti_letto");
  assert.equal(descriptor.sources[0].license, "IODL 2.0");
  assert.match(descriptor.caveat, /non misura.*qualità/);
  const result = await queryPublicDataset({ dataset: "salute_posti_letto", query: "PIEMONTE", limit: 5 });
  const expected = await selectIntegratedDataset({ datasetId: HOSPITAL_BEDS_DATASET, q: "PIEMONTE", limit: 5 });
  assert.deepEqual(result, expected);
  await assert.rejects(queryPublicDataset({ dataset: "salute_posti_letto", year: 2024 }), /Filtri non supportati/);
});
