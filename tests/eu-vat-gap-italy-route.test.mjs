import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server.js";
import "./helpers/register-ts-alias.mjs";

const { GET } = await import("../src/app/api/tributi/vat-gap/route.ts");
const url = "http://localhost/api/tributi/vat-gap";

test("VAT gap HTTP returns the Italy series with provenance", async () => {
  const response = GET(new NextRequest(url));
  assert.equal(response.status, 200);
  assert.match(response.headers.get("cache-control"), /max-age=3600/);
  const result = await response.json();
  assert.equal(result.datasetId, "eu-vat-gap-italy");
  assert.equal(result.years.length, 6);
  assert.equal(result.years.at(-1).estimateKind, "rapid-estimate");
  assert.match(result.source.sha256, /^[a-f0-9]{64}$/);
  assert.equal(result.source.licenseId, "not-declared");
  assert.ok(result.caveats.length >= 5);
});

test("VAT gap HTTP can filter one canonical year", async () => {
  const response = GET(new NextRequest(`${url}?anno=2024`));
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.years.length, 1);
  assert.equal(result.years[0].year, 2024);
  assert.equal(result.years[0].sourceYearLabel, "2024 (e)");
});

test("VAT gap HTTP rejects unknown, repeated and noncanonical filters uncached", () => {
  for (const query of [
    "anno=2018",
    "anno=2025",
    "anno=02019",
    "anno=2023x",
    "anno=2023&anno=2024",
    "foo=1",
    "year=2023",
  ]) {
    const response = GET(new NextRequest(`${url}?${query}`));
    assert.equal(response.status, 400, query);
    assert.equal(response.headers.get("cache-control"), "no-store", query);
  }
});
