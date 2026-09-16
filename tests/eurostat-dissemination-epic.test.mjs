import assert from "node:assert/strict";
import test from "node:test";
import "./helpers/register-ts-alias.mjs";

/**
 * Regression lock for epic #484 (Eurostat Dissemination API backlog).
 * All four child issues must remain published as fonte + API + MCP.
 */
const { SOURCE_POLICIES } = await import("../src/lib/data/source-policy.ts");
const { datasetCatalog } = await import("../src/lib/mcp/catalog.ts");
const { queryPublicDataset } = await import("../src/lib/mcp/datasets.ts");

const EPIC_CHILDREN = [
  {
    sourceId: "eurostat-gov-main",
    mcpId: "eurostat_conti_pa",
    query: { dataset: "eurostat_conti_pa", year: 2023 },
    evidenceKey: "items",
  },
  {
    sourceId: "eurostat-taxag",
    mcpId: "eurostat_taxag",
    query: { dataset: "eurostat_taxag", year: 2023 },
    evidenceKey: "observations",
  },
  {
    sourceId: "eurostat-cofog",
    mcpId: "eurostat_cofog",
    query: { dataset: "eurostat_cofog", year: 2023, cofog: "GF04" },
    evidenceKey: "functions",
  },
  {
    sourceId: "eurostat-sha-health",
    mcpId: "eurostat_sha_health",
    query: { dataset: "eurostat_sha_health", year: 2023 },
    evidenceKey: "observations",
  },
];

test("epic #484 keeps all four Eurostat Dissemination children in source policy", () => {
  for (const child of EPIC_CHILDREN) {
    assert.ok(SOURCE_POLICIES[child.sourceId], `manca source policy per ${child.sourceId}`);
  }
});

test("epic #484 keeps all four children in the MCP catalog and queryable", async () => {
  const ids = new Set(datasetCatalog.map((entry) => entry.id));
  for (const child of EPIC_CHILDREN) {
    assert.ok(ids.has(child.mcpId), `manca dataset MCP ${child.mcpId}`);
    const entry = datasetCatalog.find((item) => item.id === child.mcpId);
    assert.ok(
      entry.sourceIds.includes(child.sourceId),
      `${child.mcpId} non dichiara sourceId ${child.sourceId}`,
    );
    const result = await queryPublicDataset(child.query);
    assert.equal(result.dataset, child.mcpId);
    const evidence = result[child.evidenceKey];
    assert.ok(Array.isArray(evidence) && evidence.length > 0, `${child.mcpId} senza ${child.evidenceKey}`);
  }
});
