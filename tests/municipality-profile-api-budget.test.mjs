import assert from "node:assert/strict";
import test from "node:test";
import { registerHooks } from "node:module";
import "./helpers/register-ts-alias.mjs";

test("a stalled municipal profile cancels its reads and returns a retryable JSON error", async ({ mock }) => {
  let entered;
  const ready = new Promise((resolve) => { entered = resolve; });
  let profileSignal;
  const fixture = "data:text/javascript,export const getMunicipalityProfile = globalThis.__testMunicipalProfile";
  globalThis.__testMunicipalProfile = async (_entity, { signal }) => {
    profileSignal = signal;
    entered();
    return new Promise((_, reject) => {
      signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
    });
  };
  const hooks = registerHooks({
    resolve(specifier, context, next) {
      if (specifier === "@/lib/municipality-profile") return { url: fixture, shortCircuit: true };
      return next(specifier, context);
    },
  });
  try {
    const { GET } = await import("../src/app/api/enti/[codice]/route.ts");
    mock.timers.enable({ apis: ["setTimeout"] });
    const request = new Request("http://localhost/api/enti/c_a100");
    const pending = GET(request, { params: Promise.resolve({ codice: "c_a100" }) });
    await ready;
    assert.ok(profileSignal instanceof AbortSignal, "The profile must be under a cancellable request budget");
    mock.timers.tick(8_000);
    const response = await pending;
    assert.equal(response.status, 503);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.equal(response.headers.get("retry-after"), "10");
    assert.equal((await response.json()).ok, false);
    assert.equal(profileSignal.aborted, true);
  } finally {
    hooks.deregister();
    delete globalThis.__testMunicipalProfile;
  }
});
