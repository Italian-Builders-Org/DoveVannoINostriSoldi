import {
  ShareFactCardError,
  parseShareFactCardSearchParams,
} from "@/lib/share-fact-card";
import { createShareFactCardImageResponse } from "@/lib/share-fact-card-image";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const fact = parseShareFactCardSearchParams(searchParams);
    return createShareFactCardImageResponse(fact);
  } catch (error) {
    if (error instanceof ShareFactCardError) {
      return Response.json(
        { ok: false, error: error.code, detail: error.message },
        { status: 400, headers: { "Cache-Control": "no-store" } },
      );
    }
    throw error;
  }
}
