export type RequestBudgetResult<T> =
  | Readonly<{ timedOut: false; value: T }>
  | Readonly<{ timedOut: true }>;

/** Runs one request-scoped operation under a server-owned wall-clock budget. */
export async function runWithRequestBudget<T>(
  callerSignal: AbortSignal,
  timeoutMs: number,
  operation: (signal: AbortSignal) => Promise<T>,
): Promise<RequestBudgetResult<T>> {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) {
    throw new Error("Request budget must be a positive integer");
  }

  const controller = new AbortController();
  const signal = callerSignal.aborted
    ? callerSignal
    : AbortSignal.any([callerSignal, controller.signal]);
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const deadline = new Promise<RequestBudgetResult<T>>((resolve) => {
    timer = setTimeout(() => {
      timedOut = true;
      resolve({ timedOut: true });
      controller.abort(new DOMException("Search request deadline exceeded", "TimeoutError"));
    }, timeoutMs);
  });
  const work = operation(signal).then((value): RequestBudgetResult<T> => ({
    timedOut: false,
    value,
  }));

  try {
    return await Promise.race([work, deadline]);
  } finally {
    if (!timedOut && timer) clearTimeout(timer);
  }
}
