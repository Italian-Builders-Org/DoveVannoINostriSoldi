/**
 * Shared guards for public JSON POST endpoints exposed to the browser.
 *
 * Every check is fail-closed: a request without a same-site Origin, with a
 * foreign Host, with a body larger than the declared budget or with a
 * non-JSON content type is rejected before any business logic runs.
 */

export const NO_STORE_HEADERS = Object.freeze({
  "cache-control": "private, no-store",
  "x-content-type-options": "nosniff",
});

export function jsonResponse(body: unknown, status = 200, headers?: HeadersInit): Response {
  return Response.json(body, { status, headers: { ...NO_STORE_HEADERS, ...headers } });
}

export function normalizedHost(value: string): string | null {
  const candidate = value.trim().toLocaleLowerCase("en-US").replace(/\.$/u, "");
  if (!candidate || /[\s/@]/u.test(candidate)) return null;
  return candidate;
}

export function isLoopbackHost(value: string): boolean {
  return /^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d{1,5})?$/u.test(value);
}

export function allowedHosts(request: Request): Set<string> {
  const requestUrlHost = normalizedHost(new URL(request.url).host);
  const configured = [process.env.VERCEL_PROJECT_PRODUCTION_URL, process.env.VERCEL_URL]
    .filter((value): value is string => Boolean(value?.trim()))
    .map((value) => value.replace(/^https?:\/\//iu, ""))
    .map(normalizedHost)
    .filter((value): value is string => value !== null);
  const allowed = new Set(configured);
  if (requestUrlHost) allowed.add(requestUrlHost);

  const requestHost = normalizedHost(request.headers.get("host") ?? "");
  if (requestHost && requestUrlHost && isLoopbackHost(requestHost) && isLoopbackHost(requestUrlHost)) {
    allowed.add(requestHost);
  }
  return allowed;
}

export type PublicPostGuardOptions = Readonly<{
  maxRequestBytes: number;
}>;

/**
 * Returns a rejection response, or `null` when the request may proceed.
 */
export function rejectPublicPost(request: Request, { maxRequestBytes }: PublicPostGuardOptions): Response | null {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim();
  if (contentType !== "application/json") {
    return jsonResponse({ ok: false, error: "Content-Type non supportato" }, 415);
  }

  const requestHost = normalizedHost(request.headers.get("host") ?? "");
  if (!requestHost || !allowedHosts(request).has(requestHost)) {
    return jsonResponse({ ok: false, error: "Host non consentito" }, 403);
  }

  const origin = request.headers.get("origin");
  let originUrl: URL;
  try {
    originUrl = new URL(origin ?? "");
  } catch {
    return jsonResponse({ ok: false, error: "Origin non consentita" }, 403);
  }
  const originHost = normalizedHost(originUrl.host);
  const allowedProtocol = originUrl.protocol === "https:" ||
    (originUrl.protocol === "http:" && isLoopbackHost(requestHost));
  if (originHost !== requestHost || !allowedProtocol) {
    return jsonResponse({ ok: false, error: "Origin non consentita" }, 403);
  }

  const declaredLength = request.headers.get("content-length");
  if (declaredLength !== null) {
    if (!/^\d+$/u.test(declaredLength)) {
      return jsonResponse({ ok: false, error: "Content-Length non valido" }, 400);
    }
    if (Number(declaredLength) > maxRequestBytes) {
      return jsonResponse({ ok: false, error: "Richiesta troppo grande" }, 413);
    }
  }

  return null;
}

/**
 * Reads the body up to `maxRequestBytes`, returning the decoded UTF-8 string
 * or a ready rejection response.
 */
export async function readBoundedBody(
  request: Request,
  { maxRequestBytes }: PublicPostGuardOptions,
): Promise<string | Response> {
  if (!request.body) return jsonResponse({ ok: false, error: "Corpo richiesta assente" }, 400);

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let aborted = request.signal.aborted;
  const abortReader = () => {
    aborted = true;
    void reader.cancel(request.signal.reason).catch(() => undefined);
  };
  if (aborted) {
    await reader.cancel(request.signal.reason).catch(() => undefined);
    return jsonResponse({ ok: false, error: "Richiesta interrotta o non leggibile" }, 400);
  }
  request.signal.addEventListener("abort", abortReader, { once: true });
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (aborted) return jsonResponse({ ok: false, error: "Richiesta interrotta o non leggibile" }, 400);
      if (done) break;
      total += value.byteLength;
      if (total > maxRequestBytes) {
        await reader.cancel("Request body limit exceeded").catch(() => undefined);
        return jsonResponse({ ok: false, error: "Richiesta troppo grande" }, 413);
      }
      chunks.push(value);
    }

    const body = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      body.set(chunk, offset);
      offset += chunk.byteLength;
    }
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(body);
    } catch {
      return jsonResponse({ ok: false, error: "Corpo UTF-8 non valido" }, 400);
    }
  } finally {
    request.signal.removeEventListener("abort", abortReader);
  }
}
