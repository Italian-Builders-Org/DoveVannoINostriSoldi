import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server.js";
import "./helpers/register-ts-alias.mjs";

const { queryPublicDataset } = await import("../src/lib/mcp/datasets.ts");
const { datasetCatalog } = await import("../src/lib/mcp/catalog.ts");
const { GET } = await import("../src/app/api/controlli/spesa-comuni/route.ts");

test("MCP controls catalog advertises the bounded municipal screening filters", () => {
  const descriptor = datasetCatalog.find((dataset) => dataset.id === "controlli_segnali");
  assert.ok(descriptor);
  assert.deepEqual(descriptor.sourceIds, ["opencivitas"]);
  assert.deepEqual(descriptor.filters, ["area", "year", "region", "limit", "offset"]);
});

test("MCP query exposes paginated OpenCivitas screening with provenance and warnings", async () => {
  const result = await queryPublicDataset({
    dataset: "controlli_segnali",
    area: "spesa-comuni",
    year: 2022,
    region: "Calabria",
    limit: 2,
    offset: 1,
  });

  assert.equal(result.spendingOutliers.period.referenceYear, 2022);
  assert.equal(result.spendingOutliers.pagination.offset, 1);
  assert.equal(result.spendingOutliers.pagination.limit, 2);
  assert.equal(result.spendingOutliers.pagination.returned, result.spendingOutliers.outliers.length);
  assert.equal(result.spendingOutliers.provenance.source.observedAt, result.spendingOutliers.period.observedAt);
  assert.ok(result.spendingOutliers.warnings.length >= 3);
  assert.ok(result.spendingOutliers.outliers.every((item) => item.region === "CALABRIA"));
});

test("MCP municipal screening fails closed outside its published year", async () => {
  await assert.rejects(
    queryPublicDataset({ dataset: "controlli_segnali", area: "spesa-comuni", year: 2025 }),
    /OpenCivitas è disponibile per il 2022/,
  );
});

test("REST and MCP expose the same municipal screening totals", async () => {
  const [restResponse, mcpResult] = await Promise.all([
    GET(new NextRequest("https://example.test/api/controlli/spesa-comuni?regione=Calabria")),
    queryPublicDataset({ dataset: "controlli_segnali", area: "spesa-comuni", region: "Calabria" }),
  ]);
  const rest = await restResponse.json();
  assert.equal(rest.ok, true);
  assert.equal(rest.totalOutliers, mcpResult.spendingOutliers.pagination.total);
  assert.equal(rest.evaluatedMunicipalities, mcpResult.spendingOutliers.evaluatedMunicipalities);
  assert.deepEqual(rest.byRegion, mcpResult.spendingOutliers.byRegion);
});
