import { NextRequest } from "next/server.js";
import { NextResponse } from "next/server.js";
import { SNAPSHOT_PREFIX, IPA_CODE, CACHED_ENTITY_VIEWS, publicSnapshotPath } from "@/lib/snapshot-routing";

const MCP_TRANSPORT_METHODS = new Set(["POST", "OPTIONS", "HEAD"]);
const TRAINING_CRAWLER = /(?:^|[ (])(?:ClaudeBot|GPTBot|CCBot|Meta-ExternalAgent|Amazonbot|Bytespider|Applebot-Extended)(?:\/|[ );]|$)/i;
// Keep in sync with PUBLIC_POLITICI_URL / PUBLIC_COMUNI_URL / immersive-chrome
const POLITICI_HOST = "politici.dovevannoinostrisoldi.com";
const COMUNI_HOST = "comuni.dovevannoinostrisoldi.com";

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

/** Only default snapshot views enter ISR; filters retain their request semantics. */
function snapshotPath(request: NextRequest, path: string): string | null {
  if (!["GET", "HEAD"].includes(request.method) || request.headers.has("authorization")) return null;
  const query = request.nextUrl.searchParams;
  const entity = /^\/enti\/([A-Za-z0-9_]{1,100})\/appalti$/.exec(path);
  const operator = /^\/appalti\/operatori\/(op-[0-9]{8})$/.exec(path);
  const keys = entity ? ["view", "page", "pageSize", "metric", "operator", "cpv", "awardYear", "selection"]
    : operator ? ["year", "authority", "procedure", "minAmount", "maxAmount", "page"]
    : path === "/comuni" ? ["ente", "q"] : [];
  // These pages ignore other parameters (including campaign tags). ISR keys
  // depend on the resolved pathname, while Next retains the RSC query/headers.
  const entityView = query.get("view") || "summary";
  const defaultEntityView = Boolean(entity && CACHED_ENTITY_VIEWS.has(entityView));
  // Only parameters used by this view can split its content. Keep duplicate
  // actual filters dynamic so their existing validation can reject ambiguity.
  const semantic = keys.filter(key => query.has(key) && !(defaultEntityView && (
    key === "operator" || key === "selection" || (key === "metric" && entityView !== "operators")
  )));
  if (semantic.some(key => query.getAll(key).length !== 1)) return null;
  if (entity && CACHED_ENTITY_VIEWS.has(entityView) && semantic.every(key => key === "view"
    || (key === "page" && query.get(key) === "1")
    || (key === "pageSize" && query.get(key) === "25")
    || ((key === "cpv" || key === "awardYear") && query.get(key) === "")
    || (key === "metric" && query.get(key) === "count"))) {
    return `${SNAPSHOT_PREFIX}enti/${entity[1]}/${entityView}`;
  }
  if (operator && semantic.every(key => key === "page" && query.get(key) === "1")) return `${SNAPSHOT_PREFIX}operatori/${operator[1]}`;
  if (path === "/comuni" && semantic.every(key => key === "ente")) {
    const code = query.get("ente") || "c_e897";
    return IPA_CODE.test(code) ? `${SNAPSHOT_PREFIX}comuni/${code}` : null;
  }
  return null;
}

// ── Proxy handler ───────────────────────────────────────────────────

export function proxy(request: NextRequest) {
  let pathname = request.nextUrl.pathname;
  if (pathname.startsWith(SNAPSHOT_PREFIX)) {
    const publicPath = publicSnapshotPath(pathname);
    if (!publicPath) return new NextResponse(null, { status: 404 });
    const destination = request.nextUrl.clone();
    destination.pathname = publicPath;
    const parts = pathname.slice(SNAPSHOT_PREFIX.length).split("/");
    if (parts[0] === "enti" && !destination.searchParams.has("view")) destination.searchParams.set("view", parts[2]!);
    if (parts[0] === "comuni" && !destination.searchParams.has("ente")) destination.searchParams.set("ente", parts[1]!);
    const publicRequest = new NextRequest(destination, { method: request.method, headers: request.headers });
    // Next's on-demand renderer requests this path again. Redirecting a default
    // snapshot here also redirects the public rewrite, producing a loop.
    if (snapshotPath(publicRequest, publicPath) !== pathname) return NextResponse.redirect(destination, 307);
    if (TRAINING_CRAWLER.test(request.headers.get("user-agent") ?? "")) {
      const blocked = rateLimit(request, entityState, ENTITY_PER_IP_MAX);
      if (blocked) return blocked;
    }
    return NextResponse.next();
  }
  // vercel.json host rewrites lose to the existing `/` page; rewrite here instead.
  if (pathname === "/" && requestHostname(request) === POLITICI_HOST) {
    pathname = "/politici";
  }
  if (pathname === "/" && requestHostname(request) === COMUNI_HOST) {
    pathname = "/comuni";
  }
  if (pathname.startsWith("/api/")) {
    const blocked = rateLimit(request, apiState, API_PER_IP_MAX);
    if (blocked) return blocked;
  }
  if (/^\/(?:enti|appalti|comuni|dati|progetti|confronti|controlli|patrimonio|politici)(?:\/|$)/.test(pathname)
    && TRAINING_CRAWLER.test(request.headers.get("user-agent") ?? "")) {
    const blocked = rateLimit(request, entityState, ENTITY_PER_IP_MAX);
    if (blocked) return blocked;
  }

  const cachedPath = snapshotPath(request, pathname);
  if (cachedPath || pathname !== request.nextUrl.pathname) {
    const destination = request.nextUrl.clone();
    destination.pathname = cachedPath ?? pathname;
    return NextResponse.rewrite(destination);
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
  matcher: ["/", "/mcp", "/enti/:path*", "/appalti/:path*", "/comuni/:path*", "/dati/:path*", "/progetti/:path*", "/confronti/:path*", "/controlli/:path*", "/patrimonio/:path*", "/politici/:path*", "/snapshot-pages/:path*", "/api/:path*"],
};
