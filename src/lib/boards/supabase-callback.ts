import "server-only";

const SUPABASE_LINK_TYPES = new Set([
  "signup",
  "magiclink",
  "recovery",
  "email",
  "email_change",
  "invite",
]);

export type SupabaseCallbackCredentials =
  | { kind: "access_token"; accessToken: string }
  | { kind: "token_hash"; tokenHash: string; linkType: string }
  | { kind: "invalid"; error: string };

/** Valida il body del callback magic link (niente scelta di percorso guidata solo da lunghezza). */
export function parseSupabaseCallbackCredentials(
  record: Record<string, unknown>,
): SupabaseCallbackCredentials {
  const accessToken = typeof record.accessToken === "string" ? record.accessToken.trim() : "";
  const tokenHash = typeof record.tokenHash === "string" ? record.tokenHash.trim() : "";
  const hasAccess = accessToken.length > 0;
  const hasHash = tokenHash.length > 0;

  if (hasAccess && hasHash) {
    return { kind: "invalid", error: "Indica un solo metodo di accesso (token o hash)." };
  }

  if (hasAccess) {
    const parts = accessToken.split(".");
    const jwtLike =
      parts.length === 3
      && parts.every((part) => part.length > 0 && part.length <= 2048 && /^[\w-]+$/u.test(part));
    if (!jwtLike) {
      return { kind: "invalid", error: "Token di accesso non valido." };
    }
    return { kind: "access_token", accessToken };
  }

  if (hasHash) {
    if (tokenHash.length < 20 || tokenHash.length > 512 || !/^[A-Za-z0-9_-]+$/u.test(tokenHash)) {
      return { kind: "invalid", error: "Hash del link non valido." };
    }
    const rawType = typeof record.type === "string" ? record.type.trim() : "";
    const linkType = SUPABASE_LINK_TYPES.has(rawType) ? rawType : "email";
    return { kind: "token_hash", tokenHash, linkType };
  }

  return {
    kind: "invalid",
    error: "Token di accesso mancante. Riapri il link dall'email.",
  };
}
