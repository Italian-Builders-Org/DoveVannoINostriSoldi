export const IPA_RUNTIME_TIMEOUT_MS = 4_000;
export const IPA_RUNTIME_MAX_RETRIES = 0;

export type IpaRuntimeFetchOptions = Readonly<{
  signal?: AbortSignal;
}>;

/** Runtime IPA reads fail fast so an outage cannot multiply upstream calls. */
export function ipaRuntimeFetchOptions(options: IpaRuntimeFetchOptions = {}) {
  return {
    signal: options.signal,
    maxRetries: IPA_RUNTIME_MAX_RETRIES,
    timeoutMs: IPA_RUNTIME_TIMEOUT_MS,
    cacheMode: "no-store",
    rejectHttpError: true,
  } as const;
}
