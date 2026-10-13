import { NextResponse } from "next/server";
import {
  createCloudBoard,
  isCloudBoardsEnabled,
  listCloudBoards,
} from "@/lib/boards/cloud-store";
import { readBoardsSession } from "@/lib/boards/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await readBoardsSession();
  if (!session) {
    return NextResponse.json({ error: "Autenticazione richiesta." }, { status: 401 });
  }
  if (!isCloudBoardsEnabled()) {
    return NextResponse.json({ storage: "local", boards: [] as const });
  }
  try {
    const boards = await listCloudBoards(session.userId);
    return NextResponse.json({ storage: "cloud", boards });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Lettura board non riuscita.";
    return NextResponse.json({ error: message }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const session = await readBoardsSession();
  if (!session) {
    return NextResponse.json({ error: "Autenticazione richiesta." }, { status: 401 });
  }
  if (!isCloudBoardsEnabled()) {
    return NextResponse.json(
      { error: "Storage cloud non configurato. In anteprima locale usa localStorage." },
      { status: 503 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  const record = typeof body === "object" && body ? (body as Record<string, unknown>) : {};
  const title = typeof record.title === "string" ? record.title : undefined;
  const category = typeof record.category === "string" ? record.category : undefined;

  try {
    const created = await createCloudBoard(session.userId, { title, category });
    return NextResponse.json({ storage: "cloud", board: created.meta, document: created.document });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Creazione non riuscita.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
