import assert from "node:assert/strict";
import test from "node:test";
import "./helpers/register-ts-alias.mjs";
const { LocalVoiceSession } = await import("../src/lib/assistant/local-voice.ts");

function setup(t, options = {}) {
  const updates = [];
  const instances = [];
  class Recognition {
    static available = options.available ?? (async () => "available");
    static install = options.install ?? (async () => true);
    processLocally = false;
    starts = 0;
    stops = 0;
    aborts = 0;
    constructor() { instances.push(this); }
    start() { this.starts++; }
    stop() { this.stops++; }
    abort() { this.aborts++; }
    result(text) { this.onresult?.({ results: [{ isFinal: true, 0: { transcript: text } }] }); }
  }
  const session = new LocalVoiceSession(Recognition, (value) => updates.push(value));
  t.after(() => session.close());
  return { session, Recognition, instances, updates, latest: () => updates.at(-1) };
}

test("local availability and installation never start recording", async (t) => {
  const calls = [];
  const s = setup(t, {
    available: async (options) => { calls.push(options); return "downloadable"; },
    install: async (options) => { calls.push(options); return true; },
  });
  await s.session.check();
  assert.equal(s.latest().status, "downloadable");
  await s.session.install();
  assert.equal(s.latest().status, "ready");
  assert.equal(s.instances.length, 0);
  assert.deepEqual(calls, Array(2).fill({ langs: ["it-IT"], processLocally: true }));
});

test("start is explicit, local, single-utterance and cannot overlap", async (t) => {
  const s = setup(t);
  s.session.start();
  assert.equal(s.instances.length, 0);
  await s.session.check();
  s.session.start(); s.session.start();
  const recognition = s.instances[0];
  assert.equal(s.instances.length, 1);
  assert.equal(recognition.starts, 1);
  assert.equal(recognition.processLocally, true);
  assert.equal(recognition.lang, "it-IT");
  assert.equal(recognition.continuous, false);
  assert.equal(recognition.interimResults, false);
  recognition.onstart();
  assert.equal(s.latest().status, "listening");
  recognition.result("Quanto hanno speso i Comuni nel 2025?");
  s.session.stop();
  assert.equal(recognition.stops, 1);
  recognition.onend();
  assert.equal(s.latest().status, "review");
  assert.equal(s.latest().transcript, "Quanto hanno speso i Comuni nel 2025?");
  assert.equal(recognition.aborts, 1);
});

test("browser with available but without processLocally cannot record", async (t) => {
  const s = setup(t);
  class Legacy extends s.Recognition { constructor() { super(); delete this.processLocally; } }
  const updates = [];
  const session = new LocalVoiceSession(Legacy, (value) => updates.push(value));
  t.after(() => session.close());
  await session.check(); session.start();
  assert.equal(updates.at(-1).status, "unsupported");
  assert.equal(s.instances[0].starts, 0);
});

test("unsupported API and unknown availability fail closed", async (t) => {
  const updates = [];
  await new LocalVoiceSession(undefined, (value) => updates.push(value)).check();
  assert.equal(updates[0].status, "unsupported");
  const s = setup(t, { available: async () => "new-unknown-value" });
  await s.session.check(); s.session.start();
  assert.equal(s.latest().status, "unsupported");
  assert.equal(s.instances.length, 0);
});

test("microphone denial and no speech stop recognition without exposing browser details", async (t) => {
  for (const error of ["not-allowed", "no-speech", "audio-capture", "private detail from browser"]) {
    const s = setup(t);
    await s.session.check(); s.session.start();
    s.instances[0].onerror({ error });
    assert.equal(s.latest().status, "error");
    assert.doesNotMatch(s.latest().message, /private detail/);
    assert.equal(s.instances[0].aborts, 1);
  }
});

test("close aborts, drops the draft and ignores queued callbacks", async (t) => {
  const s = setup(t);
  await s.session.check(); s.session.start();
  const recognition = s.instances[0];
  const queuedResult = recognition.onresult;
  recognition.result("bozza privata");
  s.session.close();
  const count = s.updates.length;
  queuedResult({ results: [{ isFinal: true, 0: { transcript: "risultato tardivo" } }] });
  s.session.start();
  assert.equal(s.updates.length, count);
  assert.equal(recognition.aborts, 1);
  assert.equal(recognition.onresult, null);
});

test("late availability and pack completion cannot reopen a closed session", async (t) => {
  let resolve;
  const s = setup(t, { available: () => new Promise((done) => { resolve = done; }) });
  const pending = s.session.check();
  s.session.close(); resolve("available"); await pending;
  assert.equal(s.updates.length, 0);
  const p = setup(t, { available: async () => "downloadable", install: () => new Promise((done) => { resolve = done; }) });
  await p.session.check();
  const installation = p.session.install(); p.session.close();
  const count = p.updates.length;
  resolve(true); await installation;
  assert.equal(p.updates.length, count);
  assert.equal(p.instances.length, 0);
});

test("30-second hard deadline aborts even if the browser never emits end", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const s = setup(t);
  await s.session.check(); s.session.start();
  s.instances[0].result("testo da controllare");
  t.mock.timers.tick(30_000);
  assert.equal(s.instances[0].aborts, 1);
  assert.equal(s.latest().status, "review");
  assert.match(s.latest().message, /Tempo/);
});

test("stop has a bounded finalization window and ignores later transcripts", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const s = setup(t);
  await s.session.check(); s.session.start();
  const recognition = s.instances[0];
  const queuedResult = recognition.onresult;
  s.session.stop();
  recognition.result("testo finale");
  t.mock.timers.tick(3_000);
  assert.equal(s.latest().status, "review");
  queuedResult({ results: [{ isFinal: true, 0: { transcript: "sostituzione tardiva" } }] });
  assert.equal(s.latest().transcript, "testo finale");
});

test("stopping just before the deadline cannot extend recording past 30 seconds", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const s = setup(t);
  await s.session.check(); s.session.start();
  t.mock.timers.tick(29_000);
  s.session.stop();
  t.mock.timers.tick(1_000);
  assert.equal(s.instances[0].aborts, 1);
  assert.equal(s.latest().status, "error");
});

test("availability timeout stays failed after a late success", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let resolve;
  const s = setup(t, { available: () => new Promise((done) => { resolve = done; }) });
  const pending = s.session.check();
  t.mock.timers.tick(10_000);
  assert.equal(s.latest().status, "error");
  resolve("available"); await pending;
  assert.equal(s.latest().status, "error");
});

test("long transcripts remain intact for review instead of silently truncating", async (t) => {
  const s = setup(t);
  await s.session.check(); s.session.start();
  s.instances[0].result("a".repeat(100_000));
  s.instances[0].onend();
  assert.equal(s.latest().transcript.length, 100_000);
});

test("failed and timed-out pack installation never enables recording", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  for (const install of [async () => false, async () => { throw new Error("private browser detail"); }]) {
    const s = setup(t, { available: async () => "downloadable", install });
    await s.session.check(); await s.session.install(); s.session.start();
    assert.equal(s.latest().status, "error");
    assert.equal(s.instances.length, 0);
    assert.doesNotMatch(s.latest().message, /private browser detail/);
  }
  let resolve;
  const s = setup(t, { available: async () => "downloadable", install: () => new Promise((done) => { resolve = done; }) });
  await s.session.check();
  const pending = s.session.install();
  t.mock.timers.tick(120_000);
  assert.equal(s.latest().status, "error");
  resolve(true); await pending; s.session.start();
  assert.equal(s.latest().status, "error");
  assert.equal(s.instances.length, 0);
});
