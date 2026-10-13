import { NextResponse } from "next/server";
import { ensureCloudProfile } from "@/lib/boards/cloud-store";
import {
  boardsSessionCookieName,
  buildSessionCookieValue,
  sessionCookieOptions,
} from "@/lib/boards/session";
import {
  supabaseUserFromAccessToken,
  supabaseVerifyTokenHash,
} from "@/lib/boards/supabase";
import { boardsAuthMode } from "@/lib/boards/auth-mode";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SUPABASE_LINK_TYPES = new Set([
  "signup",
  "magiclink",
  "email",
  "invite",
  "recovery",
]);

type VerifiedUser = { userId: string; email: string };

/**
 * Completa il login dopo il click sul magic/confirm link Supabase.
 * Il body del client porta solo il materiale del link; la sessione DVNS
 * viene emessa solo dopo la verifica Auth di Supabase.
 */
export async function POST(request: Request) {
  if (boardsAuthMode() !== "supabase") {
    return NextResponse.json({ error: "Login cloud non attivo." }, { status: 503 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON non valido." }, { status: 400 });
  }
  const record = typeof body === "object" && body ? (body as Record<string, unknown>) : {};

  try {
    const accessToken = typeof record.accessToken === "string" ? record.accessToken.trim() : "";
    const tokenHash = typeof record.tokenHash === "string" ? record.tokenHash.trim() : "";
    const typeRaw = typeof record.type === "string" ? record.type.trim() : "magiclink";
    const type = SUPABASE_LINK_TYPES.has(typeRaw) ? typeRaw : "magiclink";

    // Verifica sempre con Supabase Auth (non trust del client).
    // codeql[js/user-controlled-bypass]: accessToken/tokenHash are credentials
    // verified by Supabase before any DVNS session cookie is minted.
    const verified: VerifiedUser = accessToken
      ? await supabaseUserFromAccessToken(accessToken)
      : tokenHash
        ? await supabaseVerifyTokenHash(tokenHash, type)
        : (() => {
          throw new Error("Token di accesso mancante. Riapri il link dall'email.");
        })();

    const { userId, email } = verified;
    await ensureCloudProfile(userId, email);

    const value = buildSessionCookieValue({
      email,
      userId,
      issuedAt: Date.now(),
    });
    if (!value) {
      return NextResponse.json({ error: "Sessione non configurabile." }, { status: 503 });
    }

    const local = !process.env.VERCEL;
    const response = NextResponse.json({ ok: true, email, redirectTo: "/dashboard" });
    response.cookies.set(boardsSessionCookieName(), value, sessionCookieOptions(local));
    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Accesso non riuscito.";
    const status = /mancante/iu.test(message) ? 400 : 401;
    return NextResponse.json({ error: message }, { status });
  }
}
