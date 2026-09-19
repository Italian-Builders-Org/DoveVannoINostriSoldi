import assert from "node:assert/strict";
import test from "node:test";
import "./helpers/register-ts-alias.mjs";
const { parseLegislation, filterActs, loadLegislation, OWN_VOTE_LABELS } = await import("../src/app/politici/atlas-legislation.ts");
import { legislationFixture } from "./fixtures/politici-atlas-acts.mjs";

test("acts retain records, votes, source, date and missing data", () => {
  const payload = legislationFixture();
  assert.equal(parseLegislation(payload, "dep-1").firstSigned[0].finalVotes[0].ownVote, "F");
  for (const code of Object.keys(OWN_VOTE_LABELS)) {
    payload.firstSigned[0].finalVotes[0].ownVote = code;
    assert.equal(parseLegislation(payload, "dep-1").firstSigned[0].finalVotes[0].ownVote, code);
  }
  payload.firstSigned[0].title = null;
  payload.firstSigned[0].currentState = null;
  assert.equal(parseLegislation(payload, "dep-1").firstSigned[0].title, null);
});
test("acts fail closed on stale person, unsafe source, duplicates, wrong role and malformed votes", () => {
  for (const mutate of [p => p.personId = "dep-2", p => p.source.sourceUrl = "javascript:alert(1)", p => p.firstSigned.push(p.firstSigned[0]), p => p.firstSigned[0].role = "cofirmatario", p => p.firstSigned[0].finalVotes[0].ownVote = "__proto__", p => p.firstSigned[0].finalVotes[0].favorevoli = -1, p => p.firstSigned[0].officialPage = "data:text/html,x", p => delete p.source.caveats]) {
    const payload = legislationFixture(); mutate(payload);
    assert.throws(() => parseLegislation(payload, "dep-1"));
  }
});
test("acts empty response is distinct from error, and filters normalize accents", () => {
  const payload = legislationFixture(); const acts = payload.firstSigned;
  assert.equal(filterActs(acts, "qualita", "legge").length, 1);
  assert.equal(filterActs(acts, "aria", "unknown").length, 0);
  assert.equal(filterActs(acts, "1", "").length, 1);
  payload.firstSigned = [];
  assert.deepEqual(parseLegislation(payload, "dep-1").firstSigned, []);
});
test("acts requests are same origin, match the requested deputy and reject HTTP errors", async (t) => {
  let called;
  t.mock.method(globalThis, "fetch", async (url, options) => {
    called = { url, options };
    const personId = String(url).split("/").at(-2);
    return Response.json(legislationFixture(personId));
  });
  await loadLegislation("dep-1", new AbortController().signal);
  assert.equal(called.url, "/api/politici/dep-1/atti");
  assert.ok(called.options.signal instanceof AbortSignal);
  await loadLegislation("sen-s1", new AbortController().signal);
  assert.equal(called.url, "/api/politici/sen-s1/atti");
  await assert.rejects(loadLegislation("sen-1", new AbortController().signal));
  globalThis.fetch = async () => new Response(null, { status: 503 });
  await assert.rejects(loadLegislation("dep-1", new AbortController().signal));
});
test("cancelled acts request does not start a network operation", async (t) => {
  const fetch = t.mock.method(globalThis, "fetch", async () => { throw new Error("must not fetch"); });
  const controller = new AbortController(); controller.abort();
  await assert.rejects(loadLegislation("dep-1", controller.signal));
  assert.equal(fetch.mock.callCount(), 0);
});
