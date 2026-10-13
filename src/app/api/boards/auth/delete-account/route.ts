import { NextResponse } from "next/server";
import { boardsAuthMode } from "@/lib/boards/auth-mode";
import { deleteCloudAccountData, isCloudBoardsEnabled } from "@/lib/boards/cloud-store";
import {
  boardsSessionCookieName,
  readBoardsSession,
  sessionCookieOptions,
} from "@/lib/boards/session";
import { supabaseAdminDeleteUser } from "@/lib/boards/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Conferma tipizzata: evita click accidentali. */
export const DELETE_ACCOUNT_CONFIRMATION = "ELIMINA";

export async function POST(request: Request) {
  const session = await readBoardsSession();
  if (!session) {
    return NextResponse.json({ error: "Autenticazione richiesta." }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON non valido." }, { status: 400 });
  }
  const record = typeof body === "object" && body ? (body as Record<string, unknown>) : {};
  const confirm = typeof record.confirm === "string" ? record.confirm.trim() : "";
  if (confirm !== DELETE_ACCOUNT_CONFIRMATION) {
    return NextResponse.json(
      {
        error: `Per confermare digita esattamente ${DELETE_ACCOUNT_CONFIRMATION}.`,
      },
      { status: 400 },
    );
  }

  const mode = boardsAuthMode();
  if (mode === "unavailable") {
    return NextResponse.json({ error: "Servizio account non disponibile." }, { status: 503 });
  }

  try {
    if (mode === "supabase" && isCloudBoardsEnabled()) {
      await deleteCloudAccountData(session.userId);
      await supabaseAdminDeleteUser(session.userId);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Cancellazione non riuscita.";
    return NextResponse.json({ error: message }, { status: 502 });
  }

  const local = !process.env.VERCEL;
  const response = NextResponse.json({
    ok: true,
    redirectTo: "/accedi",
    clearLocalUserId: session.userId,
  });
  response.cookies.set(boardsSessionCookieName(), "", {
    ...sessionCookieOptions(local),
    maxAge: 0,
  });
  return response;
}
