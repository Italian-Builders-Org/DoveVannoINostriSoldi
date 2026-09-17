import { NextResponse } from "next/server";
import {
  openCoesionePaymentCostRatio,
  openCoesioneSnapshot,
} from "@/lib/opencoesione-snapshot";

export const dynamic = "force-static";

export function GET() {
  return NextResponse.json(
    {
      ...openCoesioneSnapshot,
      derived: {
        paymentCostRatio: openCoesionePaymentCostRatio,
        paymentCostRatioPercent: openCoesionePaymentCostRatio * 100,
      },
    },
    {
      headers: {
        "Cache-Control": "public, max-age=300, s-maxage=21600, stale-while-revalidate=604800",
        "X-Data-Source": "OpenCoesione",
        "X-Data-Reference-Date": openCoesioneSnapshot.referenceDate,
      },
    },
  );
}
