import { NextResponse } from "next/server";
import { verifyBoardsOtp } from "@/lib/boards/otp";
import {
  boardsSessionCookieName,
  buildSessionCookieValue,
  sessionCookieOptions,
  userIdFromEmail,
} from "@/lib/boards/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON non valido." }, { status: 400 });
  }
  const record = typeof body === "object" && body ? (body as Record<string, unknown>) : {};
  const email = typeof record.email === "string" ? record.email : "";
  const code = typeof record.code === "string" ? record.code : "";
  const result = await verifyBoardsOtp(email, code);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  const value = buildSessionCookieValue({
    email: result.email,
    userId: result.userId || userIdFromEmail(result.email),
    issuedAt: Date.now(),
  });
  if (!value) {
    return NextResponse.json({ error: "Sessione non configurabile." }, { status: 503 });
  }

  const local = !process.env.VERCEL;
  const response = NextResponse.json({ ok: true, email: result.email, redirectTo: "/dashboard" });
  response.cookies.set(boardsSessionCookieName(), value, sessionCookieOptions(local));
  return response;
}
