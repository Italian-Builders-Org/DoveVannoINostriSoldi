import assert from "node:assert/strict";
import test from "node:test";
import "./helpers/register-ts-alias.mjs";
import { makeMap, makeProfiles, emptyNews, sampleNews } from "./fixtures/politici-atlas.mjs";
const { parseNews, parseProfiles, loadNews, loadProfiles, waitForRetry } = await import("../src/app/politici/atlas-data.ts");

test("profile response preserves complete typed profile and nullable values", () => {
  const profiles = makeProfiles(makeMap({ cameraCount: 4, senateCount: 1 }));
  assert.deepEqual(parseProfiles({ profiles }), profiles);
  assert.deepEqual(parseProfiles({ profiles: {} }), {});
  assert.throws(() => parseProfiles({}));
  const invalid = structuredClone(profiles); invalid["dep-0"].roles = "not an array";
  assert.throws(() => parseProfiles({ profiles: invalid }));
});

test("malformed, unsafe and incomplete news cannot become an empty success", () => {
  assert.equal(parseNews(emptyNews).articles.length, 0);
  assert.equal(parseNews(sampleNews).connections.length, 1);
  for (const value of [{ ok: true }, { ...emptyNews, articles: null }, { ...emptyNews, connections: "bad" }, { ...emptyNews, provider: {} }, { ...emptyNews, observedAt: 0 }]) assert.throws(() => parseNews(value));
  const malicious = structuredClone(sampleNews); malicious.articles[0].url = "javascript:alert(1)";
  assert.throws(() => parseNews(malicious));
});

test("profile parser rejects unsafe source and social URLs and malformed attendance", () => {
  const profiles = makeProfiles(makeMap({ cameraCount: 4, senateCount: 1 }));
  for (const mutate of [
    (p) => { p.officialPages[0].url = "data:text/html,unsafe"; },
    (p) => { p.socialLinks = { x: "javascript:alert(1)" }; },
    (p) => { p.voteAttendance.votesCast = -5; },
    (p) => { p.voteAttendance.rank = 1; p.voteAttendance.rankedAmong = 398; },
    (p) => { p.education.area = "guessed"; },
  ]) { const changed = structuredClone(profiles); mutate(changed["dep-0"]); assert.throws(() => parseProfiles({ profiles: changed })); }
});

test("news retries only explicit warming responses, within a fixed budget", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => ++calls < 3 ? Response.json({ ok: false, retry: true }, { status: 503 }) : Response.json(sampleNews));
  assert.equal((await loadNews("dep-0", new AbortController().signal, 1)).articles.length, 1);
  assert.equal(calls, 3);
});

test("news retry cannot loop forever or turn service failure into no results", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => { calls++; return Response.json({ ok: false, retry: true }, { status: 503 }); });
  await assert.rejects(loadNews("dep-0", new AbortController().signal, 1)); assert.equal(calls, 3);
});

test("ordinary HTTP failures fail once and person identifiers are URL encoded", async (t) => {
  let calls = 0, path;
  t.mock.method(globalThis, "fetch", async (url) => { calls++; path = url; return Response.json({ ok: false, retry: false }, { status: 404 }); });
  await assert.rejects(loadNews("a/b?x", new AbortController().signal, 1));
  assert.equal(calls, 1); assert.equal(path, "/api/politici/a%2Fb%3Fx/news");
});

test("abort cancels both request and pending retry without another request", async (t) => {
  const controller = new AbortController(); let calls = 0;
  t.mock.method(globalThis, "fetch", async () => { calls++; queueMicrotask(() => controller.abort()); return Response.json({ ok: false, retry: true }, { status: 503 }); });
  await assert.rejects(loadNews("dep-0", controller.signal, 500)); assert.equal(calls, 1);
  const second = new AbortController(); const pending = waitForRetry(10000, second.signal); second.abort(); await assert.rejects(pending);
});

test("profiles fetch validates the actual endpoint envelope and HTTP status", async (t) => {
  const data = makeProfiles(makeMap({ cameraCount: 2, senateCount: 1 }));
  const fetch = t.mock.method(globalThis, "fetch", async (url) => { assert.equal(url, "/api/politici/profili"); return Response.json({ profiles: data }); });
  assert.deepEqual(await loadProfiles(new AbortController().signal), data);
  fetch.mock.mockImplementation(async () => Response.json({}, { status: 500 }));
  await assert.rejects(loadProfiles(new AbortController().signal));
});
