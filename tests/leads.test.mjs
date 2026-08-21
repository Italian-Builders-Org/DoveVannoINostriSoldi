import assert from "node:assert/strict";
import test from "node:test";
import "./helpers/register-ts-alias.mjs";

const {
  formatLeadEmail,
  leadEmailSubject,
  parseLead,
} = await import("../src/lib/leads.ts");
const { POST } = await import("../src/app/api/consulenza/route.ts");
const { CONTACT_EMAIL } = await import("../src/lib/site.ts");

const startedAt = Date.now() - 10_000;

const validLead = {
  name: "Anna Rossi",
  email: "anna.rossi@example.com",
  organization: "Comune di Esempio",
  organizationType: "pa",
  role: "Dirigente finanziario",
  topic: "lettura",
  message: "Vorremmo una lettura dei pagamenti comunali 2025 e un confronto con i capoluoghi vicini.",
  consent: true,
  startedAt,
};

function request(body, headers = {}) {
  return new Request("https://example.test/api/consulenza", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

test("parseLead accepts a complete consulting request", () => {
  const parsed = parseLead(validLead, startedAt + 10_000);
  assert.equal(parsed.status, "valid");
  if (parsed.status !== "valid") return;
  assert.equal(parsed.lead.organizationType, "pa");
  assert.equal(parsed.lead.topic, "lettura");
  assert.match(formatLeadEmail(parsed.lead, new Date("2026-08-21T12:00:00Z")), /Comune di Esempio/);
  assert.equal(leadEmailSubject(parsed.lead), "Richiesta consulenza: Comune di Esempio");
});

test("parseLead rejects a missing consent and a short message", () => {
  const withoutConsent = parseLead({ ...validLead, consent: false }, startedAt + 10_000);
  assert.equal(withoutConsent.status, "invalid");
  if (withoutConsent.status === "invalid") {
    assert.match(withoutConsent.error, /consenso/i);
  }

  const short = parseLead({ ...validLead, message: "Ciao" }, startedAt + 10_000);
  assert.equal(short.status, "invalid");
});

test("parseLead discards honeypot and too-fast submissions", () => {
  assert.equal(parseLead({ ...validLead, website: "https://spam.test" }, startedAt + 10_000).status, "discarded");
  assert.equal(parseLead({ ...validLead, startedAt: Date.now() }, Date.now()).status, "discarded");
});

test("consulting API rejects invalid JSON and incomplete leads", async () => {
  const invalidJson = await POST(
    new Request("https://example.test/api/consulenza", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{",
    }),
  );
  assert.equal(invalidJson.status, 400);

  const incomplete = await POST(request({ ...validLead, email: "not-an-email" }));
  assert.equal(incomplete.status, 400);
  assert.match((await incomplete.json()).error, /email/i);
});

test("consulting API pretends success on spam and needs Resend for real leads", async () => {
  const spam = await POST(request({ ...validLead, website: "http://bot.test" }));
  assert.equal(spam.status, 200);
  assert.deepEqual(await spam.json(), { ok: true });

  const previous = process.env.RESEND_API_KEY;
  delete process.env.RESEND_API_KEY;
  try {
    const unconfigured = await POST(request(validLead));
    assert.equal(unconfigured.status, 503);
    assert.match((await unconfigured.json()).error, /non configurato/i);
  } finally {
    if (previous === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = previous;
  }
});

test("consulting API sends a plain-text email to the configured inbox", async () => {
  const previousKey = process.env.RESEND_API_KEY;
  const previousInbox = process.env.LEAD_INBOX_EMAIL;
  process.env.RESEND_API_KEY = "re_test";
  process.env.LEAD_INBOX_EMAIL = CONTACT_EMAIL;

  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    calls.push({ url: String(input), init });
    return new Response(JSON.stringify({ id: "email_test" }), { status: 200 });
  };

  try {
    const response = await POST(request(validLead));
    assert.equal(response.status, 200);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "https://api.resend.com/emails");
    assert.match(calls[0].init.headers.Authorization, /Bearer re_test/);
    const sent = JSON.parse(calls[0].init.body);
    assert.deepEqual(sent.to, [CONTACT_EMAIL]);
    assert.equal(sent.reply_to, validLead.email);
    assert.match(sent.subject, /Comune di Esempio/);
    assert.match(sent.text, /Dirigente finanziario/);
    assert.equal(sent.html, undefined);
  } finally {
    globalThis.fetch = originalFetch;
    if (previousKey === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = previousKey;
    if (previousInbox === undefined) delete process.env.LEAD_INBOX_EMAIL;
    else process.env.LEAD_INBOX_EMAIL = previousInbox;
  }
});
