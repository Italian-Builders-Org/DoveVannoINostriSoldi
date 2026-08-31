import type { MetadataRoute } from "next";
import { getGovernmentScorecardPublicPaths } from "@/lib/government-scorecard";
import { publicSitemap } from "@/lib/public-discovery";
import { getMunicipalityEntityPublicPaths } from "@/lib/siope-municipality-detail";
import { PUBLIC_SITE_URL } from "@/lib/site";

export default function sitemap(): MetadataRoute.Sitemap {
  return publicSitemap(PUBLIC_SITE_URL, [
    ...getGovernmentScorecardPublicPaths(),
    ...getMunicipalityEntityPublicPaths(),
  ]);
}
