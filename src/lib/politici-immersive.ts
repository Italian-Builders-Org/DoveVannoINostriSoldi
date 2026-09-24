import { POLITICI_HOST } from "@/lib/politici-host";

/** Single-purpose national atlas: no site chrome; also on its own subdomain at `/`. */
export function isPoliticiImmersive(
  pathname: string | null,
  hostname: string | null = null,
): boolean {
  // Only the atlas itself — never /politici/europa or other sub-routes.
  if (pathname === "/politici" || pathname === "/politici/") return true;
  // Proxy rewrites politici.* `/` → `/politici` but the URL bar stays `/`.
  return hostname === POLITICI_HOST && (pathname === "/" || pathname === "");
}

// Runs before first paint; no request headers are needed by the shared layout.
export const IMMERSIVE_INIT_SCRIPT = `(() => {
  const path = location.pathname;
  if (path === "/politici" || path === "/politici/"
    || (location.hostname === ${JSON.stringify(POLITICI_HOST)} && path === "/")) {
    document.documentElement.dataset.immersive = "politici";
  }
})();`;
