import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server.js";
import "./helpers/register-ts-alias.mjs";

const { GET } = await import("../src/app/api/lavoro/naspi/route.ts");

test("la route restituisce la tabella, l'anno e il territorio richiesti", async () => {
  const response = GET(new NextRequest("http://localhost/api/lavoro/naspi?tabella=beneficiari_02&anno=2022&territorio=ITF3"));
  assert.equal(response.status, 200);
  assert.match(response.headers.get("cache-control") ?? "", /max-age=3600/);
  const payload = await response.json();
  assert.equal(payload.datasetId, "inps-naspi");
  assert.equal(payload.observations.length, 2);
  assert.ok(payload.caveats.length > 0);
  assert.equal(payload.source.licenseId, "IODL-2.0");
});

test("la route accetta il filtro per misura da sola", async () => {
  const response = GET(new NextRequest("http://localhost/api/lavoro/naspi?misura=beneficiari&anno=2018"));
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.ok(payload.observations.length > 0);
  assert.ok(payload.observations.every((row) => row.measure === "beneficiari"));
});

test("la route rifiuta una richiesta senza filtri", async () => {
  const response = GET(new NextRequest("http://localhost/api/lavoro/naspi"));
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /almeno un filtro/i);
});

test("la route rifiuta anni non canonici o fuori periodo", () => {
  for (const value of ["2022x", "22", "2.022", "", "-1"]) {
    assert.equal(GET(new NextRequest(`http://localhost/api/lavoro/naspi?anno=${value}`)).status, 400, value);
  }
  assert.equal(GET(new NextRequest("http://localhost/api/lavoro/naspi?anno=2023")).status, 400);
});

test("la route rifiuta token malformati e valori sconosciuti", () => {
  assert.equal(GET(new NextRequest("http://localhost/api/lavoro/naspi?territorio=IT'--")).status, 400);
  assert.equal(GET(new NextRequest("http://localhost/api/lavoro/naspi?territorio=ZZ")).status, 400);
  assert.equal(GET(new NextRequest("http://localhost/api/lavoro/naspi?misura=spesa")).status, 400);
  assert.equal(GET(new NextRequest("http://localhost/api/lavoro/naspi?tabella=inesistente")).status, 400);
});
