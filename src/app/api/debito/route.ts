import { getPublicDebtView, PublicDebtContractError } from "@/lib/public-debt";

const CACHE_CONTROL = "public, max-age=3600, stale-while-revalidate=86400";

export function createPublicDebtResponse(loadView: typeof getPublicDebtView = getPublicDebtView) {
  try {
    return Response.json(loadView(), {
      headers: { "Cache-Control": CACHE_CONTROL },
    });
  } catch (error) {
    if (error instanceof PublicDebtContractError) {
      return Response.json(
        { ok: false, error: "snapshot_contract_invalid" },
        { status: 503, headers: { "Cache-Control": "no-store" } },
      );
    }
    throw error;
  }
}

export async function GET() {
  return createPublicDebtResponse();
}
