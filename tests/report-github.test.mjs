import assert from "node:assert/strict";
import { createVerify, generateKeyPairSync } from "node:crypto";
import test from "node:test";
import "./helpers/register-ts-alias.mjs";

const { readGitHubAppConfig, ReportGitHubClient, signAppJwt, GitHubUnavailableError } =
  await import("../src/lib/report/github.ts");
const { SlidingWindowLimiter, clientAddress } = await import("../src/lib/report/rate-limit.ts");

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const PEM = privateKey.export({ type: "pkcs1", format: "pem" });
const CONFIG = { appId: "123", installationId: "456", privateKeyPem: PEM };

test("la configurazione è fail-closed e accetta la chiave con newline escapati", () => {
  assert.equal(readGitHubAppConfig({}), null);
  assert.equal(readGitHubAppConfig({ REPORT_GITHUB_APP_ID: "1", REPORT_GITHUB_INSTALLATION_ID: "2" }), null);
  assert.equal(readGitHubAppConfig({
    REPORT_GITHUB_APP_ID: "abc", REPORT_GITHUB_INSTALLATION_ID: "2", REPORT_GITHUB_APP_PRIVATE_KEY: PEM,
  }), null);
  const escaped = readGitHubAppConfig({
    REPORT_GITHUB_APP_ID: "1",
    REPORT_GITHUB_INSTALLATION_ID: "2",
    REPORT_GITHUB_APP_PRIVATE_KEY: PEM.replace(/\n/g, "\\n"),
  });
  assert.equal(escaped.privateKeyPem, PEM);
  assert.equal(readGitHubAppConfig({
    REPORT_GITHUB_APP_ID: "1", REPORT_GITHUB_INSTALLATION_ID: "2", REPORT_GITHUB_APP_PRIVATE_KEY: PEM,
  }).privateKeyPem, PEM);
});

test("il JWT dell'App è RS256, breve e verificabile con la chiave pubblica", () => {
  const now = Date.parse("2026-08-30T10:00:00Z");
  const jwt = signAppJwt(CONFIG, now);
  const [header, payload, signature] = jwt.split(".");
  assert.deepEqual(JSON.parse(Buffer.from(header, "base64url")), { alg: "RS256", typ: "JWT" });
  const claims = JSON.parse(Buffer.from(payload, "base64url"));
  assert.equal(claims.iss, "123");
  assert.equal(claims.exp - claims.iat, 330);
  const verifier = createVerify("RSA-SHA256");
  verifier.update(`${header}.${payload}`);
  assert.equal(verifier.verify(publicKey, Buffer.from(signature, "base64url")), true);
});

function fakeFetch(handlers) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const target = new URL(url);
    const key = `${init.method} ${target.pathname}`;
    calls.push({ key, init, search: target.searchParams });
    const handler = handlers[key];
    if (!handler) throw new Error(`Chiamata inattesa ${key}`);
    return handler(init, target);
  };
  return { fetchImpl, calls };
}

const jsonResponse = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

test("il token di installazione chiede solo issues:write su questo repository ed è riusato", async () => {
  const { fetchImpl, calls } = fakeFetch({
    "POST /app/installations/456/access_tokens": () =>
      jsonResponse({ token: "ghs_test", expires_at: new Date(Date.now() + 3600_000).toISOString() }),
    "POST /repos/Italian-Builders-Org/DoveVannoINostriSoldi/issues": () =>
      jsonResponse({ number: 7, html_url: "https://github.com/Italian-Builders-Org/DoveVannoINostriSoldi/issues/7" }, 201),
  });
  const client = new ReportGitHubClient(CONFIG, { fetch: fetchImpl });
  const draft = { title: "t", body: "b", labels: ["segnalazione"] };
  const first = await client.createIssue(draft);
  const second = await client.createIssue(draft);
  assert.deepEqual(first, { number: 7, url: "https://github.com/Italian-Builders-Org/DoveVannoINostriSoldi/issues/7" });
  assert.deepEqual(second, first);

  const tokenCalls = calls.filter((call) => call.key.startsWith("POST /app/installations"));
  assert.equal(tokenCalls.length, 1, "il token va riusato finché valido");
  assert.deepEqual(JSON.parse(tokenCalls[0].init.body), {
    repositories: ["DoveVannoINostriSoldi"],
    permissions: { issues: "write" },
  });
  assert.match(tokenCalls[0].init.headers.authorization, /^Bearer eyJ/);
  const issueCall = calls.find((call) => call.key.endsWith("/issues"));
  assert.equal(issueCall.init.headers.authorization, "Bearer ghs_test");
  assert.deepEqual(JSON.parse(issueCall.init.body), { title: "t", body: "b", labels: ["segnalazione"] });
});

test("errori e risposte inattese di GitHub diventano GitHubUnavailableError, mai dati grezzi", async () => {
  const { fetchImpl } = fakeFetch({
    "POST /app/installations/456/access_tokens": () => jsonResponse({ message: "Bad credentials" }, 401),
  });
  const client = new ReportGitHubClient(CONFIG, { fetch: fetchImpl });
  await assert.rejects(client.createIssue({ title: "t", body: "b", labels: [] }), (error) => {
    assert.ok(error instanceof GitHubUnavailableError);
    assert.equal(error.status, 401);
    assert.ok(!error.message.includes("Bad credentials"));
    return true;
  });

  const foreign = fakeFetch({
    "POST /app/installations/456/access_tokens": () =>
      jsonResponse({ token: "ghs", expires_at: new Date(Date.now() + 3600_000).toISOString() }),
    "POST /repos/Italian-Builders-Org/DoveVannoINostriSoldi/issues": () =>
      jsonResponse({ number: 1, html_url: "https://github.com/evil/repo/issues/1" }, 201),
  });
  await assert.rejects(
    new ReportGitHubClient(CONFIG, { fetch: foreign.fetchImpl }).createIssue({ title: "t", body: "b", labels: [] }),
    GitHubUnavailableError,
  );

  const network = new ReportGitHubClient(CONFIG, { fetch: async () => { throw new TypeError("fetch failed"); } });
  await assert.rejects(network.createIssue({ title: "t", body: "b", labels: [] }), GitHubUnavailableError);
});

test("la ricerca per chiave usa la lista issue con label e since e riconosce il marker", async () => {
  const marker = "<!-- dvns-report-key: 6f1c2b6e-4d7a-4d61-9a3c-2f1c0b3e9a11 -->";
  const { fetchImpl, calls } = fakeFetch({
    "POST /app/installations/456/access_tokens": () =>
      jsonResponse({ token: "ghs", expires_at: new Date(Date.now() + 3600_000).toISOString() }),
    "GET /repos/Italian-Builders-Org/DoveVannoINostriSoldi/issues": () => jsonResponse([
      { number: 3, html_url: "https://github.com/x/y/issues/3", body: "altro" },
      { number: 4, html_url: "https://github.com/x/y/issues/4", body: `${marker}\n## Tipo` },
    ]),
  });
  const client = new ReportGitHubClient(CONFIG, { fetch: fetchImpl });
  const found = await client.findIssueByKey("6f1c2b6e-4d7a-4d61-9a3c-2f1c0b3e9a11", Date.parse("2026-08-29T10:00:00Z"));
  assert.deepEqual(found, { number: 4, url: "https://github.com/x/y/issues/4" });
  const list = calls.find((call) => call.key.startsWith("GET"));
  assert.equal(list.search.get("labels"), "segnalazione");
  assert.equal(list.search.get("since"), "2026-08-29T10:00:00.000Z");
  assert.equal(await client.findIssueByKey("00000000-0000-4000-8000-000000000000", 0), null);
});

test("il limitatore a finestra scorrevole conta per chiave e dimentica gli accessi vecchi", () => {
  const limiter = new SlidingWindowLimiter({ windowMs: 1_000, max: 2 });
  assert.equal(limiter.consume("a", 0), true);
  assert.equal(limiter.consume("a", 100), true);
  assert.equal(limiter.consume("a", 200), false);
  assert.equal(limiter.consume("b", 200), true);
  assert.equal(limiter.consume("a", 1_101), true);
});

test("l'indirizzo client viene letto dal primo hop di X-Forwarded-For e validato", () => {
  const make = (headers) => new Request("https://x.test", { headers });
  assert.equal(clientAddress(make({ "x-forwarded-for": "203.0.113.9, 10.0.0.1" })), "203.0.113.9");
  assert.equal(clientAddress(make({ "x-forwarded-for": "2001:DB8::1" })), "2001:db8::1");
  assert.equal(clientAddress(make({ "x-forwarded-for": "<script>" })), null);
  assert.equal(clientAddress(make({})), null);
});
