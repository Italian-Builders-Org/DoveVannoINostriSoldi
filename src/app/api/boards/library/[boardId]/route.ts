import { NextResponse } from "next/server";
import { assertBoardDocument } from "@/lib/data/boards-document";
import {
  deleteCloudBoard,
  getCloudBoard,
  isCloudBoardsEnabled,
  saveCloudBoard,
  updateCloudBoardMeta,
} from "@/lib/boards/cloud-store";
import { requireBoardsApiSession } from "@/lib/boards/api-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ boardId: string }> };

function badId(boardId: string): boolean {
  return !/^board_[a-z0-9_]+$/u.test(boardId);
}

export async function GET(_request: Request, context: Ctx) {
  const auth = await requireBoardsApiSession();
  if (auth.response) return auth.response;
  const session = auth.session;
  if (!isCloudBoardsEnabled()) {
    return NextResponse.json({ storage: "local" });
  }
  const { boardId } = await context.params;
  if (badId(boardId)) {
    return NextResponse.json({ error: "Board id non valido." }, { status: 400 });
  }
  try {
    const board = await getCloudBoard(session.userId, boardId);
    if (!board) return NextResponse.json({ error: "Board non trovata." }, { status: 404 });
    return NextResponse.json({ storage: "cloud", board: board.meta, document: board.document });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Lettura non riuscita.";
    return NextResponse.json({ error: message }, { status: 503 });
  }
}

export async function PUT(request: Request, context: Ctx) {
  const auth = await requireBoardsApiSession();
  if (auth.response) return auth.response;
  const session = auth.session;
  if (!isCloudBoardsEnabled()) {
    return NextResponse.json({ error: "Storage cloud non configurato." }, { status: 503 });
  }
  const { boardId } = await context.params;
  if (badId(boardId)) {
    return NextResponse.json({ error: "Board id non valido." }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON non valido." }, { status: 400 });
  }
  const record = typeof body === "object" && body ? (body as Record<string, unknown>) : {};
  try {
    const document = assertBoardDocument(record.document);
    const category = typeof record.category === "string" ? record.category : undefined;
    const meta = await saveCloudBoard(session.userId, boardId, document, category);
    if (!meta) return NextResponse.json({ error: "Board non trovata." }, { status: 404 });
    return NextResponse.json({ storage: "cloud", board: meta, document });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Salvataggio non riuscito.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function PATCH(request: Request, context: Ctx) {
  const auth = await requireBoardsApiSession();
  if (auth.response) return auth.response;
  const session = auth.session;
  if (!isCloudBoardsEnabled()) {
    return NextResponse.json({ error: "Storage cloud non configurato." }, { status: 503 });
  }
  const { boardId } = await context.params;
  if (badId(boardId)) {
    return NextResponse.json({ error: "Board id non valido." }, { status: 400 });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON non valido." }, { status: 400 });
  }
  const record = typeof body === "object" && body ? (body as Record<string, unknown>) : {};
  try {
    const meta = await updateCloudBoardMeta(session.userId, boardId, {
      title: typeof record.title === "string" ? record.title : undefined,
      category: typeof record.category === "string" ? record.category : undefined,
    });
    if (!meta) return NextResponse.json({ error: "Board non trovata." }, { status: 404 });
    return NextResponse.json({ storage: "cloud", board: meta });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Aggiornamento non riuscito.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(_request: Request, context: Ctx) {
  const auth = await requireBoardsApiSession();
  if (auth.response) return auth.response;
  const session = auth.session;
  if (!isCloudBoardsEnabled()) {
    return NextResponse.json({ error: "Storage cloud non configurato." }, { status: 503 });
  }
  const { boardId } = await context.params;
  if (badId(boardId)) {
    return NextResponse.json({ error: "Board id non valido." }, { status: 400 });
  }
  try {
    await deleteCloudBoard(session.userId, boardId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Eliminazione non riuscita.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
