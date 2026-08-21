import {
  formatLeadEmail,
  leadEmailSubject,
  leadFromAddress,
  leadInbox,
  parseLead,
  RESEND_EMAILS_URL,
} from "@/lib/leads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "private, no-store" };

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: NO_STORE });
}

export async function POST(request: Request) {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return json({ ok: false, error: "Richiesta non valida" }, 400);
  }

  const parsed = parseLead(payload);
  if (parsed.status === "discarded") {
    return json({ ok: true });
  }
  if (parsed.status === "invalid") {
    return json({ ok: false, error: parsed.error }, 400);
  }

  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) {
    return json({ ok: false, error: "Invio non configurato sul deployment" }, 503);
  }

  const receivedAt = new Date();
  const response = await fetch(RESEND_EMAILS_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: leadFromAddress(),
      to: [leadInbox()],
      reply_to: parsed.lead.email,
      subject: leadEmailSubject(parsed.lead),
      text: formatLeadEmail(parsed.lead, receivedAt),
    }),
  });

  if (!response.ok) {
    return json({ ok: false, error: "Non siamo riusciti a inviare la richiesta" }, 502);
  }

  return json({ ok: true });
}

