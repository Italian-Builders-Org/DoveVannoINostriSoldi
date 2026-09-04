import assert from "node:assert/strict";
import test from "node:test";

const { runWithRequestBudget } = await import("../src/lib/search/request-budget.ts");

test("search request budget aborts unfinished work and returns a timeout verdict", async () => {
  let observedSignal;
  let aborted = false;
  const startedAt = Date.now();

  const result = await runWithRequestBudget(
    new AbortController().signal,
    25,
    async (signal) => {
      observedSignal = signal;
      return await new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => {
          aborted = true;
          reject(signal.reason);
        }, { once: true });
      });
    },
  );

  assert.deepEqual(result, { timedOut: true });
  assert.equal(observedSignal.aborted, true);
  assert.equal(aborted, true);
  assert.ok(Date.now() - startedAt < 250);
});

test("search request budget preserves caller cancellation", async () => {
  const controller = new AbortController();
  const pending = runWithRequestBudget(controller.signal, 250, async (signal) => {
    return await new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    });
  });

  controller.abort(new DOMException("client disconnected", "AbortError"));
  await assert.rejects(pending, /client disconnected|AbortError/);
});
