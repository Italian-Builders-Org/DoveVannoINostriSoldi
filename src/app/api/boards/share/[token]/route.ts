import { NextResponse } from "next/server";
import { getSharedBoard, isCloudBoardsEnabled } from "@/lib/boards/cloud-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ token: string }> };

export async function GET(_request: Request, context: Ctx) {
  if (!isCloudBoardsEnabled()) {
    return NextResponse.json({ error: "Share non disponibile." }, { status: 503 });
  }
  const { token } = await context.params;
  if (!/^[a-zA-Z0-9_-]{24,64}$/u.test(token)) {
    return NextResponse.json({ error: "Token non valido." }, { status: 400 });
  }
  try {
    const board = await getSharedBoard(token);
    if (!board) return NextResponse.json({ error: "Link non valido o revocato." }, { status: 404 });
    return NextResponse.json(
      {
        title: board.meta.title,
        category: board.meta.category,
        updatedAt: board.meta.updatedAt,
        document: board.document,
      },
      { headers: { "Cache-Control": "public, max-age=60" } },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Lettura share non riuscita.";
    return NextResponse.json({ error: message }, { status: 503 });
  }
}
