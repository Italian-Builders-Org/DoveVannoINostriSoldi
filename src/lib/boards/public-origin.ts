import "server-only";
import { PUBLIC_SITE_URL } from "@/lib/site";

/**
 * Origine usata nei magic link Boards.
 * In produzione non ci fidiamo di request.url (e non di Site URL Supabase
 * ancora su localhost): il callback deve sempre puntare al sito pubblico.
 */
export function boardsPublicOrigin(requestUrl: string): string {
  if (process.env.VERCEL_ENV === "production") {
    return PUBLIC_SITE_URL;
  }
  const override = (process.env.BOARDS_PUBLIC_ORIGIN ?? "").trim().replace(/\/$/u, "");
  if (override.startsWith("https://") || override.startsWith("http://")) {
    return override;
  }
  try {
    return new URL(requestUrl).origin;
  } catch {
    return PUBLIC_SITE_URL;
  }
}

export function boardsMagicLinkCallbackUrl(requestUrl: string): string {
  return `${boardsPublicOrigin(requestUrl)}/accedi/callback`;
}
