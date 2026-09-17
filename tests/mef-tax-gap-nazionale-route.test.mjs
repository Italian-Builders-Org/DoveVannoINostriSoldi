import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server.js";
import "./helpers/register-ts-alias.mjs";

const { GET } = await import("../src/app/api/tributi/tax-gap/route.ts");
const url = "http://localhost/api/tributi/tax-gap";

test("MEF tax gap HTTP returns the national series with provenance", async () => {
  const response = GET(new NextRequest(url));
  assert.equal(response.status, 200);
  assert.match(response.headers.get("cache-control"), /max-age=3600/);
  const result = await response.json();
  assert.equal(result.datasetId, "mef-tax-gap-nazionale");
  assert.equal(result.taxRows.length, 16);
  assert.equal(result.period.to, 2022);
  assert.match(result.source.sha256, /^[a-f0-9]{64}$/);
  assert.equal(result.source.licenseId, "not-declared");
  assert.ok(result.caveats.length >= 5);
});

test("MEF tax gap HTTP can filter one canonical year and tax row", async () => {
  const response = GET(new NextRequest(`${url}?anno=2022&imposta=iva`));
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.taxRows.length, 1);
  assert.equal(result.taxRows[0].id, "iva");
  assert.equal(result.taxRows[0].series.length, 1);
  assert.equal(result.taxRows[0].series[0].year, 2022);
});

test("MEF tax gap HTTP rejects unknown, repeated and noncanonical filters uncached", () => {
  for (const query of [
    "anno=2017",
    "anno=2023",
    "anno=02022",
    "anno=2022x",
    "anno=2022&anno=2021",
    "foo=1",
    "year=2022",
    "imposta=vat",
  ]) {
    const response = GET(new NextRequest(`${url}?${query}`));
    assert.equal(response.status, 400, query);
    assert.equal(response.headers.get("cache-control"), "no-store", query);
  }
});
