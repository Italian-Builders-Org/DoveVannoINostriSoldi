import assert from "node:assert/strict";
import test from "node:test";
import https from "node:https";
import { EventEmitter, getEventListeners } from "node:events";
import "./helpers/register-ts-alias.mjs";
const { fetchOfficialSource } = await import("../src/lib/data/source-fetch.ts");

// Transport-only fixtures: never open a socket or contact a source.
function fixture(t, deliver) {
  t.mock.method(https, "request", (_url, _options, callback) => {
    const req = new EventEmitter();
    req.destroyed = false;
    req.destroy = () => { req.destroyed = true; };
    req.end = () => queueMicrotask(() => {
      const incoming = new EventEmitter();
      incoming.statusCode = 200;
      incoming.headers = {};
      incoming.destroy = () => incoming.emit("close");
      callback(incoming);
      deliver(incoming, req);
    });
    return req;
  });
  const signals = [];
  const originalAdd = AbortSignal.prototype.addEventListener;
  t.mock.method(AbortSignal.prototype, "addEventListener", function (...args) {
    if (args[0] === "abort") signals.push(this);
    return originalAdd.apply(this, args);
  });
  return () => {
    assert.ok(signals.length > 0);
    for (const signal of signals) assert.equal(getEventListeners(signal, "abort").length, 0);
  };
}

const read = (options = {}) => fetchOfficialSource("ipa",
  "https://indicepa.gov.it/ipa-dati/api/3/action/datastore_search", {
    cacheMode: "no-store", maxRetries: 0, ...options,
  });

test("native response releases abort listener after successful completion", async (t) => {
  const clean = fixture(t, (incoming) => {
    incoming.emit("data", Buffer.from('{"ok":true}'));
    incoming.emit("end");
    incoming.emit("close");
  });
  assert.deepEqual(await (await read()).json(), { ok: true });
  clean();
});

test("native caller cancellation destroys the request and releases its listener", async (t) => {
  const controller = new AbortController();
  let request;
  const clean = fixture(t, (_incoming, req) => {
    request = req;
    controller.abort(new Error("caller cancelled"));
  });
  await assert.rejects(read({ signal: controller.signal }), /caller cancelled/);
  assert.equal(request.destroyed, true);
  clean();
});

test("native HEAD and bodyless statuses produce a valid empty Response", async (t) => {
  for (const [method, status] of [["HEAD", 200], ["GET", 204], ["GET", 205], ["GET", 304]]) {
    await t.test(`${method} ${status}`, async (sub) => {
      const clean = fixture(sub, (incoming) => {
        incoming.statusCode = status;
        incoming.emit("end");
      });
      const response = await read({ method });
      assert.equal(response.status, status);
      assert.equal(response.body, null);
      clean();
    });
  }
});

test("native incomplete and oversized responses reject and release listeners", async (t) => {
  for (const failure of ["close", "oversized", "invalid-status", "error"]) {
    await t.test(failure, async (sub) => {
      let request;
      const clean = fixture(sub, (incoming, req) => {
        request = req;
        if (failure === "oversized") incoming.emit("data", Buffer.alloc(16 * 1024 * 1024 + 1));
        else if (failure === "invalid-status") {
          incoming.statusCode = 0;
          incoming.emit("end");
        } else if (failure === "error") incoming.emit("error", new Error("fixture"));
        else incoming.emit("close");
      });
      await assert.rejects(read());
      assert.equal(request.destroyed, true);
      clean();
    });
  }
});
