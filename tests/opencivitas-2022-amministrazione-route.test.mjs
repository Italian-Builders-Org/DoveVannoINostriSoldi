import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server.js";
import "./helpers/register-ts-alias.mjs";
const { GET } = await import("../src/app/api/spese/opencivitas-2022-amministrazione/route.ts");
const { queryOpenCivitas2022Amministrazione } = await import("../src/lib/opencivitas-2022-amministrazione-snapshot.ts");
const base = "http://localhost/api/spese/opencivitas-2022-amministrazione";

test("FC80AMMIN HTTP rejects ambiguous, unbounded or cross-year requests without caching errors", () => {
  for (const query of ["", "regione=", "regione=%20", "codice=1", "regione=Sicilia", "regione=Lazio&anno=2021", "regione=Lazio&foo=1", "regione=Lazio&regione=Lazio", "codice=058091&codice=058091", "regione=Lazio&limit=01", "regione=Lazio&limit=101", "regione=Lazio&offset=100001", "regione=Lazio&offset=-1"]) {
    const response = GET(new NextRequest(`${base}?${query}`));
    assert.equal(response.status, 400, query);
    assert.equal(response.headers.get("cache-control"), "no-store");
  }
});

test("FC80AMMIN API and MCP share pagination, provenance and region alias behavior", async () => {
  const { queryPublicDataset } = await import("../src/lib/mcp/datasets.ts");
  const { datasetCatalog } = await import("../src/lib/mcp/catalog.ts");
  const descriptor = datasetCatalog.find((item) => item.id === "opencivitas_amministrazione_2022");
  assert.equal(descriptor.sources[0].period, "2022");
  assert.equal(descriptor.sources[0].publishedAt, "2025-06-16");
  const { datasetQuerySchema } = await import("../src/lib/mcp/query-schema.ts");
  assert.equal(datasetQuerySchema.parse(descriptor.exampleQuery).dataset, descriptor.id);
  assert.equal((await queryPublicDataset(descriptor.exampleQuery)).referenceYear, 2022);
  const response = GET(new NextRequest(`${base}?regione=Lazio&limit=2&offset=2&anno=2022`));
  assert.equal(response.status, 200);
  assert.match(response.headers.get("cache-control"), /public/);
  const body = await response.json();
  assert.deepEqual(body, queryOpenCivitas2022Amministrazione({ region: "Lazio", limit: 2, offset: 2 }));
  assert.deepEqual(body, await queryPublicDataset({ dataset: "opencivitas_amministrazione_2022", year: 2022, region: "Lazio", limit: 2, offset: 2 }));
  assert.equal(body.pagination.total, 378);
  assert.equal(body.referenceYear, 2022);
  assert.equal(body.family, "FC80AMMIN");
  assert.equal(body.function, "AMMINISTRAZIONE");
  assert.ok(body.caveats.includes(body.methodology.coverageWarning));
  assert.match(body.methodology.coverageWarning, /9 Comuni/);
  assert.equal(body.modifiedAt, "2025-06-16");
  assert.equal(body.provenance.sha256.data, "5ff2ccea482e07b3949c955b52f66ffe8d779ab9356b2b4e324677b9dc24e165");
  assert.equal(descriptor.sources[0].sha256, body.provenance.sha256.data);
  assert.equal(queryOpenCivitas2022Amministrazione({ code: "999999" }).pagination.total, 0);
  assert.equal(queryOpenCivitas2022Amministrazione({ code: "078052" }).pagination.total, 0);
});
