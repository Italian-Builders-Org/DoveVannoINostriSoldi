import type { NextRequest } from "next/server.js";
import { NextResponse } from "next/server.js";

const MCP_TRANSPORT_METHODS = new Set(["POST", "OPTIONS", "HEAD"]);

export function proxy(request: NextRequest) {
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
  matcher: "/mcp",
};
