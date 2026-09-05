import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server.js";
import "./helpers/register-ts-alias.mjs";
const { GET } = await import("../src/app/api/spese/opencivitas-2021/route.ts");
const { queryOpenCivitas2021 } = await import("../src/lib/opencivitas-2021-snapshot.ts");
const base = "http://localhost/api/spese/opencivitas-2021";

test("OpenCivitas HTTP rejects ambiguous filters without caching errors", () => {
  for (const query of ["", "regione=", "regione=%20", "codice=1", "regione=Lazio&anno=2022", "regione=Lazio&foo=1", "regione=Lazio&regione=Lazio", "regione=Lazio&limit=01", "regione=Lazio&limit=101", "regione=Lazio&offset=100001"]) {
    const response = GET(new NextRequest(`${base}?${query}`));
    assert.equal(response.status, 400, query);
    assert.equal(response.headers.get("cache-control"), "no-store");
  }
});

test("OpenCivitas HTTP and shared MCP query preserve paging and provenance", async () => {
  const response = GET(new NextRequest(`${base}?regione=Lazio&limit=2&offset=2`));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body, queryOpenCivitas2021({region:"Lazio", limit:2, offset:2}));
  assert.equal(body.referenceYear, 2021);
  assert.equal(body.family, "FC70TOT");
  const first = queryOpenCivitas2021({region:"Lazio",limit:4});
  assert.deepEqual(body.data, first.data.slice(2));
  assert.equal(body.coverage.municipalities, 6565);
  assert.match(body.provenance.sha256.data, /^[a-f0-9]{64}$/);
});

test("OpenCivitas MCP dispatch preserves the 2021 contract and rejects other years", async () => {
  const { queryPublicDataset } = await import("../src/lib/mcp/datasets.ts");
  const actual = await queryPublicDataset({dataset:"opencivitas_fabbisogni_2021",year:2021,code:"058091"});
  assert.deepEqual(actual, queryOpenCivitas2021({code:"058091"}));
  await assert.rejects(queryPublicDataset({dataset:"opencivitas_fabbisogni_2021",year:2022,code:"058091"}), /2021/);
  await assert.rejects(queryPublicDataset({dataset:"opencivitas_fabbisogni_2021",region:" "}), /vuota/);
});
