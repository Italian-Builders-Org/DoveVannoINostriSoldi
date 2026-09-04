import {
  getGovernmentScorecardDownloadManifest,
} from "@/lib/government-scorecard-downloads";
import { GOVERNMENT_SCORECARD_DOWNLOAD_MANIFEST_FILENAME } from "@/lib/government-scorecard-download-links";

export const runtime = "nodejs";

export function GET() {
  return new Response(`${JSON.stringify(getGovernmentScorecardDownloadManifest(), null, 2)}\n`, {
    headers: {
      "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400",
      "Content-Disposition": `attachment; filename="${GOVERNMENT_SCORECARD_DOWNLOAD_MANIFEST_FILENAME}"`,
      "Content-Type": "application/json; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
