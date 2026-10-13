import "server-only";
import { boardsSupabaseConfig } from "./supabase";

type GeneratedMagicLink = {
  actionLink: string;
  hashedToken: string;
  verificationType: string;
};

function resendConfig(): { apiKey: string; from: string } | null {
  const apiKey = (process.env.RESEND_API_KEY ?? "").trim();
  const from = (process.env.RESEND_FROM_EMAIL ?? "").trim();
  if (apiKey.length < 10 || !from.includes("@")) return null;
  return { apiKey, from };
}

export function boardsMagicLinkEmailConfigured(): boolean {
  return boardsSupabaseConfig() !== null && resendConfig() !== null;
}

async function readJson(response: Response, maxBytes = 200_000): Promise<unknown> {
  if (!response.body) return null;
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let text = "";
  let size = 0;
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    size += next.value.byteLength;
    if (size > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new Error("Risposta troppo grande");
    }
    text += decoder.decode(next.value, { stream: true });
  }
  text += decoder.decode();
  if (!text) return null;
  return JSON.parse(text);
}

async function adminFetch(path: string, init: { method: string; body?: unknown }): Promise<{
  ok: boolean;
  status: number;
  data: unknown;
}> {
  const config = boardsSupabaseConfig();
  if (!config) throw new Error("Supabase Boards non configurato");
  const response = await fetch(`${config.url}${path}`, {
    method: init.method,
    headers: {
      apikey: config.secretKey,
      Authorization: `Bearer ${config.secretKey}`,
      "Content-Type": "application/json",
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
  });
  const data = await readJson(response);
  return { ok: response.ok, status: response.status, data };
}

/** Crea l'utente se manca (senza password). */
async function ensureAuthUser(email: string): Promise<void> {
  const created = await adminFetch("/auth/v1/admin/users", {
    method: "POST",
    body: {
      email,
      email_confirm: false,
    },
  });
  if (created.ok || created.status === 422) return;
  // 422 = già esiste / vincolo; altri errori restano
  const record = created.data && typeof created.data === "object"
    ? (created.data as Record<string, unknown>)
    : {};
  const msg =
    typeof record.msg === "string"
      ? record.msg
      : typeof record.error_description === "string"
        ? record.error_description
        : typeof record.message === "string"
          ? record.message
          : "";
  if (/already|exists|registered/iu.test(msg)) return;
  if (!created.ok) {
    throw new Error(msg || "Creazione utente Auth non riuscita.");
  }
}

function parseGenerateLink(payload: unknown): GeneratedMagicLink {
  const root = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  const props =
    root.properties && typeof root.properties === "object"
      ? (root.properties as Record<string, unknown>)
      : root;
  const actionLink = typeof props.action_link === "string" ? props.action_link : "";
  const hashedToken = typeof props.hashed_token === "string" ? props.hashed_token : "";
  const verificationType =
    typeof props.verification_type === "string" ? props.verification_type : "magiclink";
  if (!actionLink.startsWith("http")) {
    throw new Error("Link di accesso non generato da Supabase.");
  }
  return { actionLink, hashedToken, verificationType };
}

async function generateMagicLink(email: string, redirectTo: string): Promise<GeneratedMagicLink> {
  await ensureAuthUser(email);
  const generated = await adminFetch("/auth/v1/admin/generate_link", {
    method: "POST",
    body: {
      type: "magiclink",
      email,
      redirect_to: redirectTo,
    },
  });
  if (!generated.ok) {
    const record = generated.data && typeof generated.data === "object"
      ? (generated.data as Record<string, unknown>)
      : {};
    const msg =
      typeof record.msg === "string"
        ? record.msg
        : typeof record.error_description === "string"
          ? record.error_description
          : "generate_link fallita";
    throw new Error(msg);
  }
  return parseGenerateLink(generated.data);
}

function magicLinkHtml(email: string, actionLink: string): string {
  const safeEmail = email.replace(/</gu, "&lt;").replace(/>/gu, "&gt;");
  const safeLink = actionLink.replace(/"/gu, "&quot;");
  return `<!DOCTYPE html>
<html lang="it">
<body style="margin:0;padding:0;background:#f3f5f7;font-family:Geist,Helvetica,Arial,sans-serif;line-height:1.5;color:#182b3a;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f3f5f7;padding:28px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#ffffff;border:1px solid #c5cfd8;">
        <tr>
          <td style="height:4px;background:#b42332;font-size:0;line-height:0;">&nbsp;</td>
        </tr>
        <tr><td style="padding:28px 28px 8px;">
          <p style="margin:0 0 10px;font-size:11px;letter-spacing:0.1em;text-transform:uppercase;font-weight:700;color:#b42332;">Dove vanno i nostri soldi</p>
          <p style="margin:0 0 6px;font-size:13px;letter-spacing:0.04em;text-transform:uppercase;color:#536474;">DVNS Boards</p>
          <h1 style="margin:0 0 14px;font-size:22px;font-weight:650;letter-spacing:-0.02em;color:#182b3a;">Accedi senza password</h1>
          <p style="margin:0 0 18px;color:#536474;font-size:15px;">Hai chiesto di entrare nel laboratorio sui dati pubblici. Clicca il pulsante qui sotto.</p>
          <p style="margin:0 0 24px;">
            <a href="${safeLink}" style="display:inline-block;background:#b42332;color:#ffffff;text-decoration:none;padding:12px 18px;font-weight:650;font-size:15px;">Accedi a DVNS Boards</a>
          </p>
          <p style="margin:0 0 8px;font-size:13px;color:#536474;">Il link scade in poco tempo e vale solo per ${safeEmail}.</p>
          <p style="margin:0 0 8px;font-size:13px;color:#536474;">Se non hai richiesto tu l'accesso, ignora questa email.</p>
        </td></tr>
        <tr><td style="padding:14px 28px 22px;border-top:1px solid #e5eaf0;font-size:12px;color:#71808e;">
          Registro pubblico · dati ufficiali verificati · nessuna password
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

async function sendResendEmail(to: string, actionLink: string): Promise<void> {
  const resend = resendConfig();
  if (!resend) {
    throw new Error(
      "Mancano RESEND_API_KEY e RESEND_FROM_EMAIL in .env.local (stesse chiavi del SMTP su Supabase).",
    );
  }
  const from = resend.from.includes("<")
    ? resend.from
    : `DVNS Boards <${resend.from}>`;
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resend.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [to],
      subject: "Accedi a DVNS Boards",
      html: magicLinkHtml(to, actionLink),
      text: `Accedi a DVNS Boards (nessuna password):\n\n${actionLink}\n\nIl link scade in poco tempo e vale solo per ${to}.`,
    }),
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error("Invio email Resend non riuscito. Controlla API key e mittente verificato.");
  }
  await response.body?.cancel().catch(() => undefined);
}

/** Genera il magic link (service role), senza inviare email. */
export async function createBoardsMagicLink(
  email: string,
  redirectTo: string,
): Promise<{ actionLink: string }> {
  const generated = await generateMagicLink(email, redirectTo);
  return { actionLink: generated.actionLink };
}

/**
 * Magic link senza passare dai template Supabase.
 * Genera il link con service role e lo spedisce via Resend.
 */
export async function sendBoardsMagicLinkEmail(email: string, redirectTo: string): Promise<void> {
  if (!resendConfig()) {
    throw new Error(
      "Per il magic link aggiungi RESEND_API_KEY e RESEND_FROM_EMAIL in .env.local, poi riavvia il server.",
    );
  }
  const generated = await generateMagicLink(email, redirectTo);
  await sendResendEmail(email, generated.actionLink);
}
