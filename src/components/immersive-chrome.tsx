"use client";

import { usePathname } from "next/navigation";
import { useLayoutEffect, type ReactNode } from "react";
import {
  immersiveKind,
  isImmersiveSurface,
  isPoliticiImmersive,
} from "@/lib/politici-immersive";

export { isPoliticiImmersive, isImmersiveSurface, immersiveKind };

/** Marks <html> so CSS can drop sidebar offset and fill the viewport. */
export function ImmersiveDocumentFlag() {
  const pathname = usePathname();
  useLayoutEffect(() => {
    const hostname = window.location.hostname;
    const kind = immersiveKind(pathname, hostname);
    if (kind) document.documentElement.dataset.immersive = kind;
    else delete document.documentElement.dataset.immersive;
    return () => {
      delete document.documentElement.dataset.immersive;
    };
  }, [pathname]);
  return null;
}

/**
 * Renders children only when we are NOT on an immersive surface.
 * Must stay mounted under the root layout even on immersive SSR so that soft
 * navigation back to the rest of the site can restore the menu without a
 * full document reload.
 */
export function ChromeUnlessImmersive({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const hostname = typeof window === "undefined" ? null : window.location.hostname;
  if (isImmersiveSurface(pathname, hostname)) return null;
  return children;
}
