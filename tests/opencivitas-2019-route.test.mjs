import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server.js";
import "./helpers/register-ts-alias.mjs";
const { GET } = await import("../src/app/api/spese/opencivitas-2019/route.ts");
const { queryOpenCivitas2019 } = await import("../src/lib/opencivitas-2019-snapshot.ts");
const base = "http://localhost/api/spese/opencivitas-2019";

test("FC60 HTTP rejects ambiguous, unbounded or cross-year requests without caching errors", () => {
  for (const query of ["", "regione=", "regione=%20", "codice=1", "regione=Sicilia", "regione=Lazio&anno=2020", "regione=Lazio&anno=2021", "regione=Lazio&foo=1", "regione=Lazio&regione=Lazio", "codice=058091&codice=058091", "regione=Lazio&limit=01", "regione=Lazio&limit=101", "regione=Lazio&offset=100001", "regione=Lazio&offset=-1"]) {
    const response = GET(new NextRequest(`${base}?${query}`));
    assert.equal(response.status, 400, query);
    assert.equal(response.headers.get("cache-control"), "no-store");
  }
});

test("FC60 API and MCP share pagination, provenance, missing-code and region alias behavior", async () => {
  const { queryPublicDataset } = await import("../src/lib/mcp/datasets.ts");
  const { datasetCatalog } = await import("../src/lib/mcp/catalog.ts");
  const descriptor = datasetCatalog.find((item) => item.id === "opencivitas_fabbisogni_2019");
  assert.equal(descriptor.sources[0].period, "2019");
  assert.equal(descriptor.sources[0].publishedAt, "2023-05-30");
  const response = GET(new NextRequest(`${base}?regione=Lazio&limit=2&offset=2&anno=2019`));
  assert.equal(response.status, 200);
  assert.match(response.headers.get("cache-control"), /public/);
  const body = await response.json();
  assert.deepEqual(body, queryOpenCivitas2019({ region: "Lazio", limit: 2, offset: 2 }));
  assert.deepEqual(body, await queryPublicDataset({ dataset: "opencivitas_fabbisogni_2019", year: 2019, region: "Lazio", limit: 2, offset: 2 }));
  assert.equal(body.pagination.total, 378);
  assert.equal(body.referenceYear, 2019);
  assert.equal(body.family, "FC60TOT");
  assert.equal(body.modifiedAt, "2024-05-30");
  assert.equal(body.provenance.sha256.data, "5292914fcbda4b26047020fa11bc9cdca70ff7cf93e5b4a0bd33b5153cb1a8d1");
  assert.equal(descriptor.sources[0].sha256, body.provenance.sha256.data);
  assert.equal(descriptor.sources[0].url, body.provenance.dataUrl);
  assert.deepEqual(body.data, queryOpenCivitas2019({ region: "Lazio", limit: 4 }).data.slice(2));
  assert.equal(queryOpenCivitas2019({ code: "999999" }).pagination.total, 0);
  assert.equal(queryOpenCivitas2019({ region: "Emilia-Romagna" }).pagination.total, 328);
  assert.equal(queryOpenCivitas2019({ region: "Lazio", code: "015146" }).pagination.total, 0);
  for (const year of [2020, 2021, 2022]) {
    await assert.rejects(queryPublicDataset({ dataset: "opencivitas_fabbisogni_2019", year, code: "058091" }), /2019/);
  }
});
