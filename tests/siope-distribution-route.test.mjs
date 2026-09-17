import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server.js";
import "./helpers/register-ts-alias.mjs";

const { GET } = await import("../src/app/api/spese/comuni/distribuzione/route.ts");

test("SIOPE distribution API is complete, bounded, and has no municipality rows", async () => {
  for (const year of [2024, 2025, 2026]) {
    const response = GET(new NextRequest(`https://example.test/api/spese/comuni/distribuzione?anno=${year}`));
    const text = await response.text();
    const body = JSON.parse(text);

    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.dataset, "siope_comuni");
    assert.equal(body.year, year);
    assert.equal(body.available, true);
    assert.equal(body.availability, "verified_full_raw_refresh");
    assert.equal(body.distribution.schemaVersion, 2);
    assert.equal(body.distribution.period.year, year);
    assert.ok(body.distribution.coverage.municipalitiesWithValidPopulation > 7_000);
    assert.equal(body.distribution.regions.length, 20);
    assert.equal(body.distribution.populationBands.length, 8);
    assert.ok(Array.isArray(body.limitations));
    assert.equal(Object.hasOwn(body, "municipalities"), false);
    assert.ok(Buffer.byteLength(text, "utf8") < 64 * 1024, `${year} response exceeds 64 KiB`);
    for (const group of [body.distribution.perCapita, ...body.distribution.populationBands, ...body.distribution.regions]) {
      assert.equal(Object.hasOwn(group, "key"), false);
      assert.equal(Object.hasOwn(group, "name"), false);
    }
  }
});

test("SIOPE distribution API rejects malformed and unavailable years", async () => {
  const malformed = GET(new NextRequest("https://example.test/api/spese/comuni/distribuzione?anno=2026x"));
  assert.equal(malformed.status, 400);
  assert.match((await malformed.json()).error, /quattro cifre/);

  const unavailable = GET(new NextRequest("https://example.test/api/spese/comuni/distribuzione?anno=1999"));
  assert.equal(unavailable.status, 400);
  assert.match((await unavailable.json()).error, /non disponibile/);

  const duplicate = GET(new NextRequest("https://example.test/api/spese/comuni/distribuzione?anno=2026&anno=2026"));
  assert.equal(duplicate.status, 400);
  assert.match((await duplicate.json()).error, /duplicato/);

  const unknown = GET(new NextRequest("https://example.test/api/spese/comuni/distribuzione?anno=2026&regione=Lazio"));
  assert.equal(unknown.status, 400);
  assert.match((await unknown.json()).error, /non supportato/);
});
