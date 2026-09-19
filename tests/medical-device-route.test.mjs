import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server.js";
import "./helpers/register-ts-alias.mjs";

const { GET } = await import("../src/app/api/spese/sanita/dispositivi/route.ts");
const base = "http://localhost/api/spese/sanita/dispositivi";

test("l’API cerca un dispositivo e conserva la chiave composta", async () => {
  const response = await GET(new NextRequest(`${base}?vista=ricerca&q=1175175&tipo=1&anno=2021`));
  assert.equal(response.status, 200);
  assert.match(response.headers.get("cache-control"), /max-age=3600/);
  const payload = await response.json();
  assert.equal(payload.hits[0].type, "1");
  assert.equal(payload.hits[0].number, "1175175");
  assert.equal(payload.hits[0].years["2021"].rows > 0, true);
});

test("l’API espone aggregati riconciliati e righe limitate", async () => {
  const aggregateResponse = await GET(new NextRequest(`${base}?vista=aggregati&anno=2020&dimensione=territory&limit=2`));
  assert.equal(aggregateResponse.status, 200);
  const aggregate = await aggregateResponse.json();
  assert.equal(aggregate.rows.length, 2);
  assert.equal(aggregate.coverage.matchedRows + aggregate.coverage.unresolvedRows, aggregate.coverage.rows);
  const first = aggregate.rows[0];
  const rowsResponse = await GET(new NextRequest(`${base}?vista=righe&anno=2020&dimensione=territory&valore=${encodeURIComponent(first.code)}&limit=2`));
  assert.equal(rowsResponse.status, 200);
  const rows = await rowsResponse.json();
  assert.equal(rows.rows.length <= 2, true);
  assert.equal(rows.rows.every((row) => row.year === 2020), true);
});

test("l’API restituisce scheda e fatti dello stesso dispositivo", async () => {
  const response = await GET(new NextRequest(`${base}?vista=dispositivo&tipo=1&numero=1175175&anno=2021&limit=3`));
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.profile.device.number, "1175175");
  assert.equal(payload.facts.rows.length <= 3, true);
  assert.equal(payload.facts.rows.every((row) => row.year === 2021), true);
});

test("l’API rifiuta parametri sconosciuti, ripetuti e dispositivi assenti", async () => {
  for (const query of ["foo=1", "vista=filtri&q=ignorato", "vista=ricerca&q=1175175&q=2", "vista=ricerca&q=1175175&tipo=3"]) {
    const response = await GET(new NextRequest(`${base}?${query}`));
    assert.equal(response.status, 400, query);
    assert.equal(response.headers.get("cache-control"), "no-store", query);
  }
  const missing = await GET(new NextRequest(`${base}?vista=dispositivo&tipo=1&numero=999999999999999999`));
  assert.equal(missing.status, 404);
});
