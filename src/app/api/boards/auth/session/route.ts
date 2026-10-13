import { NextResponse } from "next/server";
import { readBoardsSession } from "@/lib/boards/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await readBoardsSession();
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
