import { NextResponse } from "next/server";
import { consulentiSnapshot } from "@/lib/consulenti-snapshot";

export const dynamic = "force-static";

export function GET() {
  return NextResponse.json(
    {
      ok: true,
      source: "Consulenti Pubblici · Dipartimento della Funzione Pubblica",
      observedAt: consulentiSnapshot.source.observedAt,
      latestYear: consulentiSnapshot.latestYear,
      data: {
        externalAppointments: consulentiSnapshot.externalAppointments,
        employeeAppointments: consulentiSnapshot.employeeAppointments,
      },
      methodology: consulentiSnapshot.methodology,
      provenance: consulentiSnapshot.source,
    },
    {
      headers: {
        "Cache-Control": "public, s-maxage=21600, stale-while-revalidate=86400",
      },
    },
  );
}
