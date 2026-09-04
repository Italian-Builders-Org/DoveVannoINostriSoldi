import type { MetadataRoute } from "next";
import { publicRobots } from "@/lib/public-discovery";
import { PUBLIC_SITE_URL } from "@/lib/site";

export default function robots(): MetadataRoute.Robots {
  return publicRobots(PUBLIC_SITE_URL);
}
