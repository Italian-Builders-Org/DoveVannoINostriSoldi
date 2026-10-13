import { NextResponse } from "next/server";
import { readBoardsApiSession } from "@/lib/boards/api-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const { session, revoked } = await readBoardsApiSession();
  if (revoked) return revoked;
  if (!session) {
    return NextResponse.json(
      { authenticated: false },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  }
  return NextResponse.json(
    {
      authenticated: true,
      email: session.email,
      userId: session.userId,
    },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
