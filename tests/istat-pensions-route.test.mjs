import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server.js";
import "./helpers/register-ts-alias.mjs";

const { GET } = await import("../src/app/api/spese/pensioni/route.ts");

test("the pensions API returns the requested ISTAT year", async () => {
  const response = GET(new NextRequest("http://localhost/api/spese/pensioni?anno=2022"));
  assert.equal(response.status, 200);
  assert.match(response.headers.get("cache-control") ?? "", /max-age=3600/);
  const payload = await response.json();
  assert.equal(typeof payload, "object");
  assert.equal(payload === null, false);
  assert.equal(payload.inpsOsservatorio.stock.pensionCount, 21_257_999);
  assert.equal(payload.inpsOsservatorio.vintageCube.osservatorioId, "388");
});

test("the pensions API rejects non-canonical years", () => {
  for (const value of ["2022x", "22", "2.022", "", "-1"]) {
    const response = GET(new NextRequest(`http://localhost/api/spese/pensioni?anno=${value}`));
    assert.equal(response.status, 400, value);
  }
});

test("the pensions API accepts an omitted year for the latest snapshot", () => {
  const response = GET(new NextRequest("http://localhost/api/spese/pensioni"));
  assert.equal(response.status, 200);
});

test("the pensions API rejects years outside the committed ISTAT snapshot", () => {
  const response = GET(new NextRequest("http://localhost/api/spese/pensioni?anno=2024"));
  assert.equal(response.status, 400);
});
