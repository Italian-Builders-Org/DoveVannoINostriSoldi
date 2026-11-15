import assert from "node:assert/strict";
import test from "node:test";
import "./helpers/register-ts-alias.mjs";
const { createArchiveSession } = await import("../src/lib/data/supabase-archive-session.ts");

const config = () => ({ publishableKey: "sb_publishable_test", email: "reader@example.invalid", password: "private-password" });
const reply = (token = "token-1", expires = 3600) => ({ access_token: token, expires_in: expires, token_type: "bearer" });

test("concurrent archive reads share login and renew before expiration", async () => {
  let time = 0;
  let calls = 0;
  const session = createArchiveSession({
    config, now: () => time,
    request: async () => { calls++; await new Promise(resolve => setTimeout(resolve, 5)); return reply(`token-${calls}`); },
  });
  const first = await Promise.all(Array.from({ length: 12 }, () => session.headers()));
  assert.equal(calls, 1);
  assert.ok(first.every(value => value.Authorization === "Bearer token-1"));
  time = 3_541_000;
  const renewed = await Promise.all(Array.from({ length: 12 }, () => session.headers()));
  assert.equal(calls, 2);
  assert.ok(renewed.every(value => value.Authorization === "Bearer token-2"));
});

test("a rejected token is invalidated without evicting a newer concurrent session", async () => {
  let calls = 0;
  const session = createArchiveSession({ config, request: async () => reply(`token-${++calls}`) });
  const old = await session.headers();
  session.invalidate(old.Authorization);
  const current = await session.headers();
  session.invalidate(old.Authorization);
  assert.deepEqual(await session.headers(), current);
  assert.equal(calls, 2);
});

test("failed authentication is redacted, bounded by a cooldown and retried later", async () => {
  let time = 0;
  let calls = 0;
  const session = createArchiveSession({
    config, now: () => time,
    request: async () => { if (++calls === 1) throw new Error("private-password token-secret"); return reply(); },
  });
  await assert.rejects(session.headers(), error => !/private-password|token-secret/.test(String(error)));
  await assert.rejects(session.headers());
  assert.equal(calls, 1);
  time = 5_001;
  assert.equal((await session.headers()).Authorization, "Bearer token-1");
  assert.equal(calls, 2);
});

test("invalid configuration and incomplete auth replies fail closed", async () => {
  let calls = 0;
  const session = createArchiveSession({ config: () => ({ ...config(), password: "" }), request: async () => { calls++; return reply(); } });
  await assert.rejects(session.headers());
  assert.equal(calls, 0);
  for (const value of [{}, reply("", 3600), reply("token", 0), reply("token", "3600"), { ...reply(), token_type: "other" }]) {
    const invalid = createArchiveSession({ config, request: async () => value });
    await assert.rejects(invalid.headers());
  }
});

test("a caller abort does not cancel another reader's shared login", async () => {
  let calls = 0;
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  const session = createArchiveSession({ config, request: async () => { calls++; await pending; return reply(); } });
  const controller = new AbortController();
  const cancelled = session.headers(controller.signal);
  const active = session.headers();
  controller.abort();
  release();
  await assert.rejects(cancelled, { name: "AbortError" });
  assert.equal((await active).Authorization, "Bearer token-1");
  assert.equal(calls, 1);
});
