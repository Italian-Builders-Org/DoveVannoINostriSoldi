import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { boardsAuthSecret } from "./auth-mode";

const COOKIE = "dvns_boards_session";
const MAX_AGE_SEC = 60 * 60 * 24 * 14;

export type BoardsSession = {
  email: string;
  userId: string;
  issuedAt: number;
};

function sign(secret: string, payload: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

function encodeSession(secret: string, session: BoardsSession): string {
  const body = Buffer.from(JSON.stringify(session), "utf8").toString("base64url");
  return `${body}.${sign(secret, body)}`;
}

function decodeSession(secret: string, raw: string): BoardsSession | null {
  const [body, signature] = raw.split(".");
  if (!body || !signature) return null;
  const expected = sign(secret, body);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as BoardsSession;
    if (
      typeof parsed.email !== "string" ||
      typeof parsed.userId !== "string" ||
      typeof parsed.issuedAt !== "number"
    ) {
      return null;
    }
    if (Date.now() - parsed.issuedAt > MAX_AGE_SEC * 1000) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function sessionCookieOptions(local: boolean) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    path: "/",
    maxAge: MAX_AGE_SEC,
    secure: !local,
  };
}

export async function readBoardsSession(): Promise<BoardsSession | null> {
  const secret = boardsAuthSecret();
  if (!secret) return null;
  const jar = await cookies();
  const raw = jar.get(COOKIE)?.value;
  if (!raw) return null;
  return decodeSession(secret, raw);
}

export function buildSessionCookieValue(session: BoardsSession): string | null {
  const secret = boardsAuthSecret();
  if (!secret) return null;
  return encodeSession(secret, session);
}

export function boardsSessionCookieName(): string {
  return COOKIE;
}

export function userIdFromEmail(email: string): string {
  const secret = boardsAuthSecret() ?? "boards";
  return createHmac("sha256", secret).update(`user:${email.toLowerCase()}`).digest("hex").slice(0, 32);
}
