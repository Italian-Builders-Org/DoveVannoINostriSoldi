import { NextResponse } from "next/server";
import { clientAddress } from "@/lib/report/rate-limit";
import { requireBoardsApiSession } from "@/lib/boards/api-session";
import {
  sendBoardsFeedbackEmail,
  type BoardsFeedbackKind,
} from "@/lib/boards/feedback-email";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const KINDS = new Set<BoardsFeedbackKind>(["problema", "feedback", "idea"]);

export async function POST(request: Request) {
  const auth = await requireBoardsApiSession();
  if (auth.response) return auth.response;
  const session = auth.session;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON non valido." }, { status: 400 });
  }

  const record = typeof body === "object" && body ? (body as Record<string, unknown>) : {};
  const kindRaw = typeof record.kind === "string" ? record.kind : "feedback";
  if (!KINDS.has(kindRaw as BoardsFeedbackKind)) {
    return NextResponse.json({ error: "Tipo segnalazione non valido." }, { status: 400 });
  }
  const message = typeof record.message === "string" ? record.message : "";
  const boardId = typeof record.boardId === "string" ? record.boardId : undefined;
  const pageUrl = typeof record.pageUrl === "string" ? record.pageUrl : undefined;
  const rateKey = clientAddress(request) ?? session.userId;

  const result = await sendBoardsFeedbackEmail(
    {
      kind: kindRaw as BoardsFeedbackKind,
      message,
      boardId,
      pageUrl,
      fromEmail: session.email,
      userId: session.userId,
    },
    rateKey,
  );

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json({ ok: true });
}
