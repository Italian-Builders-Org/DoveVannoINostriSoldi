import type { NextRequest } from "next/server.js";
import { NextResponse } from "next/server.js";

const MCP_TRANSPORT_METHODS = new Set(["POST", "OPTIONS", "HEAD"]);
const CLAUDEBOT_USER_AGENT = /(?:^|[ (])ClaudeBot(?:\/|[ )]|$)/i;

// ── Per-instance API rate limiting ──────────────────────────────────
const PER_IP_WINDOW_MS = 60_000;
const PER_IP_MAX = 120;
const GLOBAL_WINDOW_MS = 60_000;
const GLOBAL_MAX = 600;
const MAX_TRACKED_IPS = 10_000;

const ipHits = new Map<string, number[]>();
const globalHits: number[] = [];

function slidingCount(timestamps: number[], now: number, windowMs: number): number {
  const floor = now - windowMs;
  let write = 0;
  for (let i = 0; i < timestamps.length; i++) {
    if (timestamps[i]! > floor) timestamps[write++] = timestamps[i]!;
  }
  timestamps.length = write;
  return write;
}

function evictStaleIps(floor: number): void {
  if (ipHits.size <= MAX_TRACKED_IPS) return;
  for (const [key, ts] of ipHits) {
    if (ts.every((t) => t <= floor)) ipHits.delete(key);
    if (ipHits.size <= MAX_TRACKED_IPS) return;
  }
  const oldest = ipHits.keys().next().value;
  if (oldest !== undefined) ipHits.delete(oldest);
}

function getClientIp(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-for");
  const first = forwarded?.split(",")[0]?.trim();
  if (first && first.length <= 64 && /^[0-9a-f.:%]+$/iu.test(first)) return first.toLowerCase();
  const real = request.headers.get("x-real-ip")?.trim();
  if (real && real.length <= 64 && /^[0-9a-f.:%]+$/iu.test(real)) return real.toLowerCase();
  return "unknown";
}

function apiRateLimit(request: NextRequest): NextResponse | null {
  const now = Date.now();

  slidingCount(globalHits, now, GLOBAL_WINDOW_MS);
  if (globalHits.length >= GLOBAL_MAX) {
    return NextResponse.json(
      { error: "Too many requests" },
      { status: 429, headers: { "Retry-After": "60" } },
    );
  }
  globalHits.push(now);

  const ip = getClientIp(request);
  const timestamps = ipHits.get(ip) ?? [];
  slidingCount(timestamps, now, PER_IP_WINDOW_MS);
  if (timestamps.length >= PER_IP_MAX) {
    ipHits.set(ip, timestamps);
    return NextResponse.json(
      { error: "Too many requests" },
      { status: 429, headers: { "Retry-After": "60" } },
    );
  }
  timestamps.push(now);
  ipHits.set(ip, timestamps);
  evictStaleIps(now - PER_IP_WINDOW_MS);

  return null;
}

// ── Proxy handler ───────────────────────────────────────────────────

export function proxy(request: NextRequest) {
  // Rate-limit all API endpoints
  if (request.nextUrl.pathname.startsWith("/api/")) {
    const blocked = apiRateLimit(request);
    if (blocked) return blocked;
  }

  if (
    request.nextUrl.pathname.startsWith("/enti/") &&
    CLAUDEBOT_USER_AGENT.test(request.headers.get("user-agent") ?? "")
  ) {
    return new NextResponse("Automated crawling of entity detail pages is temporarily unavailable.", {
      status: 403,
      headers: {
        "Cache-Control": "private, no-store",
        "X-Robots-Tag": "noindex, nofollow",
      },
    });
  }

  const acceptsEventStream = request.headers
    .get("accept")
    ?.toLocaleLowerCase("en-US")
    .split(",")
    .some((value) => value.trim().split(";", 1)[0] === "text/event-stream") ?? false;
  const isTransportRequest = MCP_TRANSPORT_METHODS.has(request.method)
    || (request.method === "GET" && acceptsEventStream);

  if (request.nextUrl.pathname !== "/mcp" || !isTransportRequest) {
    return NextResponse.next();
  }

  const endpointUrl = new URL(request.url);
  endpointUrl.pathname = "/api/mcp";
  return NextResponse.rewrite(endpointUrl);
}

export const config = {
  matcher: ["/mcp", "/enti/:path*", "/api/:path*"],
};
