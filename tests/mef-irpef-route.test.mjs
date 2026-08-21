import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server.js";
import "./helpers/register-ts-alias.mjs";

const { GET } = await import("../src/app/api/territori/irpef/route.ts");

function get(search = "") {
  return GET(new NextRequest(`https://example.test/api/territori/irpef${search}`));
}

test("MEF IRPEF route defaults to the bounded regional overview", async () => {
  const response = get();
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.level, "region");
  assert.equal(payload.pagination.returned, 20);
  assert.ok(payload.data.every((row) => row.territory.level === "region"));
  assert.equal(
    response.headers.get("cache-control"),
    "public, max-age=3600, stale-while-revalidate=86400",
  );
});

test("MEF IRPEF route maps Italian filters and keeps suppression explicit", async () => {
  const response = get("?anno=2024&livello=comune&codice=001019");
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.data[0].territory.name, "BALME");
  assert.equal(payload.data[0].measures.municipalSurtaxDue.coverage, "partial");
  assert.equal(payload.data[0].measures.municipalSurtaxDue.suppressedRows, 1);
});

test("MEF IRPEF route distinguishes invalid requests from missing territories", async () => {
  for (const search of [
    "?anno=2024foo",
    "?anno=2023",
    "?livello=comune",
    "?livello=comune&q=Roma&limite=101",
    "?sconosciuto=1",
    "?q=Roma&q=Milano",
  ]) {
    const response = get(search);
    assert.equal(response.status, 400, search);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
  }
  const missing = get("?livello=comune&codice=999999");
  assert.equal(missing.status, 404);
  assert.equal(missing.headers.get("cache-control"), "private, no-store");
});
