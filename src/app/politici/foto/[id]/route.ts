import { findRepublicPerson } from "@/lib/politici-repubblica";
import { runWithRequestBudget } from "@/lib/search/request-budget";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 8;

const REQUEST_TIMEOUT_MS = 6_000;
const MAX_IMAGE_BYTES = 2_000_000;

function detectImageType(bytes: Uint8Array): string | null {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (String.fromCharCode(...bytes.slice(0, 4)) === "RIFF"
    && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP") return "image/webp";
  return null;
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
    return Response.json(
      { ok: false, error: "Ritratto ufficiale non disponibile." },
      { status: 404, headers: { "Cache-Control": "public, s-maxage=86400" } },
    );
  }

  const photoUrl = person.photoUrl;
  try {
    const outcome = await runWithRequestBudget(request.signal, REQUEST_TIMEOUT_MS, async (signal) => {
      const response = await fetch(photoUrl, {
        signal,
        cache: "no-store",
        headers: {
          Accept: "image/jpeg,image/png,image/*",
          // The Senate CDN answers an empty 202 to generic browser and bot user
          // agents; Wikimedia instead requires a project that identifies itself.
          "User-Agent": new URL(photoUrl).hostname.endsWith("wikimedia.org")
            ? "DoveVannoINostriSoldi/1.0 (+https://www.dovevannoinostrisoldi.com)"
            : "curl/8.7.1 (+https://www.dovevannoinostrisoldi.com)",
        },
      });
      if (!response.ok) throw new Error(`ritratto ufficiale HTTP ${response.status}`);
      const buffer = await response.arrayBuffer();
      if (buffer.byteLength === 0 || buffer.byteLength > MAX_IMAGE_BYTES) {
        throw new Error("dimensione ritratto ufficiale non valida");
      }
      const bytes = new Uint8Array(buffer);
      const contentType = detectImageType(bytes);
      if (!contentType) throw new Error("firma binaria del ritratto inattesa");
      return { bytes, contentType };
    });
    if (outcome.timedOut) {
      return Response.json(
        { ok: false, error: "Ritratto ufficiale temporaneamente non disponibile." },
        { status: 504, headers: { "Cache-Control": "no-store", "Retry-After": "30" } },
      );
    }
    return new Response(outcome.value.bytes, {
      headers: {
        "Content-Type": outcome.value.contentType,
        "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=604800",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    if (request.signal.aborted) throw error;
    console.warn("Politici official portrait proxy failed", {
      personId: person.id,
      message: error instanceof Error ? error.message : "unknown",
    });
    return Response.json(
      { ok: false, error: "Ritratto ufficiale temporaneamente non disponibile." },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
