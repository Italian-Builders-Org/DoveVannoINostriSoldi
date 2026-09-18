import { partySymbol } from "@/lib/politici-symbols";

export const SYMBOL_MAX_BYTES = 2_000_000;
const TIMEOUT_MS = 6_000;
const failure = (status: number) => new Response(null, { status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });

function rasterType(bytes: Uint8Array): string | null {
  if (bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return "image/jpeg";
  if (bytes.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => bytes[index] === byte)) return "image/png";
  return null;
}

/** Fixed catalog only: no URL input, redirects, SVG, browser cookies or referrer forwarded. */
export async function symbolResponse(id: string, signal: AbortSignal, fetcher: typeof fetch = fetch): Promise<Response> {
  const symbol = partySymbol(id);
  if (!symbol) return failure(404);
  const timeout = AbortSignal.timeout(TIMEOUT_MS);
  const budget = AbortSignal.any([signal, timeout]);
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    budget.throwIfAborted();
    const response = await fetcher(symbol.assetUrl, {
      signal: budget, redirect: "error", credentials: "omit", referrerPolicy: "no-referrer",
      headers: { Accept: "image/png,image/jpeg", "User-Agent": "DoveVannoINostriSoldi/1.0 (+https://www.dovevannoinostrisoldi.com)" },
    });
    if (!response.ok || !response.body) {
      await response.body?.cancel();
      return failure(502);
    }
    const advertised = Number(response.headers.get("content-length"));
    if (Number.isFinite(advertised) && advertised > SYMBOL_MAX_BYTES) {
      await response.body.cancel();
      return failure(502);
    }
    reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let length = 0;
    while (true) {
      budget.throwIfAborted();
      const chunk = await reader.read();
      if (chunk.done) break;
      length += chunk.value.byteLength;
      if (length > SYMBOL_MAX_BYTES) throw new Error("symbol body exceeds limit");
      chunks.push(chunk.value);
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const type = rasterType(bytes);
    if (!type) return failure(502);
    return new Response(bytes, { headers: {
      "Content-Type": type,
      "Cache-Control": "public, max-age=86400, s-maxage=604800, stale-while-revalidate=604800",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Cross-Origin-Resource-Policy": "same-origin",
    } });
  } catch (error) {
    if (signal.aborted) throw error;
    return failure(timeout.aborted ? 504 : 502);
  } finally {
    if (reader) { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  }
}
