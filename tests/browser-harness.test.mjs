import assert from "node:assert/strict";
import test from "node:test";
import { isExpectedAbortedSearchRequest } from "../scripts/browser/harness.mjs";

const BASE_ORIGIN = "http://127.0.0.1:3000";

function abortedSearch(requestUrl, overrides = {}) {
  return isExpectedAbortedSearchRequest({
    errorText: "net::ERR_ABORTED",
    resourceType: "fetch",
    requestUrl,
    baseOrigin: BASE_ORIGIN,
    ...overrides,
  });
}

test("browser diagnostics ignore intentional aborts from both search endpoints", () => {
  assert.equal(abortedSearch(`${BASE_ORIGIN}/api/enti?q=Ro&limit=7`), true);
  assert.equal(abortedSearch(`${BASE_ORIGIN}/api/search?q=Rom&limit=8`), true);
});

test("browser diagnostics keep unrelated and suspicious request failures", () => {
  assert.equal(abortedSearch(`${BASE_ORIGIN}/api/enti/c_a783`), false);
  assert.equal(abortedSearch(`${BASE_ORIGIN}/api/enti?limit=7`), false);
  assert.equal(abortedSearch("https://example.test/api/enti?q=Roma"), false);
  assert.equal(
    abortedSearch(`${BASE_ORIGIN}/api/enti?q=Roma`, { errorText: "net::ERR_FAILED" }),
    false,
  );
  assert.equal(
    abortedSearch(`${BASE_ORIGIN}/api/enti?q=Roma`, { resourceType: "document" }),
    false,
  );
});
