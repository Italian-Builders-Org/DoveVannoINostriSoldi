import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server.js";
import "./helpers/register-ts-alias.mjs";

const {
  inlVigilanzaData: data,
  inlVigilanzaMetadata: metadata,
  queryInlVigilanza: query,
} = await import("../src/lib/inl-vigilanza-snapshot.ts");
const { validateInlVigilanzaBundle: validate } = await import(
  "../src/lib/data/inl-vigilanza-contract.ts"
);
const { GET } = await import("../src/app/api/lavoro/vigilanza-inl/route.ts");
const { queryPublicDataset } = await import("../src/lib/mcp/datasets.ts");
const { datasetCatalog } = await import("../src/lib/mcp/catalog.ts");
const get = (params = "") =>
  GET(new NextRequest(`http://localhost/api/lavoro/vigilanza-inl${params}`));

test("INL vigilanza keeps counts, rates and recovery money distinct", () => {
  assert.equal(data.coverage.observedRows, 1576);
  assert.equal(data.coverage.territories, 131);
  assert.equal(metadata.source.licenseId, "CC-BY-3.0-IT");
  assert.match(data.caveats.join(" "), /mirat/i);
  assert.match(data.caveats.join(" "), /tax gap/i);
  const recovery = data.observations.filter((row) => row.table === "recovery");
  assert.equal(recovery.length, 4);
  assert.ok(recovery.every((row) => row.table === "recovery" && row.recoveryEuroCents > 0));
});

test("HTTP and MCP agree on table, territory and sector filters", async () => {
  const filtered = query({
    year: 2025,
    table: "inspectionsOutcome",
    territory: "ITALIA",
    sector: "Edilizia",
  });
  assert.equal(filtered.observations.length, 1);
  const row = filtered.observations[0];
  assert.equal(row.table, "inspectionsOutcome");
  assert.equal(row.territory, "ITALIA");
  assert.equal(row.sector, "Edilizia");

  const response = await get(
    "?anno=2025&tabella=inspectionsOutcome&territorio=ITALIA&settore=Edilizia",
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), filtered);

  const mcp = await queryPublicDataset({
    dataset: "inl_vigilanza",
    year: 2025,
    table: "inspectionsOutcome",
    territory: "ITALIA",
    sector: "Edilizia",
  });
  assert.equal(mcp.dataset, "inl_vigilanza");
  assert.deepEqual(mcp.observations, filtered.observations);
  assert.ok(datasetCatalog.some((entry) => entry.id === "inl_vigilanza"));
});

test("runtime rejects unknown years and tables", async () => {
  assert.throws(() => query({ year: 2024 }), /2025/);
  assert.throws(() => query({ table: "unknown" }), /inspectionsStarted/);
  const bad = await get("?anno=2024");
  assert.equal(bad.status, 400);
});

test("contract validation rejects provenance tampering", () => {
  validate(data, metadata);
  const broken = structuredClone(data);
  broken.coverage = { ...broken.coverage, observedRows: 1575 };
  assert.throws(() => validate(broken, metadata), /observedRows|Expected|Invalid|Literal/i);

  const copy = structuredClone(metadata);
  copy.source.asset.sha256 = "0".repeat(64);
  assert.throws(() => validate(data, copy), /fonte|hash|incoerente|ufficiale/i);
});
