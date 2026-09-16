import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server.js";
import "./helpers/register-ts-alias.mjs";

const { GET } = await import("../src/app/api/spese/sanita/farmaci/route.ts");
const BASE = "http://localhost/api/spese/sanita/farmaci";

test("la route farmaci restituisce l'anno e la regione richiesti", async () => {
  const response = GET(new NextRequest(`${BASE}?anno=2025&regione=030`));
  assert.equal(response.status, 200);
  assert.match(response.headers.get("cache-control") ?? "", /max-age=3600/);
  const payload = await response.json();
  assert.equal(payload.datasetId, "aifa-spesa-consumi");
  assert.equal(payload.granularity, "annual-region-class-atc2");
  assert.ok(payload.observations.length > 0);
  assert.ok(payload.observations.every((row) => row.year === 2025 && row.regionCode === "030"));
  assert.equal(payload.source.licenseId, "CC-BY-4.0");
  assert.ok(payload.caveats.length > 0);
});

test("la route farmaci filtra per ATC di II livello e per classe", async () => {
  const atc = await GET(new NextRequest(`${BASE}?atc=C09`)).json();
  assert.ok(atc.observations.every((row) => row.atc2 === "C09"));
  const classe = await GET(new NextRequest(`${BASE}?anno=2024&classe=H`)).json();
  assert.ok(classe.observations.every((row) => row.class === "H"));
});

test("la route farmaci rifiuta una richiesta senza filtri", async () => {
  const response = GET(new NextRequest(BASE));
  assert.equal(response.status, 400);
  const payload = await response.json();
  assert.match(payload.error, /almeno un filtro/i);
});

test("la route farmaci rifiuta parametri sconosciuti, ripetuti o malformati", async () => {
  assert.equal(GET(new NextRequest(`${BASE}?mese=01`)).status, 400);
  assert.equal(GET(new NextRequest(`${BASE}?anno=2025&anno=2024`)).status, 400);
  for (const query of ["anno=25", "anno=2025x", "regione=30", "regione=abc", "atc=C9", "atc=C099", "classe=ZZZZZZ"]) {
    assert.equal(GET(new NextRequest(`${BASE}?${query}`)).status, 400, query);
  }
});

test("la route farmaci rifiuta anni fuori periodo e codici non pubblicati", async () => {
  assert.equal(GET(new NextRequest(`${BASE}?anno=2021`)).status, 400);
  assert.equal(GET(new NextRequest(`${BASE}?anno=2026`)).status, 400);
  assert.equal(GET(new NextRequest(`${BASE}?regione=999`)).status, 400);
  assert.equal(GET(new NextRequest(`${BASE}?atc=Z99`)).status, 400);
});
