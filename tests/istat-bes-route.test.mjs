import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server.js";
import "./helpers/register-ts-alias.mjs";

const { GET } = await import("../src/app/api/territori/bes-economico/route.ts");

const url = (query = "") => `http://localhost/api/territori/bes-economico${query}`;

test("la route restituisce il territorio e l'anno richiesti", async () => {
  const response = GET(new NextRequest(url("?territorio=IT&anno=2023")));
  assert.equal(response.status, 200);
  assert.match(response.headers.get("cache-control") ?? "", /max-age=3600/);
  const payload = await response.json();
  assert.equal(payload.datasetId, "istat-bes-economico");
  assert.ok(payload.observations.length > 0);
  assert.ok(payload.observations.every((row) => row.territory === "IT" && row.year === 2023));
  assert.equal(payload.source.licenseId, "not-declared");
  assert.equal(payload.domain.code, "BES_04");
});

test("la route serve il livello provinciale, che è il punto della fetta", async () => {
  const payload = await GET(new NextRequest(url("?territorio=ITC11"))).json();
  assert.ok(payload.observations.length > 0);
  assert.ok(payload.observations.every((row) => row.territory === "ITC11"));
  assert.equal(payload.territories.length, 1);
  assert.equal(payload.territories[0].kind, "provincia");
});

test("la route rifiuta una richiesta senza filtri", async () => {
  const response = GET(new NextRequest(url()));
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /almeno un filtro/i);
});

test("la route rifiuta anni non canonici o fuori periodo", () => {
  for (const value of ["2023x", "23", "2.023", "", "-1"]) {
    assert.equal(GET(new NextRequest(url(`?anno=${value}`))).status, 400, value);
  }
  assert.equal(GET(new NextRequest(url("?anno=2003"))).status, 400);
  assert.equal(GET(new NextRequest(url("?anno=2025"))).status, 400);
});

test("la route rifiuta codici sconosciuti con un messaggio utile", async () => {
  const territory = GET(new NextRequest(url("?territorio=ITZZZ")));
  assert.equal(territory.status, 400);
  assert.match((await territory.json()).error, /Territorio non riconosciuto/i);
  const indicator = GET(new NextRequest(url("?indicatore=04BEC999P")));
  assert.equal(indicator.status, 400);
  assert.match((await indicator.json()).error, /Indicatore non riconosciuto/i);
});

test("la route rifiuta parametri malformati prima di interrogare lo snapshot", () => {
  for (const value of ["IT;DROP", "IT%20", "codicetroppolungo", "1"]) {
    assert.equal(GET(new NextRequest(url(`?territorio=${value}`))).status, 400, value);
  }
  for (const value of ["X", "FM", "1"]) {
    assert.equal(GET(new NextRequest(url(`?sesso=${value}`))).status, 400, value);
  }
});

test("il filtro per sesso funziona e T non è la somma di F e M", async () => {
  const payload = await GET(new NextRequest(url("?indicatore=04BEC002P&territorio=IT"))).json();
  const byYearSex = new Map(payload.observations.map((r) => [`${r.sex}/${r.year}`, r.valueTenths]));
  let checked = 0;
  for (const row of payload.observations) {
    if (row.sex !== "T") continue;
    const female = byYearSex.get(`F/${row.year}`);
    const male = byYearSex.get(`M/${row.year}`);
    if (female == null || male == null) continue;
    checked += 1;
    // Il totale sta fra i due, e non è mai la loro somma.
    assert.ok(row.valueTenths >= Math.min(female, male) && row.valueTenths <= Math.max(female, male));
    assert.notEqual(row.valueTenths, female + male);
  }
  assert.ok(checked > 0);
});

test("la risposta porta con sé i limiti del dato", async () => {
  const payload = await GET(new NextRequest(url("?anno=2023"))).json();
  assert.match(payload.caveats.join(" "), /Non è spesa pubblica/);
  assert.equal(payload.flags.codelist, "CL_FLAG");
  assert.equal(payload.scale.factor, 10);
  assert.equal(payload.reconciliation.territorialSum, false);
  // La nota sul periodo viaggia col dato: il periodo complessivo non vale per tutti.
  assert.ok(payload.periodNote.length > 0);
});
