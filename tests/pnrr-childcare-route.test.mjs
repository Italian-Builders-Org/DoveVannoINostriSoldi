import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server.js";
import "./helpers/register-ts-alias.mjs";

const { GET, MAX_PNRR_RESPONSE_BYTES } = await import("../src/app/api/pnrr/asili/route.ts");
const { pnrrChildcareData } = await import("../src/lib/pnrr-childcare-snapshot.ts");

function get(search = "") {
  return GET(new NextRequest(`https://example.test/api/pnrr/asili${search}`));
}

test("PNRR route defaults to bounded results and exposes provenance", async () => {
  const response = await get();
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.dataset, "pnrr_asili");
  assert.equal(payload.pagination.returned, 24);
  assert.equal(payload.pagination.limit, 24);
  assert.match(payload.provenance.landingUrl, /italiadomani\.gov\.it/);
  assert.match(response.headers.get("cache-control"), /s-maxage=3600/);
});

test("PNRR route distinguishes invalid filters, missing CUP, and exact CUP", async () => {
  const cup = pnrrChildcareData.projects[0].cup;
  const exact = await get(`?cup=${cup}`);
  assert.equal(exact.status, 200);
  assert.equal((await exact.json()).data[0].cup, cup);

  for (const search of [
    "?unknown=1",
    "?limit=101",
    "?q=a&q=b",
    `?q=${"x".repeat(201)}`,
    `?cup=${cup}&region=Lazio`,
  ]) {
    const response = await get(search);
    assert.equal(response.status, 400, search);
  }
  const missing = await get("?cup=A00000000000000");
  assert.equal(missing.status, 404);
  assert.equal((await missing.json()).code, "not_found");
});

test("PNRR route keeps the largest bounded response below its byte budget", async () => {
  const response = await get("?limit=100");
  const body = await response.text();
  assert.equal(response.status, 200);
  assert.ok(new TextEncoder().encode(body).byteLength <= MAX_PNRR_RESPONSE_BYTES);
});
