import { NextResponse } from "next/server";
import { boardsAuthMode } from "@/lib/boards/auth-mode";
import { isCloudBoardsEnabled } from "@/lib/boards/cloud-store";
import { readBoardsSession } from "@/lib/boards/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const authMode = boardsAuthMode();
  const cloud = isCloudBoardsEnabled() && authMode === "supabase";
  const session = await readBoardsSession();
  return NextResponse.json({
    authMode,
    storage: cloud ? "cloud" : "local",
    share: cloud,
    export: true,
    signedIn: Boolean(session),
  });
}
