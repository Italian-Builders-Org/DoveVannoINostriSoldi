import type { MetadataRoute } from "next";
import { getGovernmentScorecardPublicPaths } from "@/lib/government-scorecard";
import { publicSitemap } from "@/lib/public-discovery";
import { PUBLIC_SITE_URL } from "@/lib/site";

export default function sitemap(): MetadataRoute.Sitemap {
  // Municipality pages still enrich committed SIOPE data with live IPA at
  // request time. Do not hand thousands of those dynamic URLs to crawlers
  // until the profile route is entirely snapshot-first.
  return publicSitemap(PUBLIC_SITE_URL, [
    ...getGovernmentScorecardPublicPaths(),
  ]);
}
