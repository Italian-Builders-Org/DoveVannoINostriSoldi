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
import { parseSupabaseCallbackCredentials } from "@/lib/boards/supabase-callback";

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

    const credentials = parseSupabaseCallbackCredentials(record);
    if (credentials.kind === "invalid") {
      return NextResponse.json({ error: credentials.error }, { status: 400 });
    }
    if (credentials.kind === "access_token") {
      const user = await supabaseUserFromAccessToken(credentials.accessToken);
      userId = user.userId;
      email = user.email;
    } else {
      const verified = await supabaseVerifyTokenHash(
        credentials.tokenHash,
        credentials.linkType,
      );
      userId = verified.userId;
      email = verified.email;
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
