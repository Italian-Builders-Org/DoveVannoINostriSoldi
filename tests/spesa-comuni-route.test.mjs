import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server.js";
import "./helpers/register-ts-alias.mjs";

const { GET } = await import("../src/app/api/controlli/spesa-comuni/route.ts");

test("spesa-comuni returns complete pagination and provenance", async () => {
  const response = GET(new NextRequest("https://example.test/api/controlli/spesa-comuni?anno=2022&limit=2&offset=1"));
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.ok, true);
  assert.equal(payload.period.referenceYear, 2022);
  assert.equal(payload.period.publishedAt, "2025-08-07");
  assert.equal(payload.period.observedAt, payload.provenance.source.observedAt);
  assert.equal(payload.provenance.generatedAt, payload.provenance.source.observedAt);
  assert.equal(payload.filters.offset, 1);
  assert.equal(payload.pagination.limit, 2);
  assert.equal(payload.pagination.returned, payload.outliers.length);
  assert.equal(payload.pagination.total, payload.totalOutliers);
  assert.ok(typeof payload.pagination.hasMore === "boolean");
  assert.ok(Array.isArray(payload.warnings) && payload.warnings.length >= 3);
  assert.ok(payload.outliers.every((item) => "impliedPopulation" in item));
  assert.ok(Buffer.byteLength(JSON.stringify(payload), "utf8") < 128_000);
});

test("spesa-comuni scopes the complete summary and page to a region", async () => {
  const response = GET(new NextRequest("https://example.test/api/controlli/spesa-comuni?regione=calabria&limit=3"));
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.filters.region, "CALABRIA");
  assert.equal(payload.byRegion.length, 1);
  assert.equal(payload.byRegion[0].region, "CALABRIA");
  assert.ok(payload.outliers.every((item) => item.region === "CALABRIA"));
  assert.equal(payload.evaluatedMunicipalities, payload.byRegion[0].evaluated);
  assert.equal(payload.notEvaluatedForSmallCohort, payload.byRegion[0].notEvaluatedForSmallCohort);
});

test("spesa-comuni rejects unsupported years, malformed pagination and duplicate filters", async () => {
  const urls = [
    "https://example.test/api/controlli/spesa-comuni?anno=2021",
    "https://example.test/api/controlli/spesa-comuni?limit=0",
    "https://example.test/api/controlli/spesa-comuni?limit=101",
    "https://example.test/api/controlli/spesa-comuni?offset=-1",
    "https://example.test/api/controlli/spesa-comuni?anno=2022&anno=2022",
    "https://example.test/api/controlli/spesa-comuni?ignora=1",
  ];
  for (const url of urls) {
    const response = GET(new NextRequest(url));
    const payload = await response.json();
    assert.equal(response.status, 400, url);
    assert.equal(payload.ok, false, url);
    assert.equal(payload.error, "invalid_query", url);
  }
});
