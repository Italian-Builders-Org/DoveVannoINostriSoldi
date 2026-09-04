import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server.js";
import "./helpers/register-ts-alias.mjs";

const { GET } = await import("../src/app/api/appalti/consip/route.ts");

test("la route Consip restituisce l'anno e il canale richiesti", async () => {
  const response = GET(new NextRequest("http://localhost/api/appalti/consip?anno=2025&canale=mepa"));
  assert.equal(response.status, 200);
  assert.match(response.headers.get("cache-control") ?? "", /max-age=3600/);
  const payload = await response.json();
  assert.equal(payload.datasetId, "consip-ordini");
  assert.equal(payload.totals.length, 1);
  assert.equal(payload.totals[0].year, 2025);
  assert.equal(payload.totals[0].channel, "mepa");
  assert.equal(payload.caveats.length > 0, true);
});

test("la route Consip senza parametri restituisce l'intero snapshot", async () => {
  const response = GET(new NextRequest("http://localhost/api/appalti/consip"));
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.totals.length, 6);
});

test("la route Consip rifiuta anni non canonici", () => {
  for (const value of ["2025x", "25", "2.025", "", "-1"]) {
    const response = GET(new NextRequest(`http://localhost/api/appalti/consip?anno=${value}`));
    assert.equal(response.status, 400, value);
  }
});

test("la route Consip rifiuta anni fuori dal periodo committato", async () => {
  const response = GET(new NextRequest("http://localhost/api/appalti/consip?anno=2023"));
  assert.equal(response.status, 400);
});

test("la route Consip rifiuta canali sconosciuti", () => {
  const response = GET(new NextRequest("http://localhost/api/appalti/consip?canale=sdapa"));
  assert.equal(response.status, 400);
});
