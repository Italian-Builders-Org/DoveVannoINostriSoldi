import assert from "node:assert/strict";
import { generateKeyPairSync, randomUUID } from "node:crypto";
import test from "node:test";
import "./helpers/register-ts-alias.mjs";

const { POST } = await import("../src/app/api/segnalazioni/route.ts");

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const PEM = privateKey.export({ type: "pkcs1", format: "pem" });
const ISSUES_PATH = "/repos/Italian-Builders-Org/DoveVannoINostriSoldi/issues";
const ISSUE_URL = (number) => `https://github.com/Italian-Builders-Org/DoveVannoINostriSoldi/issues/${number}`;

let addressCounter = 0;
function freshAddress() {
  addressCounter += 1;
  return `203.0.113.${addressCounter}`;
}

function payload(overrides = {}) {
  const now = Date.now();
  return {
    clientKey: randomUUID(),
    category: "bug",
    observed: "Il totale non torna.",
    expected: "Il totale deve coincidere.",
    steps: "1. Apri la pagina\n2. Confronta",
    page: { path: "/spese", title: "Spese" },
    context: {
      reportedAt: new Date(now).toISOString(),
      openedAt: new Date(now - 15_000).toISOString(),
      viewport: { width: 1280, height: 800 },
      userAgent: "Mozilla/5.0 Test",
    },
    website: "",
    ...overrides,
  };
}

function request(body, { headers = {}, url = "https://example.test/api/segnalazioni", address = freshAddress() } = {}) {
  return new Request(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: new URL(url).origin,
      Host: new URL(url).host,
      "X-Forwarded-For": address,
      ...headers,
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function configure(installationId = "999") {
  process.env.REPORT_GITHUB_APP_ID = "42";
  process.env.REPORT_GITHUB_INSTALLATION_ID = installationId;
  process.env.REPORT_GITHUB_APP_PRIVATE_KEY = PEM;
}

function unconfigure() {
  delete process.env.REPORT_GITHUB_APP_ID;
  delete process.env.REPORT_GITHUB_INSTALLATION_ID;
  delete process.env.REPORT_GITHUB_APP_PRIVATE_KEY;
}

/** Records every GitHub call; throws on anything unexpected so a leak is loud. */
function installGitHub({ existing = [], createStatus = 201, tokenStatus = 201 } = {}) {
  const calls = [];
  let nextNumber = 100;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === "string" ? input : input.url);
    assert.equal(url.origin, "https://api.github.com", "solo GitHub può essere contattato");
    const key = `${init.method ?? "GET"} ${url.pathname}`;
    calls.push({ key, body: init.body ? JSON.parse(init.body) : null, headers: init.headers });
    const json = (body, status) => new Response(JSON.stringify(body), { status });
    if (key.startsWith("POST /app/installations/")) {
      if (tokenStatus !== 201) return json({ message: "denied" }, tokenStatus);
      return json({ token: "ghs_test", expires_at: new Date(Date.now() + 3600_000).toISOString() }, 201);
    }
    if (key === `GET ${ISSUES_PATH}`) return json(existing, 200);
    if (key === `POST ${ISSUES_PATH}`) {
      if (createStatus !== 201) return json({ message: "boom" }, createStatus);
      nextNumber += 1;
      return json({ number: nextNumber, html_url: ISSUE_URL(nextNumber) }, 201);
    }
    throw new Error(`Chiamata GitHub inattesa: ${key}`);
  };
  return {
    calls,
    created: () => calls.filter((call) => call.key === `POST ${ISSUES_PATH}`),
    restore: () => { globalThis.fetch = originalFetch; },
  };
}

function withoutGitHub() {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("Nessuna chiamata esterna attesa"); };
  return () => { globalThis.fetch = originalFetch; };
}

test("rifiuta content type, origin e host non consentiti prima di ogni altra cosa", async () => {
  const restore = withoutGitHub();
  try {
    configure();
    assert.equal((await POST(request(payload(), { headers: { "Content-Type": "text/plain" } }))).status, 415);
    assert.equal((await POST(request(payload(), { headers: { Origin: "https://attacker.test" } }))).status, 403);
    assert.equal((await POST(request(payload(), { headers: { Host: "other.test" } }))).status, 403);
    const noOrigin = new Request("https://example.test/api/segnalazioni", {
      method: "POST",
      headers: { "Content-Type": "application/json", Host: "example.test" },
      body: JSON.stringify(payload()),
    });
    assert.equal((await POST(noOrigin)).status, 403);
  } finally {
    restore();
    unconfigure();
  }
});

test("rifiuta payload sovradimensionati, JSON rotto e campi inattesi senza contattare GitHub", async () => {
  const restore = withoutGitHub();
  try {
    configure();
    const big = await POST(request(payload({ observed: "x".repeat(20_000) })));
    assert.equal(big.status, 413);
    const declared = await POST(request(payload(), { headers: { "Content-Length": "999999" } }));
    assert.equal(declared.status, 413);
    const broken = await POST(request("{nope"));
    assert.equal(broken.status, 400);
    assert.equal((await broken.json()).code, "invalid_request");

    for (const bad of [
      payload({ labels: ["urgent"] }),
      payload({ repository: "evil/repo" }),
      payload({ assignees: ["someone"] }),
      payload({ page: { path: "https://evil.test/", title: "" } }),
      payload({ category: "dato" }),
      payload({ website: "http://spam.test" }),
    ]) {
      const response = await POST(request(bad));
      assert.equal(response.status, 400, JSON.stringify(bad));
      const body = await response.json();
      assert.equal(body.ok, false);
      assert.equal(body.code, "invalid_request");
      assert.equal(body.fallbackUrl, undefined, "nessun fallback per input rifiutati");
    }
  } finally {
    restore();
    unconfigure();
  }
});

test("rifiuta invii troppo rapidi (time-trap) e moduli stantii", async () => {
  const restore = withoutGitHub();
  try {
    configure();
    const now = Date.now();
    const fast = await POST(request(payload({
      context: { reportedAt: new Date(now).toISOString(), openedAt: new Date(now - 200).toISOString() },
    })));
    assert.equal(fast.status, 400);
    assert.match((await fast.json()).message, /rapido/);
    const stale = await POST(request(payload({
      context: { reportedAt: new Date(now).toISOString(), openedAt: new Date(now - 48 * 3600_000).toISOString() },
    })));
    assert.equal(stale.status, 400);
  } finally {
    restore();
    unconfigure();
  }
});

test("senza credenziali risponde 503 con il composer GitHub precompilato e conserva i dati", async () => {
  const restore = withoutGitHub();
  try {
    unconfigure();
    const response = await POST(request(payload({ observed: "Testo da conservare" })));
    assert.equal(response.status, 503);
    const body = await response.json();
    assert.equal(body.ok, false);
    assert.equal(body.code, "unavailable");
    const fallback = new URL(body.fallbackUrl);
    assert.equal(fallback.pathname, "/Italian-Builders-Org/DoveVannoINostriSoldi/issues/new");
    assert.ok(fallback.searchParams.get("body").includes("Testo da conservare"));
    assert.equal(fallback.searchParams.get("labels"), "segnalazione");
  } finally {
    restore();
  }
});

test("un invio valido crea una sola issue e restituisce numero e URL", async () => {
  const github = installGitHub();
  try {
    configure("1001");
    const response = await POST(request(payload()));
    assert.equal(response.status, 201);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    const body = await response.json();
    assert.equal(body.ok, true);
    assert.equal(body.duplicate, false);
    assert.equal(body.issue.number, 101);
    assert.equal(body.issue.url, ISSUE_URL(101));
    assert.equal(github.created().length, 1);
    const created = github.created()[0].body;
    assert.deepEqual(created.labels, ["segnalazione"]);
    assert.match(created.title, /^\[Segnalazione\] Bug del sito: \/spese$/);
    assert.ok(created.body.startsWith("<!-- dvns-report-key: "));
    assert.ok(!JSON.stringify(github.calls).includes(PEM.slice(40, 80)), "la chiave privata non lascia il server");
    for (const call of github.calls) assert.equal(call.headers.authorization.startsWith("Bearer "), true);
  } finally {
    github.restore();
    unconfigure();
  }
});

test("retry con la stessa chiave non crea duplicati (memoria dell'istanza)", async () => {
  const github = installGitHub();
  try {
    configure("1002");
    const body = payload();
    const first = await POST(request(body));
    const second = await POST(request(body));
    assert.equal(first.status, 201);
    assert.equal(second.status, 200);
    const secondBody = await second.json();
    assert.equal(secondBody.duplicate, true);
    assert.equal(secondBody.issue.url, (await first.json()).issue.url);
    assert.equal(github.created().length, 1);
  } finally {
    github.restore();
    unconfigure();
  }
});

test("una issue già esistente su GitHub con lo stesso marker viene riusata", async () => {
  const key = randomUUID();
  const github = installGitHub({
    existing: [{ number: 55, html_url: ISSUE_URL(55), body: `<!-- dvns-report-key: ${key} -->\n## Tipo` }],
  });
  try {
    configure("1003");
    const response = await POST(request(payload({ clientKey: key })));
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(body, { ok: true, issue: { number: 55, url: ISSUE_URL(55) }, duplicate: true });
    assert.equal(github.created().length, 0);
  } finally {
    github.restore();
    unconfigure();
  }
});

test("se GitHub fallisce risponde 503 con fallback e non espone dettagli del provider", async () => {
  const originalError = console.error;
  const logged = [];
  console.error = (...args) => logged.push(args.join(" "));
  const github = installGitHub({ createStatus: 500 });
  try {
    configure("1004");
    const response = await POST(request(payload({ observed: "contenuto riservato al form" })));
    assert.equal(response.status, 503);
    const body = await response.json();
    assert.equal(body.code, "unavailable");
    assert.ok(body.fallbackUrl.startsWith("https://github.com/"));
    assert.ok(!JSON.stringify(body).includes("boom"));
    assert.equal(logged.length, 1);
    assert.ok(!logged[0].includes("contenuto riservato"), "il contenuto non finisce nei log");
    assert.match(logged[0], /HTTP 500/);
  } finally {
    console.error = originalError;
    github.restore();
    unconfigure();
  }

  const denied = installGitHub({ tokenStatus: 401 });
  try {
    configure("1005");
    const response = await POST(request(payload()));
    assert.equal(response.status, 503);
    assert.equal(denied.created().length, 0);
  } finally {
    denied.restore();
    unconfigure();
  }
});

test("un invio di funzionalità senza passaggi crea la issue", async () => {
  const github = installGitHub();
  try {
    configure("1007");
    const response = await POST(request(payload({ category: "feature", steps: "" })));
    assert.equal(response.status, 201);
    const created = github.created()[0].body;
    assert.match(created.title, /^\[Segnalazione\] Nuova funzionalità: \/spese$/);
    assert.match(created.body, /## Passaggi per riprodurre\n```text\n\(non indicato\)\n```/);
  } finally {
    github.restore();
    unconfigure();
  }
});

test("oltre il limite per indirizzo risponde 429 senza contattare GitHub", async () => {
  const github = installGitHub();
  try {
    configure("1006");
    const address = "198.51.100.7";
    for (let index = 0; index < 3; index += 1) {
      assert.equal((await POST(request(payload(), { address }))).status, 201);
    }
    const limited = await POST(request(payload(), { address }));
    assert.equal(limited.status, 429);
    assert.equal(limited.headers.get("retry-after"), "600");
    const body = await limited.json();
    assert.equal(body.code, "rate_limited");
    assert.ok(body.fallbackUrl.startsWith("https://github.com/"));
    assert.equal(github.created().length, 3);
  } finally {
    github.restore();
    unconfigure();
  }
});
