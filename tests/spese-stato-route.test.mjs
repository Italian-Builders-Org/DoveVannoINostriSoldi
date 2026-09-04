import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";
import { NextRequest } from "next/server.js";
import "./helpers/register-ts-alias.mjs";

// Replace only the upstream adapter; exercise the real route and period parser.
const adapterUrl = `data:text/javascript,${encodeURIComponent(`
  export const calls = [];
  export class StatePaymentPeriodUnavailableError extends Error {}
  export async function getStateSpendingSnapshot(options) {
    calls.push(options);
    return { period: { year: options.year ?? 2026, month: options.month ?? 7 } };
  }
`)}`;
const hook = registerHooks({
  resolve(specifier, context, nextResolve) {
    return specifier === "@/lib/bdap-payments"
      ? { url: adapterUrl, shortCircuit: true }
      : nextResolve(specifier, context);
  },
});
const { GET } = await import("../src/app/api/spese/stato/route.ts");
const { calls } = await import(adapterUrl);
hook.deregister();

function request(query = "") {
  return new NextRequest(`https://example.test/api/spese/stato${query}`);
}

test("state spending route ignores English parameters and forwards the Italian period", async () => {
  for (const [query, expected] of [
    ["", {}],
    ["?year=2025&month=8", {}],
    ["?anno=2025&mese=8", { year: 2025, month: 8 }],
  ]) {
    const response = await GET(request(query));
    assert.equal(response.status, 200);
    const { signal, ...period } = calls.at(-1);
    assert.deepEqual(period, expected);
    assert.ok(signal instanceof AbortSignal);
    assert.deepEqual((await response.json()).period, {
      year: expected.year ?? 2026,
      month: expected.month ?? 7,
    });
  }
});

test("state spending route rejects invalid periods before contacting the source", async () => {
  const before = calls.length;
  for (const query of ["mese=8", "anno=2025x", "anno=1999", "anno=2025&mese=0", "anno=2025&mese=13"]) {
    const response = await GET(request(`?${query}`));
    assert.equal(response.status, 400, query);
    assert.equal((await response.json()).ok, false);
  }
  assert.equal(calls.length, before);
});
