import { COMUNI_HOST } from "@/lib/comuni-host";
import { POLITICI_HOST } from "@/lib/politici-host";

export type ImmersiveKind = "politici" | "comuni";

/** Single-purpose immersive surfaces: no site chrome; each also on its own subdomain at `/`. */
export function immersiveKind(
  pathname: string | null,
  hostname: string | null = null,
): ImmersiveKind | null {
  if (pathname === "/politici" || pathname === "/politici/") return "politici";
  if (pathname === "/comuni" || pathname === "/comuni/") return "comuni";
  // Proxy rewrites subdomain `/` but the URL bar stays `/`.
  if (hostname === POLITICI_HOST && (pathname === "/" || pathname === "")) return "politici";
  if (hostname === COMUNI_HOST && (pathname === "/" || pathname === "")) return "comuni";
  return null;
}

/** @deprecated Prefer immersiveKind; kept for atlas call sites and existing tests. */
export function isPoliticiImmersive(
  pathname: string | null,
  hostname: string | null = null,
): boolean {
  return immersiveKind(pathname, hostname) === "politici";
}

export function isComuniImmersive(
  pathname: string | null,
  hostname: string | null = null,
): boolean {
  return immersiveKind(pathname, hostname) === "comuni";
}

export function isImmersiveSurface(
  pathname: string | null,
  hostname: string | null = null,
): boolean {
  return immersiveKind(pathname, hostname) !== null;
}

// Runs before first paint; no request headers are needed by the shared layout.
export const IMMERSIVE_INIT_SCRIPT = `(() => {
  const path = location.pathname;
  const host = location.hostname;
  if (path === "/politici" || path === "/politici/"
    || (host === ${JSON.stringify(POLITICI_HOST)} && path === "/")) {
    document.documentElement.dataset.immersive = "politici";
  } else if (path === "/comuni" || path === "/comuni/"
    || (host === ${JSON.stringify(COMUNI_HOST)} && path === "/")) {
    document.documentElement.dataset.immersive = "comuni";
  }
})();`;
