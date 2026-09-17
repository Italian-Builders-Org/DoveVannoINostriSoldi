import type { NextRequest } from "next/server";
import { queryConsipOrdini, type ConsipOrdiniChannel } from "@/lib/consip-ordini-snapshot";

const CACHE_CONTROL = "public, max-age=3600, stale-while-revalidate=86400";

function parseYear(value: string | null): number | undefined {
  if (value === null) return undefined;
  if (!/^\d{4}$/.test(value)) return NaN;
  const year = Number(value);
  return Number.isSafeInteger(year) ? year : NaN;
}

function parseChannel(value: string | null): ConsipOrdiniChannel | undefined | null {
  if (value === null) return undefined;
  if (value === "convenzioni" || value === "mepa") return value;
  return null;
}

export function GET(request: NextRequest) {
  const year = parseYear(request.nextUrl.searchParams.get("anno"));
  if (Number.isNaN(year)) {
    return Response.json(
      { error: "Il parametro anno deve essere un anno a quattro cifre." },
      { status: 400 },
    );
  }
  const channel = parseChannel(request.nextUrl.searchParams.get("canale"));
  if (channel === null) {
    return Response.json(
      { error: "Il parametro canale accetta solo convenzioni oppure mepa." },
      { status: 400 },
    );
  }

  try {
    return Response.json(queryConsipOrdini({ year, channel }), {
      headers: { "Cache-Control": CACHE_CONTROL },
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Richiesta non valida." },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
}
