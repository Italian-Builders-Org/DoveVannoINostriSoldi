import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server.js";
import "./helpers/register-ts-alias.mjs";

const { GET } = await import("../src/app/api/spese/cofog/route.ts");

test("la route COFOG restituisce il paese e l'anno richiesti", async () => {
  const response = GET(new NextRequest("http://localhost/api/spese/cofog?paese=IT&anno=2024"));
  assert.equal(response.status, 200);
  assert.match(response.headers.get("cache-control") ?? "", /max-age=3600/);
  const payload = await response.json();
  assert.equal(payload.datasetId, "eurostat-cofog");
  assert.equal(payload.observations.length, 11);
  assert.ok(payload.observations.every((row) => row.geo === "IT" && row.year === 2024));
  assert.ok(payload.caveats.length > 0);
  assert.equal(payload.source.licenseId, "CC-BY-4.0");
});

test("la route COFOG rifiuta una richiesta senza filtri", async () => {
  const response = GET(new NextRequest("http://localhost/api/spese/cofog"));
  assert.equal(response.status, 400);
  const payload = await response.json();
  assert.match(payload.error, /almeno un filtro/i);
});

test("la route COFOG rifiuta anni non canonici o fuori periodo", async () => {
  for (const value of ["2024x", "24", "2.024", "", "-1"]) {
    assert.equal(
      GET(new NextRequest(`http://localhost/api/spese/cofog?anno=${value}`)).status,
      400,
      value,
    );
  }
  assert.equal(GET(new NextRequest("http://localhost/api/spese/cofog?anno=2025")).status, 400);
});

test("la route COFOG rifiuta codici malformati e sconosciuti", async () => {
  assert.equal(GET(new NextRequest("http://localhost/api/spese/cofog?paese=IT'--")).status, 400);
  assert.equal(GET(new NextRequest("http://localhost/api/spese/cofog?paese=ZZ")).status, 400);
  assert.equal(GET(new NextRequest("http://localhost/api/spese/cofog?funzione=GF99")).status, 400);
});
