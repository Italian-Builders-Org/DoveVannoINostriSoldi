import assert from "node:assert/strict";
import test from "node:test";
import "./helpers/register-ts-alias.mjs";

const { ProcessTtlCache, readMcpProcessCached, readPersistentOrDirect } = await import(
  "../src/lib/data/cached-live-views.ts"
);

test("process TTL cache reuses settled values and refreshes only after expiry", async () => {
  const cache = new ProcessTtlCache(6);
  let calls = 0;
  const loader = async () => {
    calls += 1;
    return calls;
  };

  assert.equal(await cache.get(loader, 0), 1);
  assert.equal(await cache.get(loader, 5_999), 1);
  assert.equal(calls, 1);
  assert.equal(await cache.get(loader, 6_000), 2);
  assert.equal(calls, 2);
});

test("process TTL cache clears a rejected population so a retry can recover", async () => {
  const cache = new ProcessTtlCache(60);
  let calls = 0;

  await assert.rejects(cache.get(async () => {
    calls += 1;
    throw new Error("population failed");
  }, 0), /population failed/);

  assert.equal(await cache.get(async () => {
    calls += 1;
    return "recovered";
  }, 1), "recovered");
  assert.equal(calls, 2);
});

test("standalone fallback keeps sequential reads in the process TTL cache", async () => {
  const cache = new ProcessTtlCache(60);
  let calls = 0;
  const read = () => readPersistentOrDirect(
    async () => {
      throw new Error("Invariant: incrementalCache missing in unstable_cache fixture");
    },
    () => cache.get(async () => {
      calls += 1;
      return { value: calls };
    }),
  );

  assert.deepEqual(await read(), { value: 1 });
  assert.deepEqual(await read(), { value: 1 });
  assert.equal(calls, 1);
});

test("MCP callers share one bounded population and abort only their own wait", async () => {
  const cache = new ProcessTtlCache(60);
  const firstController = new AbortController();
  const secondController = new AbortController();
  let loaderCalls = 0;
  let resolvePopulation;
  const loader = async (populationSignal) => {
    loaderCalls += 1;
    assert.equal(populationSignal.aborted, false);
    return new Promise((resolve) => { resolvePopulation = resolve; });
  };

  const first = readMcpProcessCached(cache, firstController.signal, loader, 1_000);
  const second = readMcpProcessCached(cache, secondController.signal, loader, 1_000);
  firstController.abort(new DOMException("caller left", "AbortError"));
  await assert.rejects(first, /caller left/);

  resolvePopulation("ready");
  assert.equal(await second, "ready");
  assert.equal(await readMcpProcessCached(cache, undefined, loader, 1_000), "ready");
  assert.equal(loaderCalls, 1);
});

test("MCP population has its own deadline shorter than the route deadline", async () => {
  const cache = new ProcessTtlCache(60);
  let populationSignal;
  await assert.rejects(
    readMcpProcessCached(cache, undefined, (signal) => {
      populationSignal = signal;
      return new Promise((_resolve, reject) => {
        const pendingIo = setTimeout(() => reject(new Error("population deadline was ignored")), 2_000);
        signal.addEventListener("abort", () => {
          clearTimeout(pendingIo);
          reject(signal.reason);
        }, { once: true });
      });
    }, 5),
    /timeout|aborted/i,
  );
  assert.equal(populationSignal.aborted, true);
});
