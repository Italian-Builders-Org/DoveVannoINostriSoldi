import { freeQuota, quotaDay } from "@/lib/assistant/free-quota";
import { jsonResponse, readBoundedBody, rejectPublicPost } from "@/lib/http/public-post-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const guard = { maxRequestBytes: 128 };

export async function POST(request: Request) {
  const rejected = rejectPublicPost(request, guard);
  if (rejected) return rejected;
  try {
    const body = await readBoundedBody(request, guard);
    if (body instanceof Response) return body;
    if (body.trim() !== "{}") return jsonResponse({ error: "Richiesta non valida" }, 400);
    const status = await freeQuota(request);
    return jsonResponse(status.quota, 200, status.cookie ? { "Set-Cookie": status.cookie } : undefined);
  } catch {
    // Availability is a successful status lookup even when free access is disabled.
    // Chat admission still fails closed and never calls the model in this state.
    return jsonResponse({ available: false, remaining: 0, resetAt: quotaDay().resetAt });
  }
}
