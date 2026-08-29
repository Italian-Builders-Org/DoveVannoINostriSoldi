import type { MetadataRoute } from "next";
import { publicSitemap } from "@/lib/public-discovery";
import { PUBLIC_SITE_URL } from "@/lib/site";

export default function sitemap(): MetadataRoute.Sitemap {
  return publicSitemap(PUBLIC_SITE_URL);
}
