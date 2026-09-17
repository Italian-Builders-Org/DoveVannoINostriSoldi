import {
  IntegratedDatasetNotFoundError,
  IntegratedQueryError,
  selectIntegratedDataset,
} from "@/lib/integrated-public-view";
import { IntegratedLoadOverloadedError } from "@/lib/integrated-sources";

export const runtime = "nodejs";

function parameter(searchParams: URLSearchParams, name: string): string | string[] | undefined {
  const values = searchParams.getAll(name);
  if (values.length === 0) return undefined;
  return values.length === 1 ? values[0] : values;
}

export async function GET(
  request: Request,
  context: { params: Promise<{ dataset: string }> },
) {
  const { dataset } = await context.params;
  const searchParams = new URL(request.url).searchParams;
  try {
    const result = await selectIntegratedDataset({
      datasetId: dataset,
      q: parameter(searchParams, "q"),
      limit: parameter(searchParams, "limit"),
      offset: parameter(searchParams, "offset"),
      cursor: parameter(searchParams, "cursor"),
      signal: request.signal,
    });
    return Response.json(result, {
      headers: {
        "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    if (error instanceof IntegratedDatasetNotFoundError) {
      return Response.json(
        { error: "Dataset non trovato." },
        { status: 404, headers: { "Cache-Control": "no-store" } },
      );
    }
    if (error instanceof IntegratedQueryError) {
      return Response.json(
        { error: error.message },
        { status: 400, headers: { "Cache-Control": "no-store" } },
      );
    }
    if (error instanceof IntegratedLoadOverloadedError) {
      return Response.json(
        { error: "Dati temporaneamente occupati: riprova tra poco." },
        {
          status: 503,
          headers: { "Cache-Control": "no-store", "Retry-After": "1" },
        },
      );
    }
    return Response.json(
      { error: "Dati non disponibili: verifica di integrità non superata." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
