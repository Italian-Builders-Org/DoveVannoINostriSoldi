import { setTimeout as delay } from "node:timers/promises";
import { APP_USER_AGENT, IPA_USER_AGENT } from "@/lib/app-version";
import { MEF_IRPEF_SOURCE } from "@/lib/data/mef-irpef-source";
import { PNRR_CHILDCARE_SOURCE } from "@/lib/data/pnrr-childcare-source";
import { getSourcePolicy, type SourceId } from "@/lib/data/source-policy";

export type SourceFetchKind = "discovery" | "data";

type NextFetchOptions = RequestInit & {
  next?: {
    revalidate?: number | false;
    tags?: string[];
  };
};

type SourceFetchOptions = Omit<NextFetchOptions, "next" | "signal" | "cache"> & {
  kind?: SourceFetchKind;
  signal?: AbortSignal;
  revalidateSeconds?: number;
  tags?: readonly string[];
  /** Cannot exceed the source policy. Use 0 to fail on the first retryable status. */
  maxRetries?: number;
  /** Cannot exceed the source policy. Floor is 1 second. */
  timeoutMs?: number;
  /**
   * `revalidate` (default) uses Next data cache tags.
   * `no-store` is for interactive UI paths: avoids associating upstream 4xx/5xx
   * (especially 429) with the document response in the App Router.
   */
  cacheMode?: "revalidate" | "no-store";
  /**
   * When true, non-OK HTTP statuses cancel the body and throw SourceFetchError
   * instead of returning the Response. Prefer this for Server Components.
   */
  rejectHttpError?: boolean;
};

const ALLOWED_HOSTS: Readonly<Record<SourceId, readonly string[]>> = {
  ipa: ["indicepa.gov.it", "www.indicepa.gov.it"],
  "ipa-struttura": ["indicepa.gov.it", "www.indicepa.gov.it"],
  openbdap: ["bdap-opendata.rgs.mef.gov.it", "openbdap.rgs.mef.gov.it"],
  anac: [
    "dati.anticorruzione.it",
    "api.anticorruzione.it",
    "www.anticorruzione.it",
    "anticorruzione.it",
  ],
  inps: ["www.inps.it", "inps.it", "serviziweb2.inps.it", "servizi2.inps.it"],
  cpt: ["politichecoesione.governo.it", "www.politichecoesione.governo.it"],
  istat: ["situas.istat.it", "situas-servizi.istat.it", "www.istat.it"],
  // Snapshot-only: the SDMX payload is acquired and pinned by ETL, never fetched at runtime.
  "istat-casellario-pensioni": [],
  "mef-irpef": MEF_IRPEF_SOURCE.allowedHosts,
  siope: [
    "www.siope.it",
    "siope.it",
    "www.bancaditalia.it",
    "bancaditalia.it",
    "bdap-opendata.rgs.mef.gov.it",
  ],
  opencoesione: ["opencoesione.gov.it", "www.opencoesione.gov.it"],
  italiadomani: PNRR_CHILDCARE_SOURCE.allowedHosts,
  opencivitas: ["opencivitas.it", "www.opencivitas.it", "docs.opencivitas.it"],
  consulenti: [
    "consulentipubblici.dfp.gov.it",
    "adp-api.perlapa.gov.it",
    "www.perlapa.gov.it",
  ],
  camera: ["trasparenza.camera.it", "documenti.camera.it", "www.camera.it", "camera.it"],
  senato: ["www.senato.it", "senato.it", "dati.senato.it"],
  pcm: ["presidenza.governo.it"],
  "partecipazioni-pubbliche": ["www.de.mef.gov.it", "de.mef.gov.it"],
  // These sources are snapshot-only at runtime; their Python ETL owns network access.
  ameco: [],
  "governi-presidenza": [],
  bancaditalia: [],
  eurostat: [],
  "eurostat-hicp": [],
};

const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);
const RETRY_DELAY_MS = 300;
const USER_AGENT = APP_USER_AGENT;

const SOURCE_USER_AGENTS: Partial<Readonly<Record<SourceId, string>>> = {
  ipa: IPA_USER_AGENT,
  "ipa-struttura": IPA_USER_AGENT,
};

export class SourceFetchError extends Error {
  readonly sourceId: SourceId;
  readonly cause?: unknown;
  readonly httpStatus?: number;

  constructor(
    message: string,
    sourceId: SourceId,
    cause?: unknown,
    httpStatus?: number,
  ) {
    super(message);
    this.name = "SourceFetchError";
    this.sourceId = sourceId;
    this.cause = cause;
    this.httpStatus = httpStatus;
  }
}

/** True when the upstream asked us to back off (do not issue a second IPA call). */
export function isUpstreamOverloadedError(error: unknown): boolean {
  if (error instanceof SourceFetchError) {
    return error.httpStatus === 429 || error.httpStatus === 503;
  }
  if (!(error instanceof Error)) return false;
  return /\bHTTP (429|503)\b/.test(error.message);
}

function assertOfficialUrl(sourceId: SourceId, rawUrl: string): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch (error) {
    throw new SourceFetchError(`URL non valido per la fonte ${sourceId}`, sourceId, error);
  }

  if (url.protocol !== "https:") {
    throw new SourceFetchError(
      `Protocollo non consentito per la fonte ${sourceId}: ${url.protocol}`,
      sourceId,
    );
  }

  const hostname = url.hostname.toLowerCase();
  if (!ALLOWED_HOSTS[sourceId].includes(hostname)) {
    throw new SourceFetchError(
      `Host non consentito per la fonte ${sourceId}: ${hostname}`,
      sourceId,
    );
  }

  return url;
}

function composedSignal(callerSignal: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  return callerSignal ? AbortSignal.any([callerSignal, timeout]) : timeout;
}

function revalidateFor(sourceId: SourceId, kind: SourceFetchKind): number {
  const policy = getSourcePolicy(sourceId);
  return kind === "discovery"
    ? policy.discoveryRevalidateSeconds
    : policy.dataRevalidateSeconds;
}

function requestHeaders(sourceId: SourceId, input: HeadersInit | undefined): Headers {
  const headers = new Headers(input);
  if (!headers.has("Accept")) {
    headers.set(
      "Accept",
      "application/json, text/csv;q=0.9, text/plain;q=0.8, */*;q=0.5",
    );
  }
  if (!headers.has("User-Agent")) {
    headers.set("User-Agent", SOURCE_USER_AGENTS[sourceId] ?? USER_AGENT);
  }
  return headers;
}

/**
 * Server-only read helper for official upstreams.
 *
 * Network and cache policy live here; schema validation stays inside each
 * adapter. Callers cannot override the Next.js cache mode directly: they may
 * only select discovery/data semantics or an explicit positive revalidation
 * interval. This avoids conflicting `cache` + `revalidate` configurations.
 */
export async function fetchOfficialSource(
  sourceId: SourceId,
  rawUrl: string,
  options: SourceFetchOptions = {},
): Promise<Response> {
  const policy = getSourcePolicy(sourceId);
  const url = assertOfficialUrl(sourceId, rawUrl);
  const kind = options.kind ?? "data";
  const retries = Math.max(
    0,
    Math.min(policy.maxRetries, options.maxRetries ?? policy.maxRetries),
  );
  const timeoutMs = Math.max(
    1_000,
    Math.min(policy.timeoutMs, options.timeoutMs ?? policy.timeoutMs),
  );
  const cacheTags = [...new Set([...policy.tags, ...(options.tags ?? [])])];
  const requestedRevalidate = options.revalidateSeconds ?? revalidateFor(sourceId, kind);
  const revalidate = Math.max(1, Math.trunc(requestedRevalidate));
  const cacheMode = options.cacheMode ?? "revalidate";
  const rejectHttpError = options.rejectHttpError === true;

  const {
    kind: _kind,
    revalidateSeconds: _revalidateSeconds,
    tags: _tags,
    maxRetries: _maxRetries,
    timeoutMs: _timeoutMs,
    cacheMode: _cacheMode,
    rejectHttpError: _rejectHttpError,
    signal: callerSignal,
    headers,
    ...requestOptions
  } = options;
  void _kind;
  void _revalidateSeconds;
  void _tags;
  void _maxRetries;
  void _timeoutMs;
  void _cacheMode;
  void _rejectHttpError;

  const method = (requestOptions.method ?? "GET").toUpperCase();
  if (method !== "GET" && method !== "HEAD") {
    throw new SourceFetchError(
      `Metodo ${method} non consentito dal fetch layer read-only`,
      sourceId,
    );
  }

  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    if (callerSignal?.aborted) throw callerSignal.reason;

    try {
      const response = await fetch(url, {
        ...requestOptions,
        method,
        headers: requestHeaders(sourceId, headers),
        redirect: requestOptions.redirect ?? "error",
        signal: composedSignal(callerSignal, timeoutMs),
        ...(cacheMode === "no-store"
          ? { cache: "no-store" as const }
          : {
              next: {
                revalidate,
                tags: cacheTags,
              },
            }),
      });

      if (!RETRYABLE_STATUS.has(response.status) || attempt === retries) {
        if (rejectHttpError && !response.ok) {
          const status = response.status;
          await response.body?.cancel().catch(() => undefined);
          throw new SourceFetchError(
            `Fonte ${sourceId} HTTP ${status}`,
            sourceId,
            undefined,
            status,
          );
        }
        return response;
      }

      await response.body?.cancel();
    } catch (error) {
      if (error instanceof SourceFetchError) throw error;
      lastError = error;
      if (callerSignal?.aborted) throw callerSignal.reason;
      if (attempt === retries) {
        throw new SourceFetchError(
          `Errore di rete verso ${sourceId} dopo ${attempt + 1} tentativo/i`,
          sourceId,
          error,
        );
      }
    }

    await delay(
      RETRY_DELAY_MS * (attempt + 1),
      undefined,
      callerSignal ? { signal: callerSignal } : undefined,
    );
  }

  throw new SourceFetchError(`Impossibile interrogare la fonte ${sourceId}`, sourceId, lastError);
}
