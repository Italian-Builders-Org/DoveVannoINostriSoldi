import type { MetadataRoute } from "next";
import { getGovernmentScorecardPublicPaths } from "@/lib/government-scorecard-governments";
import { publicSitemap } from "@/lib/public-discovery";
import { PUBLIC_SITE_URL } from "@/lib/site";

export default function sitemap(): MetadataRoute.Sitemap {
  // Keep the high-cardinality municipality surface out of crawler discovery
  // while the incident containment is being observed in production. Direct
  // profile visits are snapshot-first and remain available.
  return publicSitemap(PUBLIC_SITE_URL, [
    ...getGovernmentScorecardPublicPaths(),
  ]);
}
