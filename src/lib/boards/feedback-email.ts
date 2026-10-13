import "server-only";
import { SlidingWindowLimiter } from "@/lib/report/rate-limit";
import { boardsResendFromAddress } from "./resend-from";

const FEEDBACK_TO =
  (process.env.BOARDS_FEEDBACK_TO ?? "").trim() || "gagliardidomenico46@gmail.com";

const limiter = new SlidingWindowLimiter({ windowMs: 15 * 60_000, max: 5 });

export type BoardsFeedbackKind = "problema" | "feedback" | "idea";

export type BoardsFeedbackInput = {
  kind: BoardsFeedbackKind;
  message: string;
  boardId?: string;
  pageUrl?: string;
  fromEmail: string;
  userId: string;
};

function resendConfig(): { apiKey: string; from: string } | null {
  const apiKey = (process.env.RESEND_API_KEY ?? "").trim();
  const from = (process.env.RESEND_FROM_EMAIL ?? "").trim();
  if (apiKey.length < 10 || !from.includes("@")) return null;
  return { apiKey, from };
}

export function boardsFeedbackEmailConfigured(): boolean {
  return resendConfig() !== null;
}

export function boardsFeedbackDestination(): string {
  return FEEDBACK_TO;
}

function escapeText(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function kindLabel(kind: BoardsFeedbackKind): string {
  if (kind === "problema") return "Problema";
  if (kind === "idea") return "Idea";
  return "Feedback";
}

export async function sendBoardsFeedbackEmail(
  input: BoardsFeedbackInput,
  rateKey: string,
): Promise<{ ok: true } | { ok: false; error: string; status: number }> {
  const message = input.message.trim();
  if (message.length < 10) {
    return { ok: false, error: "Scrivi almeno 10 caratteri.", status: 400 };
  }
  if (message.length > 4_000) {
    return { ok: false, error: "Messaggio troppo lungo (max 4000).", status: 400 };
  }
  if (!limiter.consume(`feedback:${rateKey}`)) {
    return { ok: false, error: "Troppe segnalazioni: riprova tra qualche minuto.", status: 429 };
  }

  const resend = resendConfig();
  if (!resend) {
    return {
      ok: false,
      error: "Invio email non configurato (RESEND_API_KEY / RESEND_FROM_EMAIL).",
      status: 503,
    };
  }

  const kind = kindLabel(input.kind);
  const boardId = (input.boardId ?? "").trim().slice(0, 80);
  const pageUrl = (input.pageUrl ?? "").trim().slice(0, 500);
  const fromEmail = input.fromEmail.trim().toLowerCase();
  const subject = `[DVNS Boards] ${kind}${boardId ? ` · ${boardId}` : ""}`;

  const text = [
    `${kind} da ${fromEmail}`,
    boardId ? `Board: ${boardId}` : null,
    pageUrl ? `Pagina: ${pageUrl}` : null,
    `User id: ${input.userId}`,
    "",
    message,
  ]
    .filter((line) => line !== null)
    .join("\n");

  const html = `<!DOCTYPE html>
<html lang="it"><body style="font-family:system-ui,sans-serif;line-height:1.45;color:#182b3a;">
  <p><strong>${escapeText(kind)}</strong> da <code>${escapeText(fromEmail)}</code></p>
  ${boardId ? `<p>Board: <code>${escapeText(boardId)}</code></p>` : ""}
  ${pageUrl ? `<p>Pagina: <a href="${escapeText(pageUrl)}">${escapeText(pageUrl)}</a></p>` : ""}
  <pre style="white-space:pre-wrap;background:#f4f6f8;padding:12px;border:1px solid #d5dde6;">${escapeText(message)}</pre>
</body></html>`;

  const from = boardsResendFromAddress(resend.from);

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resend.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [FEEDBACK_TO],
      reply_to: fromEmail,
      subject,
      text,
      html,
    }),
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(12_000),
  });

  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    return { ok: false, error: "Invio non riuscito. Riprova tra poco.", status: 502 };
  }
  await response.body?.cancel().catch(() => undefined);
  return { ok: true };
}
