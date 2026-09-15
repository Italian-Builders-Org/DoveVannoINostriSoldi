import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server.js";
import "./helpers/register-ts-alias.mjs";

const { GET } = await import("../src/app/api/finanza-pubblica/conti-pa/route.ts");

const BASE = "http://localhost/api/finanza-pubblica/conti-pa";

test("la route dei conti PA restituisce l'anno richiesto con le 24 voci", async () => {
  const response = GET(new NextRequest(`${BASE}?anno=2025`));
  assert.equal(response.status, 200);
  assert.match(response.headers.get("cache-control") ?? "", /max-age=3600/);
  const payload = await response.json();
  assert.equal(payload.datasetId, "eurostat-gov-main");
  assert.equal(payload.observations.length, 24);
  assert.ok(payload.observations.every((row) => row.year === 2025));
  assert.ok(payload.caveats.length > 0);
  assert.equal(payload.source.licenseId, "CC-BY-4.0");
});

test("la route dei conti PA filtra per voce", async () => {
  const response = GET(new NextRequest(`${BASE}?voce=B9`));
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.observations.length, 31);
  assert.ok(payload.observations.every((row) => row.naItem === "B9"));
});

test("la route dei conti PA rifiuta una richiesta senza filtri", async () => {
  const response = GET(new NextRequest(BASE));
  assert.equal(response.status, 400);
  const payload = await response.json();
  assert.match(payload.error, /almeno un filtro/i);
});

test("la route dei conti PA rifiuta anni non canonici o fuori periodo", async () => {
  for (const value of ["2025x", "25", "2.025", "", "-1"]) {
    assert.equal(GET(new NextRequest(`${BASE}?anno=${value}`)).status, 400, value);
  }
  assert.equal(GET(new NextRequest(`${BASE}?anno=1994`)).status, 400);
  assert.equal(GET(new NextRequest(`${BASE}?anno=2026`)).status, 400);
});

test("la route dei conti PA rifiuta voci malformate e non pubblicate", async () => {
  assert.equal(GET(new NextRequest(`${BASE}?voce=TR'--`)).status, 400);
  assert.equal(GET(new NextRequest(`${BASE}?voce=D8PAY`)).status, 400);
  assert.equal(GET(new NextRequest(`${BASE}?voce=D211REC`)).status, 400);
});
