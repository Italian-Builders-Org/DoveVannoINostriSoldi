import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server.js";
import "./helpers/register-ts-alias.mjs";
const { GET } = await import("../src/app/api/spese/opencivitas-2017/route.ts");
const { queryOpenCivitas2017 } = await import("../src/lib/opencivitas-2017-snapshot.ts");
const base = "http://localhost/api/spese/opencivitas-2017";

test("FC40 HTTP rejects ambiguous, unbounded and cross-year requests", () => {
  for (const query of ["", "regione=", "regione=%20", "codice=1", "regione=Sicilia", "regione=Lazio&anno=2018", "regione=Lazio&foo=1", "regione=Lazio&regione=Lazio", "regione=Lazio&limit=01", "regione=Lazio&limit=101", "regione=Lazio&offset=100001"]) {
    const response = GET(new NextRequest(`${base}?${query}`));
    assert.equal(response.status, 400, query);
    assert.equal(response.headers.get("cache-control"), "no-store");
  }
});

test("FC40 API and MCP share pagination, provenance and region aliases", async () => {
  const { queryPublicDataset } = await import("../src/lib/mcp/datasets.ts");
  const { datasetCatalog } = await import("../src/lib/mcp/catalog.ts");
  const descriptor = datasetCatalog.find((item) => item.id === "opencivitas_fabbisogni_2017");
  assert.equal(descriptor.sources[0].period, "2017");
  assert.equal(descriptor.sources[0].publishedAt, "2021-03-15");
  const { datasetQuerySchema } = await import("../src/lib/mcp/query-schema.ts");
  assert.equal(datasetQuerySchema.parse(descriptor.exampleQuery).dataset, descriptor.id);
  const response = GET(new NextRequest(`${base}?regione=Lazio&limit=2&offset=2&anno=2017`));
  assert.equal(response.status, 200);
  assert.match(response.headers.get("cache-control"), /public/);
  const body = await response.json();
  assert.deepEqual(body, queryOpenCivitas2017({ region: "Lazio", limit: 2, offset: 2 }));
  assert.deepEqual(body, await queryPublicDataset({ dataset: "opencivitas_fabbisogni_2017", year: 2017, region: "Lazio", limit: 2, offset: 2 }));
  assert.equal(body.pagination.total, 378);
  assert.equal(body.family, "FC40TOT");
  assert.equal(body.provenance.sha256.data, "266a1dd568df603039e0615cbbf6e9f9484abaeaa03b0dce0deca1ded35729d6");
  assert.equal(descriptor.sources[0].sha256, body.provenance.sha256.data);
  assert.equal(queryOpenCivitas2017({ code: "999999" }).pagination.total, 0);
  assert.equal(queryOpenCivitas2017({ region: "Emilia-Romagna" }).pagination.total, 333);
  for (const year of [2018, 2019, 2020, 2021, 2022]) {
    await assert.rejects(queryPublicDataset({ dataset: "opencivitas_fabbisogni_2017", year, code: "058091" }), /2017/);
  }
});
