import { headers } from "next/headers";
import {
  IMMERSIVE_REQUEST_HEADER,
  IMMERSIVE_REQUEST_VALUE,
} from "@/lib/politici-host";

/**
 * True when the national atlas should render without site chrome (SSR-safe).
 *
 * Only the proxy-stamped atlas request is immersive. Sub-routes such as
 * `/politici/europa` must keep normal site navigation and document scroll.
 * Do not infer immersiveness from the politici hostname alone: that locked
 * every path on the subdomain (and, with soft navigation, left the home
 * page without a remounted menu).
 */
export async function isImmersiveMapRequest(): Promise<boolean> {
  const headerStore = await headers();
  return headerStore.get(IMMERSIVE_REQUEST_HEADER) === IMMERSIVE_REQUEST_VALUE;
}
