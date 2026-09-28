import assert from "node:assert/strict";
import test from "node:test";
import "./helpers/register-ts-alias.mjs";
import { NextRequest } from "next/server.js";

const { GET } = await import("../src/app/api/patrimonio/punti/route.ts");
const request = (query) => new NextRequest(`https://example.test/api/patrimonio/punti${query}`);

test("regional public data permits shared caching and preserves its published total", async () => {
  const response = await GET(request("?regione=12"));
  assert.equal(response.status, 200);
  assert.match(response.headers.get("cache-control"), /s-maxage=3600/);
  assert.equal(response.headers.get("set-cookie"), null);
  const data = await response.json();
  assert.equal(data.cells.buildings.reduce((sum, value) => sum + value, 0), 6909);
});

test("noncanonical regional queries are rejected without caching", async () => {
  for (const query of ["", "?regione=1", "?regione=21", "?regione=12&regione=12", "?regione=12&q=Roma"]) {
    const response = await GET(request(query));
    assert.equal(response.status, 400, query);
    assert.equal(response.headers.get("cache-control"), "no-store", query);
  }
});
