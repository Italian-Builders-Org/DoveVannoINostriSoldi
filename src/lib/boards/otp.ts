import "server-only";
import { createHash, createHmac, randomInt, timingSafeEqual } from "node:crypto";
import { boardsAuthMode, boardsAuthSecret } from "./auth-mode";
import { SlidingWindowLimiter } from "../report/rate-limit";

const OTP_TTL_MS = 10 * 60_000;
const MAX_ATTEMPTS = 5;

type PendingOtp = {
  email: string;
  codeHash: string;
  expiresAt: number;
  attempts: number;
};

/** In-memory pending codes for local_preview (single Node instance). */
const pending = new Map<string, PendingOtp>();
const requestLimiter = new SlidingWindowLimiter({ windowMs: 60_000, max: 8 });

export function normalizeEmail(raw: string): string | null {
  const email = raw.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email) || email.length > 254) return null;
  return email;
}

function hashCode(secret: string, email: string, code: string): string {
  return createHmac("sha256", secret).update(`otp:${email}:${code}`).digest("hex");
}

function pendingKey(email: string): string {
  return createHash("sha256").update(email).digest("hex");
}

export type RequestOtpResult =
  | { ok: true; mode: "local_preview"; previewCode: string; expiresInSec: number }
  | {
    ok: true;
    mode: "supabase";
    expiresInSec: number;
    magicLink: true;
    /** Solo localhost senza Resend: link cliccabile in pagina. */
    localMagicLink?: string;
  }
  | { ok: false; error: string; status: number };

export async function requestBoardsOtp(
  emailRaw: string,
  clientKey: string,
  options: { redirectTo?: string } = {},
): Promise<RequestOtpResult> {
  const mode = boardsAuthMode();
  if (mode === "unavailable") {
    return { ok: false, error: "Accesso non configurato su questo ambiente.", status: 503 };
  }
  const email = normalizeEmail(emailRaw);
  if (!email) return { ok: false, error: "Indica un indirizzo email valido.", status: 400 };

  if (!requestLimiter.consume(clientKey)) {
    return { ok: false, error: "Troppe richieste. Riprova tra un minuto.", status: 429 };
  }

  if (mode === "supabase") {
    try {
      if (!options.redirectTo) {
        return { ok: false, error: "Redirect di accesso mancante.", status: 500 };
      }
      const {
        sendBoardsMagicLinkEmail,
        boardsMagicLinkEmailConfigured,
        createBoardsMagicLink,
      } = await import("./magic-link-email");

      // Preferisci Resend (bypass template Supabase). In locale senza Resend:
      // genera comunque il link e mostralo in pagina.
      if (boardsMagicLinkEmailConfigured()) {
        await sendBoardsMagicLinkEmail(email, options.redirectTo);
        return {
          ok: true,
          mode: "supabase",
          expiresInSec: Math.floor(OTP_TTL_MS / 1000),
          magicLink: true,
        };
      }

      if (process.env.VERCEL) {
        return {
          ok: false,
          error:
            "Mancano RESEND_API_KEY e RESEND_FROM_EMAIL. Servono per inviare il magic link.",
          status: 503,
        };
      }

      const { actionLink } = await createBoardsMagicLink(email, options.redirectTo);
      const devOnlyLocalLink =
        process.env.NODE_ENV !== "production" && !process.env.VERCEL ? actionLink : undefined;
      return {
        ok: true,
        mode: "supabase",
        expiresInSec: Math.floor(OTP_TTL_MS / 1000),
        magicLink: true,
        ...(devOnlyLocalLink ? { localMagicLink: devOnlyLocalLink } : {}),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Invio email non riuscito.";
      return { ok: false, error: message, status: 503 };
    }
  }

  const secret = boardsAuthSecret();
  if (!secret) return { ok: false, error: "Accesso non configurato.", status: 503 };

  const code = String(randomInt(100000, 1000000));
  const key = pendingKey(email);
  pending.set(key, {
    email,
    codeHash: hashCode(secret, email, code),
    expiresAt: Date.now() + OTP_TTL_MS,
    attempts: 0,
  });

  return {
    ok: true,
    mode: "local_preview",
    previewCode: code,
    expiresInSec: Math.floor(OTP_TTL_MS / 1000),
  };
}

export type VerifyOtpResult =
  | { ok: true; email: string; userId: string }
  | { ok: false; error: string; status: number };

export async function verifyBoardsOtp(emailRaw: string, codeRaw: string): Promise<VerifyOtpResult> {
  const mode = boardsAuthMode();
  if (mode === "unavailable") {
    return { ok: false, error: "Accesso non configurato su questo ambiente.", status: 503 };
  }
  const email = normalizeEmail(emailRaw);
  const code = codeRaw.trim().replace(/\s+/g, "");
  if (!email) return { ok: false, error: "Indica un indirizzo email valido.", status: 400 };
  if (!/^\d{6}$/u.test(code)) return { ok: false, error: "Il codice deve avere sei cifre.", status: 400 };

  if (mode === "supabase") {
    try {
      const { supabaseVerifyEmailOtp } = await import("./supabase");
      const { ensureCloudProfile } = await import("./cloud-store");
      const verified = await supabaseVerifyEmailOtp(email, code);
      await ensureCloudProfile(verified.userId, verified.email);
      return { ok: true, email: verified.email, userId: verified.userId };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Verifica non riuscita.";
      return { ok: false, error: message, status: 401 };
    }
  }

  const secret = boardsAuthSecret();
  if (!secret) return { ok: false, error: "Accesso non configurato.", status: 503 };

  const key = pendingKey(email);
  const row = pending.get(key);
  if (!row || row.email !== email) {
    return { ok: false, error: "Nessun codice attivo per questa email. Richiedine uno nuovo.", status: 400 };
  }
  if (row.expiresAt < Date.now()) {
    pending.delete(key);
    return { ok: false, error: "Codice scaduto. Richiedine uno nuovo.", status: 400 };
  }
  if (row.attempts >= MAX_ATTEMPTS) {
    pending.delete(key);
    return { ok: false, error: "Troppi tentativi. Richiedi un nuovo codice.", status: 429 };
  }

  row.attempts += 1;
  const expected = Buffer.from(row.codeHash, "hex");
  const actual = Buffer.from(hashCode(secret, email, code), "hex");
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    pending.set(key, row);
    return { ok: false, error: "Codice non valido.", status: 401 };
  }
  pending.delete(key);
  const { userIdFromEmail } = await import("./session");
  return { ok: true, email, userId: userIdFromEmail(email) };
}
