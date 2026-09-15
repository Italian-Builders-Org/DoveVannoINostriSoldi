import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server.js";
import "./helpers/register-ts-alias.mjs";

const {
  eurostatShaHealthData: data,
  eurostatShaHealthMetadata: metadata,
  queryEurostatShaHealth: query,
  getEurostatShaHealthPanel,
} = await import("../src/lib/eurostat-sha-health-snapshot.ts");
const { validateEurostatShaHealthBundle: validate } = await import(
  "../src/lib/data/eurostat-sha-health-contract.ts"
);
const { GET } = await import("../src/app/api/sanita/sha/route.ts");
const { queryPublicDataset } = await import("../src/lib/mcp/datasets.ts");
const { datasetCatalog } = await import("../src/lib/mcp/catalog.ts");
const get = (params = "") => GET(new NextRequest(`http://localhost/api/sanita/sha${params}`));

test("Eurostat SHA preserves coverage, OOP 2024 and provisional 2025", () => {
  assert.equal(data.coverage.observedCells, 156);
  assert.equal(data.geography.code, "IT");
  assert.equal(data.period.from, 2014);
  assert.equal(data.period.to, 2025);
  assert.equal(data.units.money, "euro-cents");
  const oop = data.observations.find((row) => row.scheme === "HF3" && row.year === 2024);
  assert.equal(oop.status, "observed");
  assert.equal(oop.amountCents, 42_791 * 100_000_000);
  assert.equal(oop.flag, null);
  const total2025 = data.observations.find((row) => row.scheme === "TOT_HF" && row.year === 2025);
  assert.equal(total2025.amountCents, 190_117 * 100_000_000);
  assert.equal(total2025.flag, "p");
  assert.equal(metadata.source.licenseId, "CC-BY-4.0");
  assert.equal(metadata.source.datasetCode, "hlth_sha11_hf");
  assert.match(data.caveats.join(" "), /Non sommare/i);
});

test("HTTP and MCP agree on year and scheme filters", async () => {
  const filtered = query({ year: 2024, scheme: "HF3" });
  assert.equal(filtered.observations.length, 1);
  assert.equal(filtered.observations[0].scheme, "HF3");

  const response = await get("?anno=2024&schema=HF3");
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), filtered);

  const mcp = await queryPublicDataset({
    dataset: "eurostat_sha_health",
    year: 2024,
    code: "HF3",
  });
  assert.equal(mcp.dataset, "eurostat_sha_health");
  assert.deepEqual(mcp.observations, filtered.observations);
  assert.ok(datasetCatalog.some((entry) => entry.id === "eurostat_sha_health"));
});

test("runtime rejects unknown years and schemes", async () => {
  assert.throws(() => query({ year: 2013 }), /2014 e 2025/);
  assert.throws(() => query({ scheme: "HF31" }), /schema SHA/);
  const bad = await get("?anno=2013");
  assert.equal(bad.status, 400);
  const repeated = await get("?anno=2024&anno=2023");
  assert.equal(repeated.status, 400);
});

test("sanita panel exposes highlight schemes for the selected year", () => {
  const panel = getEurostatShaHealthPanel(2024);
  assert.equal(panel.year, 2024);
  assert.equal(panel.provisional, false);
  assert.deepEqual(
    panel.rows.map((row) => row.scheme),
    ["TOT_HF", "HF1", "HF11", "HF2", "HF3"],
  );
  assert.equal(panel.apiPath, "/api/sanita/sha?anno=2024");
});

test("contract validation rejects money or provenance tampering", () => {
  validate(data, metadata);
  const broken = structuredClone(data);
  const total = broken.observations.find(
    (row) => row.scheme === "TOT_HF" && row.year === 2024,
  );
  total.amountCents += 1;
  assert.throws(() => validate(broken, metadata), /riconciliazione/i);

  for (const mutate of [
    (copy) => { copy.source.landingUrl = "https://ec.europa.eu/eurostat/other"; },
    (copy) => { copy.source.assets["mio-eur"].sha256 = "0".repeat(64); },
    (copy) => { copy.integrity.dataArtifact.sha256 = "0".repeat(64); },
  ]) {
    const copy = structuredClone(metadata);
    mutate(copy);
    assert.throws(() => validate(data, copy), /fonte|hash|landing|incoerente/i);
  }
});
