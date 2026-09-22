import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server.js";
import "./helpers/register-ts-alias.mjs";

const { GET } = await import("../src/app/api/edilizia/permessi-costruire/route.ts");
const url = "http://localhost/api/edilizia/permessi-costruire";

test("permessi costruire HTTP returns national series with provenance", async () => {
  const response = GET(new NextRequest(url));
  assert.equal(response.status, 200);
  assert.match(response.headers.get("cache-control"), /max-age=3600/);
  const result = await response.json();
  assert.equal(result.datasetId, "istat-permessi-costruire-2015-2025");
  assert.equal(result.tables.a1.years.length, 11);
  assert.equal(result.soldi.present, false);
  assert.match(result.source.sha256, /^[a-f0-9]{64}$/);
  assert.equal(result.source.licenseId, "not-declared");
  assert.ok(result.caveats.length >= 6);
});

test("permessi costruire HTTP can filter one canonical year and table", async () => {
  const response = GET(new NextRequest(`${url}?anno=2025&tavola=a3`));
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(Object.keys(result.tables).length, 1);
  assert.equal(result.tables.a3.years.length, 1);
  assert.equal(result.tables.a3.years[0].year, 2025);
  assert.equal(result.tables.a3.years[0].sectors.totale.fabbricati.value, 7544);
});

test("permessi costruire HTTP rejects unknown, repeated and noncanonical filters uncached", () => {
  for (const query of [
    "anno=2014",
    "anno=2026",
    "anno=02025",
    "tavola=a5",
    "anno=2025&anno=2024",
    "foo=1",
    "year=2025",
  ]) {
    const response = GET(new NextRequest(`${url}?${query}`));
    assert.equal(response.status, 400, query);
    assert.equal(response.headers.get("cache-control"), "no-store", query);
  }
});
