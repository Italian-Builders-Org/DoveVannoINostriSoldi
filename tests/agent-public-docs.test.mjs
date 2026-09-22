import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { NextRequest } from "next/server.js";
import "./helpers/register-ts-alias.mjs";

const {
  renderAgentPublicDocMarkdown,
  getAgentPublicDoc,
  renderAgentsIndexMarkdown,
} = await import("../src/lib/agent-public-docs.ts");
const { GET: getIrpef } = await import("../src/app/api/territori/irpef/route.ts");
const { checkAgentPublicDocs } = await import("../scripts/ci/check-agent-public-docs.mjs");
const { datasetQuerySchema } = await import("../src/lib/mcp/query-schema.ts");

const besInnovazioneMetaJson = JSON.parse(readFileSync(
  fileURLToPath(new URL("../src/data/generated/istat-bes-innovazione-2004-2023.meta.json", import.meta.url)),
  "utf8",
));
const povertaSogliaAssolutaMetaJson = JSON.parse(readFileSync(
  fileURLToPath(new URL("../src/data/generated/istat-poverta-soglia-assoluta-2005-2024.meta.json", import.meta.url)),
  "utf8",
));

function getIrpefResponse(search = "") {
  return getIrpef(new NextRequest(`https://example.test/api/territori/irpef${search}`));
}

function baseSnapshot(overrides = {}) {
  return {
    activeIds: ["mef_irpef_comunale"],
    configuredIds: ["opencup_progetto"],
    indexIds: ["mef_irpef_comunale"],
    indexMarkdown: "[IRPEF](/for-agents/datasets/mef_irpef_comunale)",
    cards: [{
      id: "mef_irpef_comunale",
      title: "IRPEF",
      summary: "summary",
      availability: "availability",
      period: ["2024"],
      units: ["euro"],
      coverage: "coverage",
      caveat: "caveat",
      filters: [{ name: "year", description: "year" }],
      queryNotes: [],
      exampleQuery: { dataset: "mef_irpef_comunale", year: 2024 },
      exampleError: null,
      sources: [],
      declaredSourceUrls: [],
      declaredReferenceUrls: [],
      references: [],
      mcpEndpoint: "/api/mcp",
      httpEndpoint: null,
      httpExampleQuery: null,
      methodologyUrl: "/metodologia",
    }],
    cardMarkdowns: [{ id: "mef_irpef_comunale", markdown: renderAgentPublicDocMarkdown(getAgentPublicDoc("mef_irpef_comunale")) }],
    datasetPathPrefix: "/for-agents/datasets/",
    sanitizePublicUrl: (url) => url,
    schema: datasetQuerySchema,
    ...overrides,
  };
}

test("IRPEF public doc separates MCP from HTTP access", () => {
  const doc = getAgentPublicDoc("mef_irpef_comunale");
  assert.ok(doc);
  assert.equal(doc.httpEndpoint, "/api/territori/irpef");
  assert.ok(doc.httpExampleQuery);
  const markdown = renderAgentPublicDocMarkdown(doc);
  assert.match(markdown, /MCP:/);
  assert.match(markdown, /API HTTP esistente/);
  assert.match(markdown, /Esempio HTTP/);
  assert.match(markdown, /Esempio MCP/);
  assert.doesNotMatch(markdown, /l'esecuzione della query richiede un client MCP compatibile/);
});

test("IRPEF HTTP example uses Italian parameters accepted by the route", async () => {
  const doc = getAgentPublicDoc("mef_irpef_comunale");
  assert.ok(doc.httpExampleQuery);
  const searchParams = new URLSearchParams();
  for (const [key, value] of Object.entries(doc.httpExampleQuery)) {
    searchParams.set(key, String(value));
  }
  const response = getIrpefResponse(`?${searchParams.toString()}`);
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.data[0].territory.name, "BALME");
});

test("non-HTTP dataset public doc only promises MCP access", () => {
  const doc = getAgentPublicDoc("siope_comuni");
  assert.ok(doc);
  assert.equal(doc.httpEndpoint, null);
  assert.equal(doc.httpExampleQuery, null);
  const markdown = renderAgentPublicDocMarkdown(doc);
  assert.match(markdown, /MCP:/);
  assert.doesNotMatch(markdown, /API HTTP esistente/);
  assert.doesNotMatch(markdown, /Esempio HTTP/);
});

test("agents index does not promise a universal HTTP API", () => {
  const markdown = renderAgentsIndexMarkdown();
  assert.match(markdown, /\/api\/mcp/);
  assert.doesNotMatch(markdown, /API HTTP universale|API HTTP per tutti|HTTP per ogni dataset/i);
});

test("renderer uses exception heading for invalid example", () => {
  const doc = getAgentPublicDoc("mef_irpef_comunale");
  const invalidDoc = { ...doc, exampleError: "invalid example", exampleQuery: { dataset: "mef_irpef_comunale", year: "not-a-number" } };
  const markdown = renderAgentPublicDocMarkdown(invalidDoc);
  assert.match(markdown, /## Eccezione MCP/);
  assert.doesNotMatch(markdown, /## Esempio MCP/);
});

test("renderer uses supported heading for valid example", () => {
  const doc = getAgentPublicDoc("mef_irpef_comunale");
  const markdown = renderAgentPublicDocMarkdown(doc);
  assert.match(markdown, /## Esempio MCP/);
  assert.doesNotMatch(markdown, /## Eccezione MCP/);
});

test("checker fails invalid example with normal Esempio MCP heading", () => {
  const snapshot = baseSnapshot();
  snapshot.cards[0].exampleQuery = { dataset: "mef_irpef_comunale", year: "not-a-number" };
  snapshot.cards[0].exampleError = "invalid";
  snapshot.cardMarkdowns[0].markdown = "## Esempio MCP\n\nL'esempio dichiarato non supera la validazione.\n";
  const problems = checkAgentPublicDocs(snapshot);
  assert.ok(problems.some((p) => p.field === "example"));
});

test("checker fails an invalid descriptor even when the renderer labels it as an exception", () => {
  const snapshot = baseSnapshot();
  snapshot.cards[0].exampleQuery = { dataset: "mef_irpef_comunale", year: "not-a-number" };
  snapshot.cards[0].exampleError = "invalid";
  snapshot.cardMarkdowns[0].markdown = renderAgentPublicDocMarkdown(snapshot.cards[0]);
  const problems = checkAgentPublicDocs(snapshot);
  assert.ok(problems.some((p) => p.field === "example"));
});

test("checker fails valid example marked as error", () => {
  const snapshot = baseSnapshot();
  snapshot.cards[0].exampleError = "unexpected error";
  const problems = checkAgentPublicDocs(snapshot);
  assert.ok(problems.some((p) => p.field === "example-error"));
});

test("checker fails missing cardMarkdowns coverage for active cards", () => {
  const snapshot = baseSnapshot();
  delete snapshot.cardMarkdowns;
  const problems = checkAgentPublicDocs(snapshot);
  assert.ok(problems.some((p) => p.field === "card-markdowns" || p.field === "markdown-coverage"));
});

test("checker fails incoherent Markdown access contract", () => {
  const snapshot = baseSnapshot();
  snapshot.cards[0].httpEndpoint = null;
  snapshot.cards[0].httpExampleQuery = null;
  snapshot.cardMarkdowns[0].markdown = renderAgentPublicDocMarkdown(snapshot.cards[0]) + "\n\nAPI HTTP esistente: /api/example\n\nEsempio HTTP\n";
  const problems = checkAgentPublicDocs(snapshot);
  assert.ok(problems.some((p) => p.field === "markdown-http-unexpected"));
});

const STABLE_METADATA_DATASETS = [
  "opencivitas_fabbisogni_2015",
  "opencivitas_fabbisogni_2016",
  "opencivitas_rifiuti_2022",
  "opencivitas_viabilita_2022",
  "opencivitas_amministrazione_2022",
  "opencivitas_sociale_asili_2022",
  "istat_bes_innovazione",
  "istat_poverta_soglia_assoluta",
];

for (const datasetId of STABLE_METADATA_DATASETS) {
  test(`${datasetId} public doc exposes stable metadata instead of response-dependent fallbacks`, () => {
    const doc = getAgentPublicDoc(datasetId);
    assert.ok(doc, `scheda mancante per ${datasetId}`);
    assert.ok(doc.period.length > 0, `periodo vuoto per ${datasetId}`);
    assert.ok(doc.units.length > 0, `unità vuote per ${datasetId}`);
    assert.ok(doc.coverage.length > 0, `copertura vuota per ${datasetId}`);
    for (const entry of doc.period) {
      assert.doesNotMatch(entry, /dipende dalla risposta/i, `periodo ancora fallback per ${datasetId}`);
    }
    for (const entry of doc.units) {
      assert.doesNotMatch(entry, /dipende dalla risposta/i, `unità ancora fallback per ${datasetId}`);
    }
    assert.doesNotMatch(doc.coverage, /dipende dalla risposta/i, `copertura ancora fallback per ${datasetId}`);
    const markdown = renderAgentPublicDocMarkdown(doc);
    assert.doesNotMatch(markdown, /Periodo non rappresentato da un metadato stabile/i, `render periodo fallback per ${datasetId}`);
    assert.doesNotMatch(markdown, /Unità non rappresentata da un metadato stabile/i, `render unità fallback per ${datasetId}`);
    assert.doesNotMatch(markdown, /Copertura non rappresentata da un metadato stabile/i, `render copertura fallback per ${datasetId}`);
  });
}

for (const [datasetId, meta] of [
  ["istat_bes_innovazione", besInnovazioneMetaJson],
  ["istat_poverta_soglia_assoluta", povertaSogliaAssolutaMetaJson],
]) {
  test(`${datasetId} agent-public doc metadata derives exclusively from generated publicMetadata projection`, () => {
    const doc = getAgentPublicDoc(datasetId);
    assert.ok(meta.publicMetadata, `publicMetadata projection missing in ${datasetId} meta.json`);
    assert.ok(!Object.hasOwn(meta.publicMetadata, "queryNotes"), "ETL metadata must not own MCP query notes");
    assert.deepEqual(doc.period, meta.publicMetadata.period);
    assert.deepEqual(doc.units, meta.publicMetadata.units);
    assert.equal(doc.coverage, meta.publicMetadata.coverage);
    assert.deepEqual(doc.references, meta.publicMetadata.references);
    assert.ok(doc.queryNotes.length > 0, "catalog-owned query notes missing");
  });
}

test("OpenCivitas 2015–2016, Rifiuti/Viabilità/Sociale-asili 2022 cards expose RSO coverage and reference year", () => {
  for (const datasetId of ["opencivitas_fabbisogni_2015", "opencivitas_fabbisogni_2016", "opencivitas_rifiuti_2022", "opencivitas_viabilita_2022", "opencivitas_sociale_asili_2022", "opencivitas_amministrazione_2022"]) {
    const doc = getAgentPublicDoc(datasetId);
    const markdown = renderAgentPublicDocMarkdown(doc);
    assert.match(doc.coverage, /Comuni RSO/i, `${datasetId} copertura RSO`);
    assert.match(markdown, /Comuni RSO/i, `${datasetId} render copertura RSO`);
    assert.match(markdown, /Annualità di riferimento 20(15|16|22)/, `${datasetId} render annualità`);
  }
});

test("ISTAT povertà soglia assoluta card exposes 2005–2024 window and null distinction", () => {
  const doc = getAgentPublicDoc("istat_poverta_soglia_assoluta");
  const markdown = renderAgentPublicDocMarkdown(doc);
  assert.ok(doc.period.some((p) => /2005[–-]2024/.test(p)), "periodo 2005–2024");
  assert.match(markdown, /2005[–-]2024/, "render periodo 2005–2024");
  assert.ok(doc.units.some((u) => /centesimi di euro/.test(u)), "unità centesimi di euro");
  assert.match(markdown, /centesimi di euro/, "render unità centesimi di euro");
  assert.match(doc.coverage, /celle vuote/i, "copertura celle vuote");
  assert.match(markdown, /null.*zero|riga assente.*null|celle vuote.*null/i, "render distinzione null/zero");
});

test("ISTAT BES innovazione card exposes stable edition and per-indicator variability", () => {
  const doc = getAgentPublicDoc("istat_bes_innovazione");
  const markdown = renderAgentPublicDocMarkdown(doc);
  assert.ok(doc.period.some((p) => /Edizione 2025/.test(p)), "periodo edizione 2025");
  assert.ok(doc.period.some((p) => /2004[–-]2023/.test(p)), "periodo 2004–2023");
  assert.match(markdown, /2004[–-]2023/, "render periodo 2004–2023");
  assert.ok(doc.units.some((u) => /decimi/.test(u)), "unità decimi");
  assert.match(markdown, /decimi/, "render unità decimi");
  assert.ok(doc.queryNotes.some((n) => /indicatore conserva.*periodo/i.test(n)), "nota variabilità per indicatore");
  assert.match(doc.coverage, /BES_11/i, "copertura dominio BES_11");
  assert.match(markdown, /SEX=T/, "render solo SEX=T");
});

test("catalog public metadata graph does not import heavy ISTAT source-lock files", () => {
  const catalogSource = readFileSync(
    fileURLToPath(new URL("../src/lib/mcp/catalog.ts", import.meta.url)),
    "utf8",
  );
  assert.doesNotMatch(
    catalogSource,
    /istat-poverta-soglia-assoluta-2005-2024\.source\.json/,
    "catalog non deve importare il source lock pesante della soglia di povertà",
  );
  assert.doesNotMatch(
    catalogSource,
    /istat-bes-innovazione-2004-2023\.source\.json/,
    "catalog non deve importare il source lock pesante del BES innovazione",
  );
  assert.doesNotMatch(
    catalogSource,
    /istat-poverta-soglia-assoluta-snapshot|istat-bes-innovazione-snapshot/,
    "catalog non deve importare i moduli snapshot che caricano i dataset completi",
  );
});
