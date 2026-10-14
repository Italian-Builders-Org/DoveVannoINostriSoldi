import { NextResponse } from "next/server";
import { requestBoardsOtp } from "@/lib/boards/otp";
import { boardsMagicLinkCallbackUrl } from "@/lib/boards/public-origin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function clientKey(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded && forwarded.length <= 64 ? forwarded : "local";
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON non valido." }, { status: 400 });
  }
  const email = typeof body === "object" && body && "email" in body ? String((body as { email: unknown }).email) : "";
  const redirectTo = boardsMagicLinkCallbackUrl(request.url);
  const result = await requestBoardsOtp(email, clientKey(request), { redirectTo });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  if (result.mode === "local_preview") {
    return NextResponse.json({
      ok: true,
      mode: result.mode,
      expiresInSec: result.expiresInSec,
      // Solo anteprima locale: in produzione il codice arriva via email (Resend).
      previewCode: result.previewCode,
      message: "Codice generato in anteprima locale (nessuna email inviata).",
    });
  }
  if ("localMagicLink" in result && result.localMagicLink) {
    return NextResponse.json({
      ok: true,
      mode: result.mode,
      expiresInSec: result.expiresInSec,
      magicLink: true,
      localMagicLink: result.localMagicLink,
      message:
        "Resend non configurato in locale: usa il pulsante qui sotto (nessuna email). Per l'invio via mail aggiungi RESEND_API_KEY e RESEND_FROM_EMAIL in .env.local.",
    });
  }
  return NextResponse.json({
    ok: true,
    mode: result.mode,
    expiresInSec: result.expiresInSec,
    magicLink: true,
    message:
      "Ti abbiamo inviato un link di accesso (subject: Accedi a DVNS Boards). Aprilo dall'email, anche Spam.",
  });
}
