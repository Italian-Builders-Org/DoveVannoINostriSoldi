import assert from "node:assert/strict";
import test from "node:test";

const { runWithRequestBudget } = await import("../src/lib/search/request-budget.ts");

test("search request budget aborts unfinished work and returns a timeout verdict", async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  let observedSignal;
  let aborted = false;
  const pending = runWithRequestBudget(
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

  context.mock.timers.tick(24);
  assert.equal(aborted, false);
  context.mock.timers.tick(1);
  assert.deepEqual(await pending, { timedOut: true });
  assert.equal(observedSignal.aborted, true);
  assert.equal(aborted, true);
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
