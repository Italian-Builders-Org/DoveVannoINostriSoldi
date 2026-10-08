import {
  PaycheckShareCardError,
  parsePaycheckShareCardSearchParams,
} from "@/lib/paycheck-share-card";
import { createPaycheckShareCardImageResponse } from "@/lib/paycheck-share-card-image";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const card = parsePaycheckShareCardSearchParams(searchParams);
    return createPaycheckShareCardImageResponse(card);
  } catch (error) {
    if (error instanceof PaycheckShareCardError) {
      return Response.json(
        { ok: false, error: error.code, detail: error.message },
        { status: 400, headers: { "Cache-Control": "no-store" } },
      );
    }
    throw error;
  }
}
