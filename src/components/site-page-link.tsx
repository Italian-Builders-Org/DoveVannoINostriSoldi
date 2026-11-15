"use client";

import { useSyncExternalStore, type ComponentProps } from "react";
import { sitePageHref } from "@/lib/site-page-href";

const subscribe = () => () => {};
const hostname = () => window.location.hostname;
const serverHostname = () => null;

/** Full navigation restores the shared chrome after leaving an immersive page. */
export function SitePageLink({ href, ...props }: Omit<ComponentProps<"a">, "href" | "target"> & { href: string }) {
  const host = useSyncExternalStore(subscribe, hostname, serverHostname);
  return <a {...props} data-site-page-link="" href={sitePageHref(href, host)} />;
}
