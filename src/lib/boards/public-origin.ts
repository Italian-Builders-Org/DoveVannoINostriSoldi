/** Allineato a PUBLIC_SITE_URL in src/lib/site.ts (test Node senza alias @/). */
const PUBLIC_SITE_ORIGIN = "https://www.dovevannoinostrisoldi.com";

/**
 * Origine usata nei magic link Boards.
 * In produzione non ci fidiamo di request.url (e non di Site URL Supabase
 * ancora su localhost): il callback deve sempre puntare al sito pubblico.
 */
export function boardsPublicOrigin(
  requestUrl: string,
  env: { vercelEnv?: string; boardsPublicOrigin?: string } = {},
): string {
  const vercelEnv = env.vercelEnv ?? process.env.VERCEL_ENV;
  if (vercelEnv === "production") {
    return PUBLIC_SITE_ORIGIN;
  }
  const override = (env.boardsPublicOrigin ?? process.env.BOARDS_PUBLIC_ORIGIN ?? "")
    .trim()
    .replace(/\/$/u, "");
  if (override.startsWith("https://") || override.startsWith("http://")) {
    return override;
  }
  try {
    return new URL(requestUrl).origin;
  } catch {
    return PUBLIC_SITE_ORIGIN;
  }
}

export function boardsMagicLinkCallbackUrl(
  requestUrl: string,
  env?: { vercelEnv?: string; boardsPublicOrigin?: string },
): string {
  return `${boardsPublicOrigin(requestUrl, env)}/accedi/callback`;
}

/** Riscrive redirect_to sul link generate_link di Supabase. */
export function forceActionLinkRedirect(actionLink: string, redirectTo: string): string {
  try {
    const url = new URL(actionLink);
    url.searchParams.set("redirect_to", redirectTo);
    return url.toString();
  } catch {
    return actionLink;
  }
}
