import assert from "node:assert/strict";
import test from "node:test";
import "./helpers/register-ts-alias.mjs";

const {
  buildIssueDraft,
  fenceUserText,
  githubComposerUrl,
  inlineSafe,
  normalizeUserText,
  parseReportRequest,
  REPORT_LIMITS,
  timingRejection,
} = await import("../src/lib/report/contract.ts");

const NOW = Date.parse("2026-08-30T10:00:00.000Z");

function validPayload(overrides = {}) {
  return {
    clientKey: "6f1c2b6e-4d7a-4d61-9a3c-2f1c0b3e9a11",
    category: "bug",
    observed: "La tabella mostra un totale diverso dalla somma.",
    expected: "Il totale deve coincidere con la somma delle righe.",
    steps: "1. Apri /spese\n2. Guarda il totale",
    page: { path: "/spese?anno=2025", title: "Spese · DoveVannoINostriSoldi" },
    context: {
      reportedAt: new Date(NOW).toISOString(),
      openedAt: new Date(NOW - 20_000).toISOString(),
      viewport: { width: 390, height: 844 },
      userAgent: "Mozilla/5.0 Test",
    },
    website: "",
    ...overrides,
  };
}

test("accetta una segnalazione valida e normalizza il testo", () => {
  const result = parseReportRequest(validPayload({ observed: "  riga\r\n\r\n\r\n\r\nfine​  " }));
  assert.equal(result.ok, true);
  assert.equal(result.value.observed, "riga\n\nfine");
  assert.equal(result.value.website, "");
});

test("rifiuta campi inattesi: repository, label, assignee o mention non passano", () => {
  for (const extra of [{ repo: "altro/repo" }, { labels: ["bug"] }, { assignees: ["x"] }, { title: "mio" }]) {
    const result = parseReportRequest(validPayload(extra));
    assert.equal(result.ok, false, JSON.stringify(extra));
  }
  const nestedExtra = parseReportRequest(validPayload({ page: { path: "/x", title: "t", url: "https://evil.test" } }));
  assert.equal(nestedExtra.ok, false);
});

test("rifiuta honeypot compilato, categoria sconosciuta e chiave non UUID", () => {
  assert.equal(parseReportRequest(validPayload({ website: "https://spam.test" })).ok, false);
  assert.equal(parseReportRequest(validPayload({ category: "security" })).ok, false);
  assert.equal(parseReportRequest(validPayload({ clientKey: "abc" })).ok, false);
});

test("accetta la categoria nuova funzionalità e la mette nel titolo della issue", () => {
  const result = parseReportRequest(validPayload({ category: "feature" }));
  assert.equal(result.ok, true);
  const draft = buildIssueDraft(result.value);
  assert.equal(draft.title, "[Segnalazione] Nuova funzionalità: /spese?anno=2025");
});

test("per una nuova funzionalità i passaggi per riprodurre non sono obbligatori", () => {
  const result = parseReportRequest(validPayload({ category: "feature", steps: "   " }));
  assert.equal(result.ok, true);
  assert.equal(result.value.steps, "");
  const draft = buildIssueDraft(result.value);
  assert.match(draft.body, /## Passaggi per riprodurre\n```text\n\(non indicato\)\n```/);
  assert.equal(parseReportRequest(validPayload({ category: "bug", steps: "   " })).ok, false);
  assert.equal(parseReportRequest(validPayload({ category: "accessibilita", steps: "" })).ok, false);
});

test("rifiuta testi oltre i limiti e campi obbligatori vuoti", () => {
  const long = "x".repeat(REPORT_LIMITS.observedMax + 1);
  assert.equal(parseReportRequest(validPayload({ observed: long })).ok, false);
  assert.equal(parseReportRequest(validPayload({ steps: "   " })).ok, false);
  const huge = "x".repeat(REPORT_LIMITS.observedMax * 4 + 1);
  assert.equal(parseReportRequest(validPayload({ expected: huge })).ok, false);
});

test("accetta solo percorsi del dominio canonico", () => {
  assert.equal(parseReportRequest(validPayload({ page: { path: "/spese", title: "" } })).ok, true);
  for (const path of ["https://evil.test/x", "//evil.test", "spese", "/spese)", "/spese <b>", "/x\\y"]) {
    assert.equal(parseReportRequest(validPayload({ page: { path, title: "" } })).ok, false, path);
  }
});

test("per contestare un dato la fonte ufficiale https è obbligatoria", () => {
  const missing = parseReportRequest(validPayload({ category: "dato" }));
  assert.equal(missing.ok, false);
  assert.match(missing.message, /sourceUrl/);
  assert.equal(parseReportRequest(validPayload({ category: "dato", sourceUrl: "http://istat.it" })).ok, false);
  assert.equal(parseReportRequest(validPayload({ category: "dato", sourceUrl: "https://user:pw@istat.it" })).ok, false);
  assert.equal(parseReportRequest(validPayload({ category: "dato", sourceUrl: "https://www.istat.it/x" })).ok, true);
});

test("i controlli temporali bloccano invii troppo rapidi, futuri o da moduli stantii", () => {
  const ok = validPayload().context;
  assert.equal(timingRejection(ok, NOW), null);
  assert.match(timingRejection({ ...ok, openedAt: new Date(NOW - 500).toISOString() }, NOW), /rapido/);
  assert.match(timingRejection({ ...ok, openedAt: new Date(NOW - 2 * REPORT_LIMITS.maxFillMs).toISOString() }, NOW), /troppo tempo/);
  assert.match(timingRejection({ ...ok, reportedAt: new Date(NOW + 60 * 60_000).toISOString() }, NOW), /futuro/);
  assert.match(timingRejection({ ...ok, reportedAt: new Date(NOW - 60_000).toISOString(), openedAt: new Date(NOW).toISOString() }, NOW), /incoerenti/);
});

test("il testo utente finisce in fence che neutralizzano mention, HTML e fence annidate", () => {
  const fenced = fenceUserText("@octocat guarda <img src=x onerror=alert(1)> ```js\nboom\n```");
  assert.ok(fenced.startsWith("````text\n"), fenced);
  assert.ok(fenced.endsWith("\n````"));
  assert.equal(fenceUserText(""), "```text\n(non indicato)\n```");
  assert.equal(inlineSafe("Titolo @team <b>#12</b> [x](y)", 80), "Titolo ＠team b12/b xy");
  assert.equal(normalizeUserText("a‮b"), "ab");
});

test("titolo e struttura della issue sono decisi dal server", () => {
  const request = parseReportRequest(validPayload({
    category: "dato",
    sourceUrl: "https://www.istat.it/dati",
    page: { path: "/spese?anno=2025", title: "Spese @admin <script>" },
  }));
  assert.equal(request.ok, true);
  const draft = buildIssueDraft(request.value);
  assert.equal(draft.title, "[Segnalazione] Dato potenzialmente errato: /spese?anno=2025");
  assert.deepEqual(draft.labels, ["segnalazione"]);
  assert.ok(draft.body.startsWith("<!-- dvns-report-key: 6f1c2b6e-4d7a-4d61-9a3c-2f1c0b3e9a11 -->\n## Tipo di problema"));
  for (const heading of [
    "## Pagina", "## Risultato osservato", "## Risultato atteso", "## Passaggi per riprodurre",
    "## Fonte ufficiale, se pertinente", "## Contesto tecnico",
  ]) {
    assert.ok(draft.body.includes(`\n${heading}\n`), heading);
  }
  assert.ok(draft.body.includes("[Spese ＠admin script](https://www.dovevannoinostrisoldi.com/spese?anno=2025)"));
  assert.ok(draft.body.includes("<https://www.istat.it/dati>"));
  assert.ok(draft.body.includes("- Viewport: 390×844 px"));
  assert.ok(draft.body.includes("non dimostra da solo spreco, frode o responsabilità"));
  assert.ok(draft.body.includes("Il contenuto inserito dall’utente non è stato verificato."));
});

test("il composer GitHub di fallback è precompilato senza il marker interno", () => {
  const request = parseReportRequest(validPayload());
  const url = new URL(githubComposerUrl(buildIssueDraft(request.value)));
  assert.equal(url.origin + url.pathname, "https://github.com/Italian-Builders-Org/DoveVannoINostriSoldi/issues/new");
  assert.equal(url.searchParams.get("labels"), "segnalazione");
  assert.match(url.searchParams.get("title"), /^\[Segnalazione\] Bug del sito: \/spese/);
  assert.ok(!url.searchParams.get("body").includes("dvns-report-key"));
  assert.ok(url.searchParams.get("body").startsWith("## Tipo di problema"));
});
