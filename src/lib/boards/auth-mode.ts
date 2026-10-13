import "server-only";

export type BoardsAuthMode = "supabase" | "local_preview" | "unavailable";

/**
 * Supabase Boards when URL+keys are set; otherwise local OTP preview on
 * non-production hosts so /accedi and /dashboard are exercisable without the
 * second Supabase project. Production never falls back to local_preview.
 */
export function boardsAuthMode(): BoardsAuthMode {
  const url = (process.env.BOARDS_SUPABASE_URL ?? "").trim();
  const anon = (process.env.BOARDS_SUPABASE_ANON_KEY ?? "").trim();
  const secretKey = (process.env.BOARDS_SUPABASE_SECRET_KEY ?? "").trim();
  const authSecret = boardsAuthSecret();
  if (url.startsWith("https://") && anon.length >= 20 && secretKey.length >= 20 && authSecret) {
    return "supabase";
  }
  if (process.env.VERCEL_ENV === "production") {
    return "unavailable";
  }
  const secret = boardsAuthSecret();
  if (secret) return "local_preview";
  return "unavailable";
}

/** HMAC secret for local preview sessions and pending OTP cookies. */
export function boardsAuthSecret(): string | null {
  const dedicated = (process.env.BOARDS_AUTH_SECRET ?? "").trim();
  if (dedicated.length >= 32) return dedicated;
  // Dev-only fallback so `next dev` works without extra env; never on Vercel production.
  if (!process.env.VERCEL && process.env.NODE_ENV !== "production") {
    return "dvns-boards-local-preview-secret-do-not-use-in-prod";
  }
  return null;
}
