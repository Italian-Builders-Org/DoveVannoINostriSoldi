import "server-only";
import { NextResponse } from "next/server";
import { cloudProfileExists, isCloudBoardsEnabled } from "./cloud-store";
import {
  boardsSessionCookieName,
  readBoardsSession,
  sessionCookieOptions,
  type BoardsSession,
} from "./session";

export type BoardsApiSessionRead =
  | { session: BoardsSession; revoked: null }
  | { session: null; revoked: null }
  | { session: null; revoked: NextResponse };

function sessionRevokedResponse(): NextResponse {
  const local = !process.env.VERCEL;
  const response = NextResponse.json({ error: "Sessione scaduta." }, { status: 401 });
  response.cookies.set(boardsSessionCookieName(), "", {
    ...sessionCookieOptions(local),
    maxAge: 0,
  });
  return response;
}

/**
 * Legge la sessione firmata e, in cloud, verifica che il profilo esista ancora
 * (revoca immediata dopo cancellazione account lato DB).
 */
export async function readBoardsApiSession(): Promise<BoardsApiSessionRead> {
  const session = await readBoardsSession();
  if (!session) return { session: null, revoked: null };
  if (!isCloudBoardsEnabled()) return { session, revoked: null };
  try {
    const exists = await cloudProfileExists(session.userId);
    if (exists) return { session, revoked: null };
  } catch {
    return { session, revoked: null };
  }
  return { session: null, revoked: sessionRevokedResponse() };
}

export async function requireBoardsApiSession(): Promise<
  { session: BoardsSession; response: null } | { session: null; response: NextResponse }
> {
  const read = await readBoardsApiSession();
  if (read.revoked) return { session: null, response: read.revoked };
  if (!read.session) {
    return {
      session: null,
      response: NextResponse.json({ error: "Autenticazione richiesta." }, { status: 401 }),
    };
  }
  return { session: read.session, response: null };
}
