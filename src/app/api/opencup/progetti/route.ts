import { NextResponse, type NextRequest } from "next/server.js";
import {
  IntegratedQueryError,
  selectOpenCupProjects,
} from "@/lib/integrated-public-view";
import { SOURCE_POLICIES } from "@/lib/data/source-policy";

const allowed = new Set(["cup", "limit", "cursor"]);
const errorHeaders = { "Cache-Control": "no-store" };

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  if (SOURCE_POLICIES.opencup.integration !== "active") {
    return NextResponse.json(
      { error: "Risorsa non disponibile." },
      { status: 404, headers: errorHeaders },
    );
  }
  try {
    const params = request.nextUrl.searchParams;
    const input: Record<string, string> = {};
    for (const key of params.keys()) {
      if (!allowed.has(key)) {
        throw new IntegratedQueryError(`Parametro non supportato: ${key}.`);
      }
      if (params.getAll(key).length !== 1) {
        throw new IntegratedQueryError(`Il parametro ${key} deve comparire una sola volta.`);
      }
      input[key] = params.get(key)!;
    }
    const result = await selectOpenCupProjects({
      cup: input.cup,
      limit: input.limit,
      cursor: input.cursor,
      signal: request.signal,
    });
    const body = JSON.stringify(result);
    if (Buffer.byteLength(body) > 750_000) {
      return NextResponse.json(
        { error: "Risposta troppo grande; riduci limit." },
        { status: 413, headers: errorHeaders },
      );
    }
    return new NextResponse(body, {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "public, max-age=300",
      },
    });
  } catch (error) {
    if (request.signal.aborted) throw request.signal.reason ?? error;
    if (error instanceof IntegratedQueryError) {
      return NextResponse.json(
        { error: error.message },
        { status: 400, headers: errorHeaders },
      );
    }
    return NextResponse.json(
      { error: "OpenCUP temporaneamente non disponibile." },
      {
        status: 503,
        headers: { ...errorHeaders, "Retry-After": "5" },
      },
    );
  }
}
