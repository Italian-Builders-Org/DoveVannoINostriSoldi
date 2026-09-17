import {
  IntegratedQueryError,
  selectPublicSourceCatalog,
} from "@/lib/integrated-public-view";

export const runtime = "nodejs";

function parameter(searchParams: URLSearchParams, name: string): string | string[] | undefined {
  const values = searchParams.getAll(name);
  if (values.length === 0) return undefined;
  return values.length === 1 ? values[0] : values;
}

export async function GET(request: Request) {
  const searchParams = new URL(request.url).searchParams;
  try {
    const result = await selectPublicSourceCatalog({
      q: parameter(searchParams, "q"),
      disposition: parameter(searchParams, "disposition"),
      limit: parameter(searchParams, "limit"),
      offset: parameter(searchParams, "offset"),
    });
    return Response.json(result, {
      headers: {
        "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    if (error instanceof IntegratedQueryError) {
      return Response.json(
        { error: error.message },
        { status: 400, headers: { "Cache-Control": "no-store" } },
      );
    }
    return Response.json(
      { error: "Fonti non disponibili: verifica di integrità non superata." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
