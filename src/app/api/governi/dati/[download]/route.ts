import { getGovernmentScorecardDownload } from "@/lib/government-scorecard-downloads";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ download: string }> },
) {
  const { download: id } = await context.params;
  const artifact = getGovernmentScorecardDownload(id);
  if (!artifact) {
    return Response.json(
      { error: "Download non trovato." },
      {
        status: 404,
        headers: {
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
        },
      },
    );
  }

  return new Response(artifact.body, {
    headers: {
      "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400",
      "Content-Disposition": `attachment; filename="${artifact.filename}"`,
      "Content-Length": String(artifact.bytes),
      "Content-Type": artifact.contentType,
      ETag: `"${artifact.sha256}"`,
      "X-Content-Type-Options": "nosniff",
    },
  });
}
