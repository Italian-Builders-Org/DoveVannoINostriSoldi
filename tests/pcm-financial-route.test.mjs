import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server.js";
import "./helpers/register-ts-alias.mjs";

const { GET } = await import("../src/app/api/palazzo-chigi/route.ts");

test("Palazzo Chigi API serves the verified 2024 account with provenance", async () => {
  const response = GET(new NextRequest("http://localhost/api/palazzo-chigi?anno=2024"));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.data.referenceYear, 2024);
  assert.equal(body.data.totals.paymentsTotalCents, 539_176_988_709);
  assert.equal(body.provenance.asset.sha256, "7944cb81a7e9f151b44bb5577d380cd8adf9671ddbebcc1ad530b91b90615603");
});

test("Palazzo Chigi API fails closed outside the verified year", async () => {
  const response = GET(new NextRequest("http://localhost/api/palazzo-chigi?anno=2023"));
  assert.equal(response.status, 404);
  assert.deepEqual((await response.json()).availableYears, [2024]);
});
