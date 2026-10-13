import assert from "node:assert/strict";
import test from "node:test";
import "./helpers/register-ts-alias.mjs";

const { parseSupabaseCallbackCredentials } = await import(
  "../src/lib/boards/supabase-callback.ts"
);
const { normalizeEmail } = await import("../src/lib/boards/normalize-email.ts");

test("parseSupabaseCallbackCredentials rejects ambiguous and malformed tokens", () => {
  assert.equal(
    parseSupabaseCallbackCredentials({
      accessToken: "aaa.bbb.ccc",
      tokenHash: "also-present",
    }).kind,
    "invalid",
  );
  assert.equal(
    parseSupabaseCallbackCredentials({ accessToken: "not-a-jwt" }).kind,
    "invalid",
  );
  assert.equal(
    parseSupabaseCallbackCredentials({ tokenHash: "!!!" }).kind,
    "invalid",
  );
});

test("parseSupabaseCallbackCredentials accepts jwt access token or token hash", () => {
  const access = parseSupabaseCallbackCredentials({
    accessToken: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxIn0.sig",
  });
  assert.equal(access.kind, "access_token");

  const hash = parseSupabaseCallbackCredentials({
    tokenHash: "012345678901234567890123456789012345678901234567890",
    type: "magiclink",
  });
  assert.equal(hash.kind, "token_hash");
  if (hash.kind === "token_hash") assert.equal(hash.linkType, "magiclink");
});

test("normalizeEmail accepts common addresses without backtracking regex", () => {
  assert.equal(normalizeEmail("  User@Example.COM  "), "user@example.com");
  assert.equal(normalizeEmail("not-an-email"), null);
  assert.equal(normalizeEmail("a@nodot"), null);
});
