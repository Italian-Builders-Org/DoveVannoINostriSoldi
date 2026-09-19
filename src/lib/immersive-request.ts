import { headers } from "next/headers";
import {
  IMMERSIVE_REQUEST_HEADER,
  IMMERSIVE_REQUEST_VALUE,
  POLITICI_HOST,
} from "@/lib/politici-host";

function requestHostname(raw: string | null): string {
  return (raw ?? "").split(",")[0]?.trim().split(":")[0]?.toLowerCase() ?? "";
}

/** True when the map should render without site chrome (SSR-safe). */
export async function isImmersiveMapRequest(): Promise<boolean> {
  const headerStore = await headers();
  if (headerStore.get(IMMERSIVE_REQUEST_HEADER) === IMMERSIVE_REQUEST_VALUE) return true;
  const host = requestHostname(headerStore.get("x-forwarded-host") ?? headerStore.get("host"));
  return host === POLITICI_HOST;
}
