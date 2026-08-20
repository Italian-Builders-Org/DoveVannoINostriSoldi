import { setTimeout as delay } from "node:timers/promises";
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
};

const ALLOWED_HOSTS: Readonly<Record<SourceId, readonly string[]>> = {
  ipa: ["indicepa.gov.it", "www.indicepa.gov.it"],
  "ipa-struttura": ["indicepa.gov.it", "www.indicepa.gov.it"],
  openbdap: ["bdap-opendata.rgs.mef.gov.it", "openbdap.rgs.mef.gov.it"],
  siope: [
    "www.siope.it",
    "siope.it",
    "www.bancaditalia.it",
    "bancaditalia.it",
    "bdap-opendata.rgs.mef.gov.it",
  ],
  "anac-bdncp": [
    "www.anticorruzione.it",
    "anticorruzione.it",
    "dati.anticorruzione.it",
    "api.anticorruzione.it",
  ],
  "art-4-bis": ["guida-servizi.anticorruzione.it"],
  opencoesione: ["opencoesione.gov.it", "www.opencoesione.gov.it"],
  regis: ["open.gov.it", "www.italiadomani.gov.it", "italiadomani.gov.it"],
  consulenti: ["consulentipubblici.dfp.gov.it"],
  camera: ["trasparenza.camera.it", "www.camera.it", "camera.it"],
  senato: ["www.senato.it", "senato.it"],
  "istat-s13": ["bdap-opendata.rgs.mef.gov.it", "www.istat.it", "istat.it"],
  "partecipazioni-pubbliche": ["www.de.mef.gov.it", "de.mef.gov.it"],
  "partecipazioni-stato": ["www.de.mef.gov.it", "de.mef.gov.it"],
  "anac-in-house-storico": ["www.anticorruzione.it", "anticorruzione.it"],
  "anac-ausa": ["www.anticorruzione.it", "anticorruzione.it", "dati.anticorruzione.it"],
};

const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);
const RETRY_DELAY_MS = 300;
const USER_AGENT =
  "DoveVannoINostriSoldi/0.5 (+https://github.com/Italian-Builders-Org/DoveVannoINostriSoldi)";

export class SourceFetchError extends Error {
  constructor(
    message: string,
    readonly sourceId: SourceId,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "SourceFetchError";
  }
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

function requestHeaders(input: HeadersInit | undefined): Headers {
  const headers = new Headers(input);
  if (!headers.has("Accept")) {
    headers.set(
      "Accept",
      "application/json, text/csv;q=0.9, text/plain;q=0.8, */*;q=0.5",
    );
  }
  if (!headers.has("User-Agent")) headers.set("User-Agent", USER_AGENT);
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
  const retries = Math.max(0, policy.maxRetries);
  const cacheTags = [...new Set([...policy.tags, ...(options.tags ?? [])])];
  const requestedRevalidate = options.revalidateSeconds ?? revalidateFor(sourceId, kind);
  const revalidate = Math.max(1, Math.trunc(requestedRevalidate));

  const {
    kind: _kind,
    revalidateSeconds: _revalidateSeconds,
    tags: _tags,
    signal: callerSignal,
    headers,
    ...requestOptions
  } = options;
  void _kind;
  void _revalidateSeconds;
  void _tags;

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
        headers: requestHeaders(headers),
        redirect: requestOptions.redirect ?? "error",
        signal: composedSignal(callerSignal, policy.timeoutMs),
        next: {
          revalidate,
          tags: cacheTags,
        },
      });

      if (!RETRYABLE_STATUS.has(response.status) || attempt === retries) {
        return response;
      }

      await response.body?.cancel();
    } catch (error) {
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

    await delay(RETRY_DELAY_MS * (attempt + 1));
  }

  throw new SourceFetchError(`Impossibile interrogare la fonte ${sourceId}`, sourceId, lastError);
}
