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

/**
 * Completa il login dopo il click sul magic/confirm link Supabase.
 * Accetta access_token (hash redirect) oppure token_hash+type (query).
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
    let userId: string;
    let email: string;

    const accessToken = typeof record.accessToken === "string" ? record.accessToken.trim() : "";
    const tokenHash = typeof record.tokenHash === "string" ? record.tokenHash.trim() : "";
    const type = typeof record.type === "string" ? record.type.trim() : "signup";

    if (accessToken.length >= 20) {
      const user = await supabaseUserFromAccessToken(accessToken);
      userId = user.userId;
      email = user.email;
    } else if (tokenHash.length >= 20) {
      const verified = await supabaseVerifyTokenHash(tokenHash, type || "signup");
      userId = verified.userId;
      email = verified.email;
    } else {
      return NextResponse.json(
        { error: "Token di accesso mancante. Riapri il link dall'email." },
        { status: 400 },
      );
    }

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
    return NextResponse.json({ error: message }, { status: 401 });
  }
}
