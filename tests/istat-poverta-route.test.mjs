import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server.js";
import "./helpers/register-ts-alias.mjs";

const { GET } = await import("../src/app/api/spese/poverta-assoluta/route.ts");

const url = (query = "") => `http://localhost/api/spese/poverta-assoluta${query}`;

test("la route restituisce il territorio e l'anno richiesti", async () => {
  const response = GET(new NextRequest(url("?territorio=IT&anno=2024")));
  assert.equal(response.status, 200);
  assert.match(response.headers.get("cache-control") ?? "", /max-age=3600/);
  const payload = await response.json();
  assert.equal(payload.datasetId, "istat-poverta-assoluta");
  // Una cella per ciascuna delle sette misure assolute.
  assert.equal(payload.observations.length, 7);
  assert.ok(payload.caveats.length > 0);
  assert.equal(payload.source.licenseId, "not-declared");
});

test("la route rifiuta una richiesta senza filtri", async () => {
  const response = GET(new NextRequest(url()));
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /almeno un filtro/i);
});

test("la route rifiuta anni non canonici o fuori periodo", () => {
  for (const value of ["2024x", "24", "2.024", "", "-1"]) {
    assert.equal(GET(new NextRequest(url(`?anno=${value}`))).status, 400, value);
  }
  // La serie corrente parte dal 2014: il 2013 appartiene alle serie chiuse.
  assert.equal(GET(new NextRequest(url("?anno=2013"))).status, 400);
  assert.equal(GET(new NextRequest(url("?anno=2025"))).status, 400);
});

test("la route rifiuta un dettaglio regionale che la fonte non pubblica", async () => {
  const response = GET(new NextRequest(url("?territorio=ITC1")));
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /ripartizioni/i);
});

test("la route rifiuta una misura di povertà relativa", async () => {
  const response = GET(new NextRequest(url("?misura=INCID_POVREL_FAM")));
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /Misura non riconosciuta/i);
});

test("la route rifiuta parametri malformati prima di interrogare lo snapshot", () => {
  for (const value of ["IT;DROP", "IT%20", "toolongterritory", "1"]) {
    assert.equal(GET(new NextRequest(url(`?territorio=${value}`))).status, 400, value);
  }
  for (const value of ["a", "misura con spazi", "X".repeat(30)]) {
    assert.equal(GET(new NextRequest(url(`?misura=${value}`))).status, 400, value);
  }
});

test("il filtro per misura restituisce la serie completa di quella misura", async () => {
  const response = GET(new NextRequest(url("?misura=INCID_POVASS_FAM&territorio=IT")));
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.observations.length, 11);
  assert.ok(payload.observations.every((row) => row.measure === "INCID_POVASS_FAM"));
  // L'unità viaggia col dato: senza, il numero non è leggibile.
  assert.equal(payload.measures.length, 1);
  assert.equal(payload.measures[0].unit, "percentuale");
  assert.equal(payload.measures[0].summableAcrossTerritories, false);
});

test("la risposta porta con sé i limiti del dato", async () => {
  const payload = await GET(new NextRequest(url("?anno=2024"))).json();
  assert.match(payload.caveats.join(" "), /Non è spesa pubblica/);
  assert.equal(payload.flags.codelist, "CL_FLAG");
  assert.equal(payload.scale.factor, 10);
  assert.match(payload.source.seriesNote, /34_201/);
});
