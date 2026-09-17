import "server-only";

const MAX_CONCURRENT_DATASET_LOADS = 2;
const MAX_PENDING_DATASET_LOADS = 64;

export class IntegratedLoadOverloadedError extends Error {
  constructor() {
    super("Il caricamento dei dati integrati è temporaneamente saturo.");
    this.name = "IntegratedLoadOverloadedError";
  }
}

type QueuedDatasetLoad = {
  resolve: () => void;
  reject: (reason: unknown) => void;
  signal: AbortSignal;
  onAbort: () => void;
};

const datasetLoadQueue: QueuedDatasetLoad[] = [];
let activeDatasetLoads = 0;

function abortedError(): Error {
  const error = new Error("Caricamento dei dati integrati annullato.");
  error.name = "AbortError";
  return error;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortedError();
}

function acquireDatasetLoadSlot(signal: AbortSignal): Promise<void> {
  throwIfAborted(signal);
  if (activeDatasetLoads < MAX_CONCURRENT_DATASET_LOADS) {
    activeDatasetLoads += 1;
    return Promise.resolve();
  }
  if (datasetLoadQueue.length >= MAX_PENDING_DATASET_LOADS) {
    return Promise.reject(new IntegratedLoadOverloadedError());
  }
  return new Promise((resolve, reject) => {
    const queued = {} as QueuedDatasetLoad;
    const onAbort = () => {
      const index = datasetLoadQueue.indexOf(queued);
      if (index >= 0) datasetLoadQueue.splice(index, 1);
      reject(abortedError());
    };
    Object.assign(queued, { resolve, reject, signal, onAbort });
    signal.addEventListener("abort", onAbort, { once: true });
    datasetLoadQueue.push(queued);
  });
}

function releaseDatasetLoadSlot(): void {
  activeDatasetLoads -= 1;
  while (datasetLoadQueue.length > 0) {
    const next = datasetLoadQueue.shift()!;
    next.signal.removeEventListener("abort", next.onAbort);
    if (next.signal.aborted) {
      next.reject(abortedError());
      continue;
    }
    activeDatasetLoads += 1;
    next.resolve();
    break;
  }
}

export async function withIntegratedDatasetLoadSlot<T>(
  load: () => Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  await acquireDatasetLoadSlot(signal);
  try {
    throwIfAborted(signal);
    return await load();
  } finally {
    releaseDatasetLoadSlot();
  }
}

export function getIntegratedLoadState() {
  return {
    maxConcurrentLoads: MAX_CONCURRENT_DATASET_LOADS,
    maxPendingLoads: MAX_PENDING_DATASET_LOADS,
    activeLoads: activeDatasetLoads,
    queuedLoads: datasetLoadQueue.length,
  };
}
