import type { NextRequest } from "next/server.js";
import { NextResponse } from "next/server.js";

const MCP_TRANSPORT_METHODS = new Set(["POST", "OPTIONS", "HEAD"]);
const TRAINING_CRAWLER = /(?:^|[ (])(?:ClaudeBot|GPTBot|CCBot|Meta-ExternalAgent)(?:\/|[ );]|$)/i;
// Keep in sync with PUBLIC_POLITICI_URL (Node tests cannot resolve @/ aliases).
const POLITICI_HOST = "politici.dovevannoinostrisoldi.com";

// Local fallback only; Vercel WAF enforces the cross-instance limits.
const PER_IP_WINDOW_MS = 60_000;
const API_PER_IP_MAX = 120;
const ENTITY_PER_IP_MAX = 30;
const GLOBAL_WINDOW_MS = 60_000;
const GLOBAL_MAX = 600;
const MAX_TRACKED_IPS = 10_000;

type RateState = { ipHits: Map<string, number[]>; globalHits: number[] };
const apiState: RateState = { ipHits: new Map(), globalHits: [] };
const entityState: RateState = { ipHits: new Map(), globalHits: [] };

function slidingCount(timestamps: number[], now: number, windowMs: number): number {
  const floor = now - windowMs;
  let write = 0;
  for (let i = 0; i < timestamps.length; i++) {
    if (timestamps[i]! > floor) timestamps[write++] = timestamps[i]!;
  }
  timestamps.length = write;
  return write;
}

function evictStaleIps(ipHits: Map<string, number[]>, floor: number): void {
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

function rateLimit(request: NextRequest, state: RateState, perIpMax: number): NextResponse | null {
  const now = Date.now();
  const { ipHits, globalHits } = state;

  slidingCount(globalHits, now, GLOBAL_WINDOW_MS);
  if (globalHits.length >= GLOBAL_MAX) {
    return NextResponse.json(
      { error: "Too many requests" },
      { status: 429, headers: { "Retry-After": "60", "Cache-Control": "private, no-store" } },
    );
  }
  const ip = getClientIp(request);
  const timestamps = ipHits.get(ip) ?? [];
  slidingCount(timestamps, now, PER_IP_WINDOW_MS);
  if (timestamps.length >= perIpMax) {
    ipHits.set(ip, timestamps);
    return NextResponse.json(
      { error: "Too many requests" },
      { status: 429, headers: { "Retry-After": "60", "Cache-Control": "private, no-store" } },
    );
  }
  // Charge the shared allowance only for admitted requests. Rejected requests
  // from one client must not consume the capacity available to other clients.
  globalHits.push(now);
  timestamps.push(now);
  ipHits.set(ip, timestamps);
  evictStaleIps(ipHits, now - PER_IP_WINDOW_MS);

  return null;
}

function requestHostname(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const raw = forwarded || request.headers.get("host") || request.nextUrl.hostname;
  return raw.split(":")[0]!.toLowerCase();
}

// ── Proxy handler ───────────────────────────────────────────────────

export function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  // vercel.json host rewrites lose to the existing `/` page; rewrite here instead.
  if (pathname === "/" && requestHostname(request) === POLITICI_HOST) {
    const destination = request.nextUrl.clone();
    destination.pathname = "/politici";
    return NextResponse.rewrite(destination);
  }
  if (pathname.startsWith("/api/")) {
    const blocked = rateLimit(request, apiState, API_PER_IP_MAX);
    if (blocked) return blocked;
  }
  if ((pathname === "/enti" || pathname.startsWith("/enti/"))
    && TRAINING_CRAWLER.test(request.headers.get("user-agent") ?? "")) {
    const blocked = rateLimit(request, entityState, ENTITY_PER_IP_MAX);
    if (blocked) return blocked;
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
  matcher: ["/", "/mcp", "/enti/:path*", "/api/:path*"],
};
