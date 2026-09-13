import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server.js";
import "./helpers/register-ts-alias.mjs";

const {
  mefTaxGapNazionaleData: data,
  mefTaxGapNazionaleMetadata: metadata,
  queryMefTaxGapNazionale: query,
} = await import("../src/lib/mef-tax-gap-nazionale-snapshot.ts");
const { validateMefTaxGapNazionaleBundle: validate } = await import(
  "../src/lib/data/mef-tax-gap-nazionale-contract.ts"
);
const { GET } = await import("../src/app/api/tributi/tax-gap/route.ts");
const { queryPublicDataset } = await import("../src/lib/mcp/datasets.ts");
const { datasetCatalog } = await import("../src/lib/mcp/catalog.ts");
const get = (params = "") => GET(new NextRequest(`http://localhost/api/tributi/tax-gap${params}`));

test("MEF tax gap preserves national Tab. I.1/I.2 units and 2022 semi-definitive series", () => {
  assert.equal(data.taxRows.length, 16);
  assert.equal(data.geography.code, "IT");
  assert.equal(data.period.from, 2018);
  assert.equal(data.period.to, 2022);
  assert.equal(data.units.money, "euro-cents");
  assert.equal(data.units.propensione, "tenths-of-a-percentage-point");
  const iva = data.taxRows.find((row) => row.id === "iva");
  const year2022 = iva.series.find((row) => row.year === 2022);
  assert.equal(year2022.gap.valueCents, 28_966 * 100_000_000);
  assert.equal(year2022.propensione.valueTenthsPp, 184);
  assert.equal(metadata.source.licenseId, "not-declared");
  assert.equal(metadata.source.publicationDate, null);
  assert.equal(metadata.source.versionDate, "2025-10-23");
  assert.equal(metadata.pdf.tableI1PageIndex, 8);
  assert.match(data.caveats.join(" "), /non è evasione accertata/i);
});

test("HTTP and MCP agree on year and tax filters", async () => {
  const filtered = query({ year: 2022, tax: "iva" });
  assert.equal(filtered.taxRows.length, 1);
  assert.equal(filtered.taxRows[0].id, "iva");
  assert.equal(filtered.taxRows[0].series.length, 1);

  const response = await get("?anno=2022&imposta=iva");
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), filtered);

  const mcp = await queryPublicDataset({ dataset: "mef_tax_gap_nazionale", year: 2022, tax: "iva" });
  assert.equal(mcp.dataset, "mef_tax_gap_nazionale");
  assert.deepEqual(mcp.taxRows, filtered.taxRows);
  assert.ok(datasetCatalog.some((entry) => entry.id === "mef_tax_gap_nazionale"));
});

test("runtime rejects unknown years, taxes and unsupported params", async () => {
  assert.throws(() => query({ year: 2017 }), /2018 e 2022/);
  assert.throws(() => query({ tax: "vat" }), /id di riga/);
  const bad = await get("?anno=2017");
  assert.equal(bad.status, 400);
  const repeated = await get("?anno=2022&anno=2021");
  assert.equal(repeated.status, 400);
  await assert.rejects(
    queryPublicDataset({ dataset: "mef_tax_gap_nazionale", territory: "IT" }),
    /Filtri non supportati|non supportat/i,
  );
});

test("contract validation rejects provenance or money tampering", () => {
  validate(data, metadata);
  const broken = structuredClone(data);
  const iva = broken.taxRows.find((row) => row.id === "iva");
  iva.series[0].gap.valueCents += 1;
  assert.throws(() => validate(broken, metadata));
});

test("runtime locks every source field and repeated provenance to the reviewed source", () => {
  for (const mutate of [
    (copy) => { copy.source.filename = "different.pdf"; },
    (copy) => { copy.source.geography = "Unione europea"; },
    (copy) => { copy.pdf.tableI1Title = "Different table"; },
    (copy) => { copy.pdf.tableI2Title = "Different table"; },
    (copy) => { copy.pdf.tableI1TextSha256 = "0".repeat(64); },
    (copy) => { copy.semantics.provenance.publicationDate = "2025-01-01"; },
    (copy) => { copy.semantics.provenance.checkedAt = "2026-09-12"; },
  ]) {
    const copy = structuredClone(metadata);
    mutate(copy);
    assert.throws(() => validate(data, copy), /fonte|provenance|hash|pagina|testo|PDF/i);
  }
});
