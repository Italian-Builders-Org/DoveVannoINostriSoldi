import { NextResponse } from "next/server";
import {
  createCloudShare,
  isCloudBoardsEnabled,
  listCloudShares,
  revokeCloudShare,
} from "@/lib/boards/cloud-store";
import { requireBoardsApiSession } from "@/lib/boards/api-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = await requireBoardsApiSession();
  if (auth.response) return auth.response;
  const session = auth.session;
  if (!isCloudBoardsEnabled()) {
    return NextResponse.json({ error: "Share richiede storage cloud." }, { status: 503 });
  }
  const boardId = new URL(request.url).searchParams.get("boardId") ?? "";
  if (!/^board_[a-z0-9_]+$/u.test(boardId)) {
    return NextResponse.json({ error: "boardId non valido." }, { status: 400 });
  }
  try {
    const shares = await listCloudShares(session.userId, boardId);
    return NextResponse.json({ shares });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Lettura share non riuscita.";
    return NextResponse.json({ error: message }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const auth = await requireBoardsApiSession();
  if (auth.response) return auth.response;
  const session = auth.session;
  if (!isCloudBoardsEnabled()) {
    return NextResponse.json(
      { error: "La condivisione richiede Auth cloud (Supabase Boards)." },
      { status: 503 },
    );
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON non valido." }, { status: 400 });
  }
  const record = typeof body === "object" && body ? (body as Record<string, unknown>) : {};
  const boardId = typeof record.boardId === "string" ? record.boardId : "";
  if (!/^board_[a-z0-9_]+$/u.test(boardId)) {
    return NextResponse.json({ error: "boardId non valido." }, { status: 400 });
  }
  try {
    const share = await createCloudShare(session.userId, boardId);
    const origin = new URL(request.url).origin;
    return NextResponse.json({
      token: share.token,
      createdAt: share.createdAt,
      url: `${origin}/condividi/${share.token}`,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Creazione share non riuscita.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(request: Request) {
  const auth = await requireBoardsApiSession();
  if (auth.response) return auth.response;
  const session = auth.session;
  if (!isCloudBoardsEnabled()) {
    return NextResponse.json({ error: "Share richiede storage cloud." }, { status: 503 });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON non valido." }, { status: 400 });
  }
  const token =
    typeof body === "object" && body && typeof (body as Record<string, unknown>).token === "string"
      ? String((body as Record<string, unknown>).token)
      : "";
  if (!/^[a-zA-Z0-9_-]{24,64}$/u.test(token)) {
    return NextResponse.json({ error: "token non valido." }, { status: 400 });
  }
  try {
    const ok = await revokeCloudShare(session.userId, token);
    if (!ok) return NextResponse.json({ error: "Share non trovata." }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Revoca non riuscita.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
