import { findRepublicPerson } from "@/lib/politici-repubblica";
import { runWithRequestBudget } from "@/lib/search/request-budget";

export const runtime = "nodejs";
/** Let the CDN keep successful and negative portrait responses warm. */
export const revalidate = 86_400;
export const maxDuration = 8;

const REQUEST_TIMEOUT_MS = 6_000;
const MAX_IMAGE_BYTES = 2_000_000;
const UPSTREAM_REVALIDATE_SECONDS = 86_400;

const SUCCESS_CACHE = "public, s-maxage=86400, stale-while-revalidate=604800";
const DECLARED_GAP_CACHE = "public, s-maxage=86400, stale-while-revalidate=604800";
/** Senato rate-limits / blocks Vercel IPs: absorb retries at the edge for an hour. */
const UPSTREAM_BLOCK_CACHE = "public, s-maxage=3600, stale-while-revalidate=86400";
/** Short negative cache so a timeout storm does not re-hit the origin every request. */
const TRANSIENT_CACHE = "public, s-maxage=60, stale-while-revalidate=300";

function detectImageType(bytes: Uint8Array): string | null {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (String.fromCharCode(...bytes.slice(0, 4)) === "RIFF"
    && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP") return "image/webp";
  return null;
}

function portraitUserAgent(photoUrl: string): string {
  const host = new URL(photoUrl).hostname.toLowerCase();
  const wikimedia = host === "wikimedia.org" || host.endsWith(".wikimedia.org");
  // The Senate CDN answers an empty 202 to generic browser and bot user agents;
  // Wikimedia instead requires a project that identifies itself.
  return wikimedia
    ? "DoveVannoINostriSoldi/1.0 (+https://www.dovevannoinostrisoldi.com)"
    : "curl/8.7.1 (+https://www.dovevannoinostrisoldi.com)";
}

function missingPortrait(message: string, cacheControl: string): Response {
  return Response.json(
    { ok: false, error: message },
    { status: 404, headers: { "Cache-Control": cacheControl } },
  );
}

class UpstreamPortraitError extends Error {
  readonly kind: "blocked" | "invalid";

  constructor(kind: "blocked" | "invalid", message: string) {
    super(message);
    this.kind = kind;
  }
}

export async function GET(request: Request, context: RouteContext<"/politici/foto/[id]">) {
  const { id } = await context.params;
  const person = findRepublicPerson(id);
  if (!person) {
    return Response.json(
      { ok: false, error: "Persona non trovata." },
      { status: 404, headers: { "Cache-Control": "no-store" } },
    );
  }
  if (person.photoUrl === null) {
    // The institutional sources publish no portrait for this person: the client
    // renders a monogram instead of a picture inferred from somewhere else.
    return missingPortrait("Ritratto ufficiale non disponibile.", DECLARED_GAP_CACHE);
  }

  const photoUrl = person.photoUrl;
  try {
    const outcome = await runWithRequestBudget(request.signal, REQUEST_TIMEOUT_MS, async (signal) => {
      const response = await fetch(photoUrl, {
        signal,
        // Cache official bytes in the Next data cache so atlas bursts reuse one
        // upstream fetch instead of hammering Camera/Senato/Wikimedia per visitor.
        next: { revalidate: UPSTREAM_REVALIDATE_SECONDS },
        headers: {
          Accept: "image/jpeg,image/png,image/*",
          "User-Agent": portraitUserAgent(photoUrl),
        },
      });
      // Senato: empty 202 for blocked UAs; 403 when Vercel IPs are rate-limited.
      if (response.status === 403 || response.status === 404 || response.status === 202) {
        throw new UpstreamPortraitError("blocked", `ritratto ufficiale HTTP ${response.status}`);
      }
      if (!response.ok) {
        throw new UpstreamPortraitError("invalid", `ritratto ufficiale HTTP ${response.status}`);
      }
      const buffer = await response.arrayBuffer();
      if (buffer.byteLength === 0 || buffer.byteLength > MAX_IMAGE_BYTES) {
        throw new UpstreamPortraitError("invalid", "dimensione ritratto ufficiale non valida");
      }
      const bytes = new Uint8Array(buffer);
      const contentType = detectImageType(bytes);
      if (!contentType) {
        throw new UpstreamPortraitError("invalid", "firma binaria del ritratto inattesa");
      }
      return { bytes, contentType };
    });
    if (outcome.timedOut) {
      // Soft-miss: UI falls back to monogram; CDN stops the retry storm.
      return missingPortrait(
        "Ritratto ufficiale temporaneamente non disponibile.",
        TRANSIENT_CACHE,
      );
    }
    return new Response(outcome.value.bytes, {
      headers: {
        "Content-Type": outcome.value.contentType,
        "Cache-Control": SUCCESS_CACHE,
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    if (request.signal.aborted) throw error;
    const message = error instanceof Error ? error.message : "unknown";
    console.warn("Politici official portrait proxy failed", {
      personId: person.id,
      message,
    });
    // Never return 5xx here: Observability treats them as spikes, and no-store
    // 502s made browsers and the CDN re-invoke the function in a tight loop.
    const cacheControl = error instanceof UpstreamPortraitError && error.kind === "blocked"
      ? UPSTREAM_BLOCK_CACHE
      : TRANSIENT_CACHE;
    return missingPortrait("Ritratto ufficiale temporaneamente non disponibile.", cacheControl);
  }
}
