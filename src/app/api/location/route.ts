import { italianRegionFromVercelHeaders } from "@/lib/ip-region";

export const dynamic = "force-dynamic";

export function GET(request: Request) {
  const region = italianRegionFromVercelHeaders(request.headers);

  return Response.json(
    {
      ok: true,
      region: region
        ? { code: region.istatCode, name: region.name, source: "vercel-ip-region" }
        : null,
    },
    {
      headers: {
        "Cache-Control": "private, no-store",
        "Vary": "X-Vercel-IP-Country, X-Vercel-IP-Country-Region",
      },
    },
  );
}
