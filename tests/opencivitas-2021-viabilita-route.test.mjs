import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server.js";
import "./helpers/register-ts-alias.mjs";
const { GET } = await import("../src/app/api/spese/opencivitas-2021-viabilita/route.ts");
const { queryOpenCivitas2021Viabilita } = await import("../src/lib/opencivitas-2021-viabilita-snapshot.ts");
const base = "http://localhost/api/spese/opencivitas-2021-viabilita";

test("FC70TERRVIAB HTTP rejects ambiguous, unbounded or cross-year requests without caching errors", () => {
  for (const query of ["", "regione=", "regione=%20", "codice=1", "regione=Sicilia", "regione=Lazio&anno=2022", "regione=Lazio&foo=1", "regione=Lazio&regione=Lazio", "codice=058091&codice=058091", "regione=Lazio&limit=01", "regione=Lazio&limit=101", "regione=Lazio&offset=100001", "regione=Lazio&offset=-1"]) {
    const response = GET(new NextRequest(`${base}?${query}`));
    assert.equal(response.status, 400, query);
    assert.equal(response.headers.get("cache-control"), "no-store");
  }
});

test("FC70TERRVIAB API and MCP share pagination, provenance and region alias behavior", async () => {
  const { queryPublicDataset } = await import("../src/lib/mcp/datasets.ts");
  const { datasetCatalog } = await import("../src/lib/mcp/catalog.ts");
  const descriptor = datasetCatalog.find((item) => item.id === "opencivitas_viabilita_2021");
  assert.equal(descriptor.sources[0].period, "2021");
  assert.equal(descriptor.sources[0].publishedAt, "2024-05-30");
  const { datasetQuerySchema } = await import("../src/lib/mcp/query-schema.ts");
  assert.equal(datasetQuerySchema.parse(descriptor.exampleQuery).dataset, descriptor.id);
  assert.equal((await queryPublicDataset(descriptor.exampleQuery)).referenceYear, 2021);
  const response = GET(new NextRequest(`${base}?regione=Lazio&limit=2&offset=2&anno=2021`));
  assert.equal(response.status, 200);
  assert.match(response.headers.get("cache-control"), /public/);
  const body = await response.json();
  assert.deepEqual(body, queryOpenCivitas2021Viabilita({ region: "Lazio", limit: 2, offset: 2 }));
  assert.deepEqual(body, await queryPublicDataset({ dataset: "opencivitas_viabilita_2021", year: 2021, region: "Lazio", limit: 2, offset: 2 }));
  assert.equal(body.pagination.total, 378);
  assert.equal(body.referenceYear, 2021);
  assert.equal(body.family, "FC70TERRVIAB");
  assert.equal(body.function, "TERR_VIAB");
  assert.equal(body.modifiedAt, "2024-05-30");
  assert.equal(body.provenance.sha256.data, "e56d93a219cc165b72309778116aed6c295fea9a843aae3780392dcd6f00b8ed");
  assert.equal(descriptor.sources[0].sha256, body.provenance.sha256.data);
  assert.equal(queryOpenCivitas2021Viabilita({ code: "999999" }).pagination.total, 0);
  assert.equal(queryOpenCivitas2021Viabilita({ code: "066083" }).pagination.total, 0);
});
