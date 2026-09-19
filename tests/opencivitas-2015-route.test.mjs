import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server.js";
import "./helpers/register-ts-alias.mjs";
const { GET } = await import("../src/app/api/spese/opencivitas-2015/route.ts");
const { queryOpenCivitas2015 } = await import("../src/lib/opencivitas-2015-snapshot.ts");
const base = "http://localhost/api/spese/opencivitas-2015";

test("FC20 HTTP rejects ambiguous, unbounded and cross-year requests", () => {
  for (const query of ["", "regione=", "regione=%20", "codice=1", "regione=Sicilia", "regione=Lazio&anno=2017", "regione=Lazio&foo=1", "regione=Lazio&regione=Lazio", "regione=Lazio&limit=01", "regione=Lazio&limit=101", "regione=Lazio&offset=100001"]) {
    const response = GET(new NextRequest(`${base}?${query}`));
    assert.equal(response.status, 400, query);
    assert.equal(response.headers.get("cache-control"), "no-store");
  }
});

test("FC20 API and MCP share pagination, provenance and region aliases", async () => {
  const { queryPublicDataset } = await import("../src/lib/mcp/datasets.ts");
  const { datasetCatalog } = await import("../src/lib/mcp/catalog.ts");
  const descriptor = datasetCatalog.find((item) => item.id === "opencivitas_fabbisogni_2015");
  assert.equal(descriptor.sources[0].period, "2015");
  assert.equal(descriptor.sources[0].publishedAt, "2019-05-23");
  const { datasetQuerySchema } = await import("../src/lib/mcp/query-schema.ts");
  assert.equal(datasetQuerySchema.parse(descriptor.exampleQuery).dataset, descriptor.id);
  const response = GET(new NextRequest(`${base}?regione=Lazio&limit=2&offset=2&anno=2015`));
  assert.equal(response.status, 200);
  assert.match(response.headers.get("cache-control"), /public/);
  const body = await response.json();
  assert.deepEqual(body, queryOpenCivitas2015({ region: "Lazio", limit: 2, offset: 2 }));
  assert.deepEqual(body, await queryPublicDataset({ dataset: "opencivitas_fabbisogni_2015", year: 2015, region: "Lazio", limit: 2, offset: 2 }));
  assert.equal(body.pagination.total, 378);
  assert.equal(body.family, "FC20TOT");
  assert.equal(body.provenance.sha256.data, "9dffeca1c95eaaabb7387a22d9157086eff85b141aa4620f2439c7dbe355b23c");
  assert.equal(descriptor.sources[0].sha256, body.provenance.sha256.data);
  assert.match(body.caveats.join(" "), /riproporzionato sul totale nazionale/);
  assert.equal(queryOpenCivitas2015({ code: "999999" }).pagination.total, 0);
  assert.equal(queryOpenCivitas2015({ region: "Emilia-Romagna" }).pagination.total, 340);
  for (const year of [2016, 2017, 2018, 2019, 2021, 2022]) {
    await assert.rejects(queryPublicDataset({ dataset: "opencivitas_fabbisogni_2015", year, code: "058091" }), /2015/);
  }
});
