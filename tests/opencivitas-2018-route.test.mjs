import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server.js";
import "./helpers/register-ts-alias.mjs";
const { GET } = await import("../src/app/api/spese/opencivitas-2018/route.ts");
const { queryOpenCivitas2018 } = await import("../src/lib/opencivitas-2018-snapshot.ts");
const base = "http://localhost/api/spese/opencivitas-2018";

test("FC50 HTTP rejects ambiguous, unbounded or cross-year requests without caching errors", () => {
  for (const query of ["", "regione=", "regione=%20", "codice=1", "regione=Sicilia", "regione=Lazio&anno=2020", "regione=Lazio&anno=2021", "regione=Lazio&foo=1", "regione=Lazio&regione=Lazio", "codice=058091&codice=058091", "regione=Lazio&limit=01", "regione=Lazio&limit=101", "regione=Lazio&offset=100001", "regione=Lazio&offset=-1"]) {
    const response = GET(new NextRequest(`${base}?${query}`));
    assert.equal(response.status, 400, query);
    assert.equal(response.headers.get("cache-control"), "no-store");
  }
});

test("FC50 API and MCP share pagination, provenance, missing-code and region alias behavior", async () => {
  const { queryPublicDataset } = await import("../src/lib/mcp/datasets.ts");
  const { datasetCatalog } = await import("../src/lib/mcp/catalog.ts");
  const descriptor = datasetCatalog.find((item) => item.id === "opencivitas_fabbisogni_2018");
  assert.equal(descriptor.sources[0].period, "2018");
  assert.equal(descriptor.sources[0].publishedAt, "2022-02-14");
  const { datasetQuerySchema } = await import("../src/lib/mcp/query-schema.ts");
  assert.equal(datasetQuerySchema.parse(descriptor.exampleQuery).dataset, descriptor.id);
  assert.equal((await queryPublicDataset(descriptor.exampleQuery)).referenceYear, 2018);
  const response = GET(new NextRequest(`${base}?regione=Lazio&limit=2&offset=2&anno=2018`));
  assert.equal(response.status, 200);
  assert.match(response.headers.get("cache-control"), /public/);
  const body = await response.json();
  assert.deepEqual(body, queryOpenCivitas2018({ region: "Lazio", limit: 2, offset: 2 }));
  assert.deepEqual(body, await queryPublicDataset({ dataset: "opencivitas_fabbisogni_2018", year: 2018, region: "Lazio", limit: 2, offset: 2 }));
  assert.equal(body.pagination.total, 378);
  assert.equal(body.referenceYear, 2018);
  assert.equal(body.family, "FC50TOT");
  assert.equal(body.modifiedAt, "2022-02-14");
  assert.equal(body.provenance.sha256.data, "78107746fe7edac1791ac61d3d6b09ba5bd4d65f80db896c1c6c450e5bca55c0");
  assert.equal(descriptor.sources[0].sha256, body.provenance.sha256.data);
  assert.equal(descriptor.sources[0].url, body.provenance.dataUrl);
  assert.deepEqual(body.data, queryOpenCivitas2018({ region: "Lazio", limit: 4 }).data.slice(2));
  assert.equal(queryOpenCivitas2018({ code: "999999" }).pagination.total, 0);
  assert.equal(queryOpenCivitas2018({ region: "Emilia-Romagna" }).pagination.total, 331);
  assert.equal(queryOpenCivitas2018({ region: "Lazio", code: "015146" }).pagination.total, 0);
  for (const year of [2019, 2020, 2021, 2022]) {
    await assert.rejects(queryPublicDataset({ dataset: "opencivitas_fabbisogni_2018", year, code: "058091" }), /2018/);
  }
});
