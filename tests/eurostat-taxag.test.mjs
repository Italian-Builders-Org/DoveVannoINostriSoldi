import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server.js";
import "./helpers/register-ts-alias.mjs";

const {
  eurostatTaxagData: data,
  eurostatTaxagMetadata: metadata,
  queryEurostatTaxag: query,
} = await import("../src/lib/eurostat-taxag-snapshot.ts");
const { validateEurostatTaxagBundle: validate } = await import(
  "../src/lib/data/eurostat-taxag-contract.ts"
);
const { GET } = await import("../src/app/api/tributi/taxag/route.ts");
const { queryPublicDataset } = await import("../src/lib/mcp/datasets.ts");
const { datasetCatalog } = await import("../src/lib/mcp/catalog.ts");
const get = (params = "") => GET(new NextRequest(`http://localhost/api/tributi/taxag${params}`));

test("Eurostat taxag preserves SEC units, coverage and 2025 VAT", () => {
  assert.equal(data.coverage.observedCells, 516);
  assert.equal(data.geography.code, "IT");
  assert.equal(data.period.from, 2014);
  assert.equal(data.period.to, 2025);
  assert.equal(data.units.money, "euro-cents");
  const vat = data.observations.find(
    (row) => row.naItem === "D211" && row.sector === "S13" && row.year === 2025,
  );
  assert.equal(vat.status, "observed");
  assert.equal(vat.amountCents, 150_384 * 100_000_000);
  assert.equal(metadata.source.licenseId, "CC-BY-4.0");
  assert.equal(metadata.source.datasetCode, "gov_10a_taxag");
  assert.match(data.caveats.join(" "), /non è cassa SIOPE/i);
});

test("HTTP and MCP agree on year, sector and tax filters", async () => {
  const filtered = query({ year: 2025, sector: "S13", tax: "D211" });
  assert.equal(filtered.observations.length, 1);
  assert.equal(filtered.observations[0].naItem, "D211");

  const response = await get("?anno=2025&settore=S13&voce=D211");
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), filtered);

  const mcp = await queryPublicDataset({
    dataset: "eurostat_taxag",
    year: 2025,
    sector: "S13",
    tax: "D211",
  });
  assert.equal(mcp.dataset, "eurostat_taxag");
  assert.deepEqual(mcp.observations, filtered.observations);
  assert.ok(datasetCatalog.some((entry) => entry.id === "eurostat_taxag"));
});

test("runtime rejects unknown years, sectors and taxes", async () => {
  assert.throws(() => query({ year: 2013 }), /2014 e 2025/);
  assert.throws(() => query({ sector: "S1312" }), /S13/);
  assert.throws(() => query({ tax: "VAT" }), /na_item/);
  const bad = await get("?anno=2013");
  assert.equal(bad.status, 400);
  const repeated = await get("?anno=2025&anno=2024");
  assert.equal(repeated.status, 400);
});

test("absent S1314 tax total stays absent", () => {
  const row = data.observations.find(
    (item) => item.naItem === "D2_D5_D91" && item.sector === "S1314" && item.year === 2025,
  );
  assert.equal(row.status, "absent");
  assert.equal(row.amountCents, null);
});

test("contract validation rejects money or provenance tampering", () => {
  validate(data, metadata);
  const broken = structuredClone(data);
  const taxTotal = broken.observations.find(
    (row) => row.naItem === "D2_D5_D91" && row.sector === "S13" && row.year === 2025,
  );
  taxTotal.amountCents += 1;
  assert.throws(() => validate(broken, metadata), /riconciliazione/i);

  for (const mutate of [
    (copy) => { copy.source.landingUrl = "https://ec.europa.eu/eurostat/other"; },
    (copy) => { copy.source.assets["mio-eur"].sha256 = "0".repeat(64); },
    (copy) => { copy.semantics.provenance.checkedAt = "2026-09-01"; },
  ]) {
    const copy = structuredClone(metadata);
    mutate(copy);
    assert.throws(() => validate(data, copy), /fonte|hash|provenance|incoerente/i);
  }
});
