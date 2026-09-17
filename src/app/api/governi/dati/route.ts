import {
  assertGovernmentScorecardFunctionResponseSize,
  getGovernmentScorecardDownloadManifest,
  serializeGovernmentScorecardDownloadJson,
} from "@/lib/government-scorecard-downloads";
import { GOVERNMENT_SCORECARD_DOWNLOAD_MANIFEST_FILENAME } from "@/lib/government-scorecard-download-links";

export const runtime = "nodejs";

export function GET() {
  const body = serializeGovernmentScorecardDownloadJson(getGovernmentScorecardDownloadManifest());
  const bytes = Buffer.byteLength(body);
  assertGovernmentScorecardFunctionResponseSize(bytes, "manifest");
  return new Response(body, {
    headers: {
      "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400",
      "Content-Disposition": `attachment; filename="${GOVERNMENT_SCORECARD_DOWNLOAD_MANIFEST_FILENAME}"`,
      "Content-Length": String(bytes),
      "Content-Type": "application/json; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
