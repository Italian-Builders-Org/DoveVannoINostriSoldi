import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server.js";
import "./helpers/register-ts-alias.mjs";

const { GET } = await import("../src/app/api/territori/fisco/route.ts");

test("regional fiscal route returns the default 2023 dataset", async () => {
  const response = GET(new NextRequest("https://example.test/api/territori/fisco"));
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.year, 2023);
  assert.equal(payload.rows.length, 21);
  assert.match(response.headers.get("cache-control"), /stale-while-revalidate/);
});

test("regional fiscal route validates year strictly and filters territory", async () => {
  const malformed = GET(new NextRequest("https://example.test/api/territori/fisco?anno=2023foo"));
  assert.equal(malformed.status, 400);
  const response = GET(new NextRequest("https://example.test/api/territori/fisco?anno=2023&regione=Calabria"));
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.deepEqual(payload.rows.map((row) => row.region), ["Calabria"]);
});
