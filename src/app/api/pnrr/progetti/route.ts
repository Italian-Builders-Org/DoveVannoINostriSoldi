import { NextResponse, type NextRequest } from "next/server.js";
import { IntegratedQueryError, selectPnrrProjects } from "@/lib/integrated-public-view";
import { pnrrFilterNames } from "@/lib/pnrr-projects-index";
import { IntegratedLoadOverloadedError } from "@/lib/integrated-sources";

const allowed = new Set<string>([...pnrrFilterNames, "limit", "cursor"]);

export async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams;
    const input: Record<string, string> = {};
    for (const key of params.keys()) {
      if (!allowed.has(key)) throw new IntegratedQueryError(`Parametro non supportato: ${key}.`);
      if (params.getAll(key).length !== 1) throw new IntegratedQueryError(`Il parametro ${key} deve comparire una sola volta.`);
      input[key] = params.get(key)!;
    }
    const result = await selectPnrrProjects({ ...input, signal: request.signal });
    const body = JSON.stringify(result);
    if (Buffer.byteLength(body) > 750_000) return NextResponse.json({ error: "Risposta troppo grande; riduci limit." }, { status: 413 });
    return new NextResponse(body, { headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "public, max-age=300" } });
  } catch (error) {
    if (error instanceof IntegratedQueryError) return NextResponse.json({ error: error.message }, { status: 400 });
    if (error instanceof IntegratedLoadOverloadedError) return NextResponse.json({ error: "Catalogo temporaneamente occupato." }, { status: 503, headers: { "Retry-After": "5" } });
    return NextResponse.json({ error: "Catalogo PNRR temporaneamente non disponibile." }, { status: 500 });
  }
}
