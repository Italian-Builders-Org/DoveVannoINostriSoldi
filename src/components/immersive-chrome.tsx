"use client";

import { usePathname } from "next/navigation";
import { useLayoutEffect, type ReactNode } from "react";

/** Single-purpose map page: no site chrome; it will live on its own subdomain. */
export function isPoliticiImmersive(pathname: string | null): boolean {
  return pathname === "/politici" || Boolean(pathname?.startsWith("/politici/"));
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
