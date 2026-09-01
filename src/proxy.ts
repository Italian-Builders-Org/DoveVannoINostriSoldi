import type { NextRequest } from "next/server.js";
import { NextResponse } from "next/server.js";

const MCP_TRANSPORT_METHODS = new Set(["POST", "OPTIONS", "HEAD"]);
const CLAUDEBOT_USER_AGENT = /(?:^|[ (])ClaudeBot(?:\/|[ )]|$)/i;

export function proxy(request: NextRequest) {
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
  matcher: ["/mcp", "/enti/:path*"],
};
