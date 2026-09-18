"use client";

import { usePathname } from "next/navigation";
import { useLayoutEffect, type ReactNode } from "react";
import { POLITICI_HOST } from "@/lib/politici-host";

/** Single-purpose map page: no site chrome; also on its own subdomain at `/`. */
export function isPoliticiImmersive(
  pathname: string | null,
  hostname: string | null = typeof window === "undefined" ? null : window.location.hostname,
): boolean {
  if (pathname === "/politici" || Boolean(pathname?.startsWith("/politici/"))) return true;
  // Proxy rewrites politici.* `/` → `/politici` but the URL bar stays `/`.
  return hostname === POLITICI_HOST && (pathname === "/" || pathname === "");
}

/** Marks <html> so CSS can drop sidebar offset and fill the viewport. */
export function ImmersiveDocumentFlag() {
  const pathname = usePathname();
  useLayoutEffect(() => {
    const immersive = isPoliticiImmersive(pathname);
    if (immersive) document.documentElement.dataset.immersive = "politici";
    else delete document.documentElement.dataset.immersive;
    return () => {
      delete document.documentElement.dataset.immersive;
    };
  }, [pathname]);
  return null;
}

/** Renders children only when we are NOT on the immersive map page. */
export function ChromeUnlessImmersive({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  if (isPoliticiImmersive(pathname)) return null;
  return children;
}
