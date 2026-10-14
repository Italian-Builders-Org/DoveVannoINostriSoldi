import { NextResponse } from "next/server";
import { boardsSessionCookieName, sessionCookieOptions } from "@/lib/boards/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const local = !process.env.VERCEL;
  const response = NextResponse.json({ ok: true, redirectTo: "/accedi" });
  response.cookies.set(boardsSessionCookieName(), "", {
    ...sessionCookieOptions(local),
    maxAge: 0,
  });
  return response;
}
