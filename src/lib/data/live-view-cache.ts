// Cache coordination shared by live views; keep dataset imports in their owners.
export const MCP_HISTORY_POPULATION_TIMEOUT_MS = 10_000;
export const MCP_HISTORY_FAILURE_TTL_SECONDS = 60;

type ProcessCacheEntry<T> = Readonly<{ promise: Promise<T>; expiresAt: number }>;

export class ProcessTtlCache<T> {
  readonly #ttlMs: number;
  readonly #failureTtlMs: number;
  #entry: ProcessCacheEntry<T> | null = null;

  constructor(
    ttlSeconds: number,
    { failureTtlSeconds = 0 }: { failureTtlSeconds?: number } = {},
  ) {
    if (!Number.isSafeInteger(ttlSeconds) || ttlSeconds < 1) {
      throw new Error("Process cache TTL must be a positive integer");
    }
    if (!Number.isSafeInteger(failureTtlSeconds) || failureTtlSeconds < 0) {
      throw new Error("Process cache failure TTL must be a non-negative integer");
    }
    this.#ttlMs = ttlSeconds * 1_000;
    this.#failureTtlMs = failureTtlSeconds * 1_000;
  }

  get(loader: () => Promise<T>, now = Date.now()): Promise<T> {
    if (this.#entry && this.#entry.expiresAt > now) return this.#entry.promise;

    const promise = loader();
    const entry = { promise, expiresAt: now + this.#ttlMs };
    this.#entry = entry;
    void promise.catch(() => {
      if (this.#entry !== entry) return;
      this.#entry = this.#failureTtlMs > 0
        ? { promise, expiresAt: Date.now() + this.#failureTtlMs }
        : null;
    });
    return promise;
  }
}

export async function readPersistentOrDirect<T>(
  cached: () => Promise<T>,
  direct: () => Promise<T>,
): Promise<T> {
  try {
    return await cached();
  } catch (error) {
    // Direct Node consumers (source-verification tests and scripts) do not
    // install Next's request cache. They still receive the same bounded data,
    // while App Router requests retain the persistent cross-instance cache.
    if (
      error instanceof Error
      && error.message.startsWith("Invariant: incrementalCache missing in unstable_cache")
    ) {
      return direct();
    }
    throw error;
  }
}

/** Collapse concurrent misses while Next's persistent cache is populated. */
export function singleFlight<T>(
  current: Promise<T> | null,
  setCurrent: (value: Promise<T> | null) => void,
  loader: () => Promise<T>,
): Promise<T> {
  if (current) return current;
  const pending = loader();
  setCurrent(pending);
  void pending.finally(() => {
    setCurrent(null);
  }).catch(() => undefined);
  return pending;
}

export function waitForCachedValue<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  const abortReason = () => signal.reason ?? new DOMException("Request aborted", "AbortError");
  if (signal.aborted) return Promise.reject(abortReason());

  return new Promise((resolve, reject) => {
    const onAbort = () => reject(abortReason());
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

export function readMcpProcessCached<T>(
  cache: ProcessTtlCache<T>,
  callerSignal: AbortSignal | undefined,
  loader: (populationSignal: AbortSignal) => Promise<T>,
  populationTimeoutMs = MCP_HISTORY_POPULATION_TIMEOUT_MS,
): Promise<T> {
  if (!Number.isSafeInteger(populationTimeoutMs) || populationTimeoutMs < 1) {
    throw new Error("MCP history population timeout must be a positive integer");
  }
  const population = cache.get(
    () => loader(AbortSignal.timeout(populationTimeoutMs)),
  );
  return waitForCachedValue(population, callerSignal);
}
