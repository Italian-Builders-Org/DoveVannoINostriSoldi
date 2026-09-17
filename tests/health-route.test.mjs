import assert from "node:assert/strict";
import test from "node:test";
import "./helpers/register-ts-alias.mjs";

const { GET } = await import("../src/app/api/health/route.ts");

const HEALTH_URL = "https://example.test/api/health";
const VALID_SHA = "0123456789abcdef0123456789abcdef01234567";

function response() {
  return GET(new Request(HEALTH_URL));
}

async function withEnvironment(values, callback) {
  const previous = {
    VERCEL: process.env.VERCEL,
    VERCEL_GIT_COMMIT_SHA: process.env.VERCEL_GIT_COMMIT_SHA,
  };

  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }

  try {
    return await callback();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function assertResponseHeaders(result) {
  assert.equal(result.headers.get("cache-control"), "private, no-store");
  assert.equal(result.headers.get("x-content-type-options"), "nosniff");
  assert.equal(result.headers.get("content-type"), "application/json");
}

test("health endpoint returns the exact local contract without exposing deployment data", async () => {
  await withEnvironment({ VERCEL: undefined, VERCEL_GIT_COMMIT_SHA: VALID_SHA }, async () => {
    const result = response();
    assert.equal(result.status, 200);
    assertResponseHeaders(result);
    assert.deepEqual(await result.json(), {
      ok: true,
      service: "dvns-web",
      revision: "unknown",
    });
  });
});

test("health endpoint normalizes a valid deployed commit SHA", async () => {
  await withEnvironment({ VERCEL: "1", VERCEL_GIT_COMMIT_SHA: `  ${VALID_SHA.toUpperCase()}  ` }, async () => {
    const result = response();
    assert.equal(result.status, 200);
    assertResponseHeaders(result);
    assert.deepEqual(await result.json(), {
      ok: true,
      service: "dvns-web",
      revision: VALID_SHA,
    });
  });
});

test("health endpoint fails closed on Vercel when the commit SHA is missing or invalid", async () => {
  for (const revision of [undefined, "not-a-commit", `${VALID_SHA}0`]) {
    await withEnvironment({ VERCEL: "1", VERCEL_GIT_COMMIT_SHA: revision }, async () => {
      const result = response();
      assert.equal(result.status, 503, revision ?? "missing SHA");
      assertResponseHeaders(result);
      assert.deepEqual(await result.json(), {
        ok: false,
        error: "revision_unavailable",
      });
    });
  }
});
