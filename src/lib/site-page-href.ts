import { COMUNI_HOST } from "@/lib/comuni-host";
import { POLITICI_HOST } from "@/lib/politici-host";
import { PUBLIC_SITE_URL } from "@/lib/site";

/** Main-site pages stay on the current deployment, except on standalone atlas hosts. */
export function sitePageHref(path: string, hostname: string | null): string {
  if (!path.startsWith("/") || path.startsWith("//")) return path;
  // Before hydration preserve the existing main-site fallback: `/` on a
  // standalone atlas host is the atlas itself, not the site's home page.
  return hostname === null || hostname === COMUNI_HOST || hostname === POLITICI_HOST
    ? `${PUBLIC_SITE_URL}${path}`
    : path;
}
