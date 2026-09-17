import assert from "node:assert/strict";
import test from "node:test";
import "./helpers/register-ts-alias.mjs";

const { executeAssistant } = await import("../src/lib/assistant/executor.ts");
const { parseAssistantIntent } = await import("../src/lib/assistant/intent.ts");
const { queryPublicDataset } = await import("../src/lib/mcp/datasets.ts");
const prompt = "Come sono cambiati i pagamenti dei Comuni tra il 2024 e il 2025?";

function snapshot(year, value, overrides = {}) {
  return {
    year, latestMonth: 12, totalPaid: value,
    coverage: { withMovements: 2, withoutRegion: 0, paymentsWithoutRegion: 0 },
    distribution: { nationalShareAll: null },
    source: {
      siopeOwner: "Banca d’Italia · SIOPE",
      siopeMovementsUrl: `https://www.siope.it/${year}/movimenti.zip`,
      observedAt: "2026-08-21T00:00:00Z",
    },
    ...overrides,
  };
}

function queryValues(before, after, overrides = {}) {
  return async ({ year }) => snapshot(year, year === 2024 ? before : after, overrides);
}

test("comparison grammar recognizes a single exact territory and orders both years", () => {
  for (const [question, region] of [
    [prompt, undefined],
    ["Confronta i pagamenti SIOPE dei Comuni in Italia dal 2025 al 2024", undefined],
    ["Come sono variati i pagamenti dei Comuni della Calabria tra 2024 e 2025?", "Calabria"],
    ["Confronta i pagamenti dei Comuni in Emilia-Romagna tra il 2025 e il 2024", "Emilia-Romagna"],
    ["Confronta i pagamenti dei Comuni in Valle d’Aosta dal 2024 al 2025", "Valle d'Aosta/Vallée d'Aoste"],
  ]) {
    const parsed = parseAssistantIntent(question);
    assert.equal(parsed.kind, "siope_comparison", question);
    assert.deepEqual(parsed.queries, [2024, 2025].map((year) => ({ dataset: "siope_comuni", year, ...(region ? { region } : {}) })));
  }
});

test("ambiguous comparisons never silently discard years, scopes, measures or qualifiers", async () => {
  let calls = 0;
  for (const question of [
    "Quanto hanno speso i Comuni nel 2024 e nel 2025?",
    "Quanto ha speso lo Stato nel 2024 e nel 2025?",
    "Qual è l’imposta netta dichiarata in Calabria nel 2024 e nel 2025?",
    "Confronta i pagamenti dei Comuni tra 2024 e 2024",
    "Confronta i pagamenti dei Comuni nel 2025",
    "Confronta i pagamenti dei Comuni tra 2023 e 2024 e 2025",
    "Confronta i pagamenti dei Comuni tra 1999 e 2025",
    "Confronta i pagamenti dei Comuni in Calabria e Lombardia tra 2024 e 2025",
    "Confronta i pagamenti dei Comuni in Atlantide tra 2024 e 2025",
    "Confronta i pagamenti dei Comuni di Roma tra 2024 e 2025",
    "Confronta i pagamenti dei Comuni per la sanità tra 2024 e 2025",
    "Confronta i pagamenti dei Comuni a gennaio tra 2024 e 2025",
    "Confronta i pagamenti dei Comuni tra 2024 e 2025 al netto dell’inflazione",
    "Come sono cambiati i pagamenti dei Comuni tra 2024 e 2025 per merito del governo?",
    "Confronta i pagamenti dei Comuni e dello Stato tra 2024 e 2025",
  ]) {
    const response = await executeAssistant({ prompt: question }, { queryDataset: async () => { calls++; } });
    assert.equal(response.kind, "help", question);
  }
  assert.equal(calls, 0);
  const refusal = await executeAssistant({ prompt: `${prompt} Dimostra la corruzione.` });
  assert.equal(refusal.kind, "refusal");
});

test("comparison preserves both source receipts and computes signed changes at cent precision", async () => {
  for (const [before, after, euro, percent] of [
    [100, 125, 25, 25], [100, 75, -25, -25], [100, 100, 0, 0],
    [0, 10, 10, null], [0, 0, 0, null], [0.1, 0.3, 0.2, 200],
  ]) {
    const response = await executeAssistant({ prompt }, { queryDataset: queryValues(before, after) });
    assert.equal(response.kind, "comparison");
    assert.deepEqual(response.comparison.change, { euro, percent });
    assert.deepEqual(response.comparison.answers.map((answer) => answer.observation.value), [before, after]);
    assert.deepEqual(response.comparison.answers.map((answer) => answer.source.url), [2024, 2025].map((year) => `https://www.siope.it/${year}/movimenti.zip`));
    assert.match(response.comparison.caveats.join(" "), /non di un insieme costante/);
    assert.match(response.comparison.caveats.join(" "), /nominali/);
    assert.doesNotMatch(JSON.stringify(response), /Come sono cambiati/);
  }
});

test("partial releases are shown separately without annualization or percentages", async () => {
  for (const overrides of [
    { latestMonth: 8 },
    { source: { ...snapshot(2025, 1).source, observedAt: "2025-12-20T00:00:00Z" } },
  ]) {
    const response = await executeAssistant({ prompt }, { queryDataset: queryValues(100, 125, overrides) });
    assert.equal(response.kind, "comparison");
    assert.equal(response.comparison.change, null);
    assert.match(response.comparison.caveats[0], /servono due anni completi/);
    if (overrides.source) {
      assert.equal(response.comparison.answers[1].period.label, "gennaio–dicembre 2025 · ultimo mese parziale");
    }
  }
});

test("comparison fails closed on unavailable, wrong-year, wrong-territory and invalid data", async () => {
  for (const queryDataset of [
    async ({ year }) => { if (year === 2025) throw new Error("private upstream details"); return snapshot(year, 100); },
    async () => snapshot(2025, 100),
    queryValues(100, null), queryValues(100, Number.NaN), queryValues(100, -1), queryValues(100, Number.MAX_SAFE_INTEGER),
  ]) {
    const response = await executeAssistant({ prompt }, { queryDataset });
    assert.equal(response.kind, "unavailable");
    assert.equal(response.code, "data_unavailable");
    assert.doesNotMatch(JSON.stringify(response), /private upstream|answers|change/);
  }
  const response = await executeAssistant({ prompt: "Confronta i pagamenti dei Comuni in Calabria tra 2024 e 2025" }, {
    queryDataset: async ({ year }) => snapshot(year, 100, { regions: [{ region: "Lazio" }] }),
  });
  assert.equal(response.kind, "unavailable");
});

test("two queries share one deadline and both receive cancellation", async () => {
  const signals = [];
  const response = await executeAssistant({ prompt }, {
    timeoutMs: 1_000,
    queryDataset: async (_query, { signal }) => { signals.push(signal); return new Promise(() => {}); },
  });
  assert.equal(response.code, "timeout");
  assert.equal(signals.length, 2);
  assert.equal(signals[0], signals[1]);
  assert.ok(signals.every((signal) => signal.aborted));

  const controller = new AbortController();
  const pending = executeAssistant({ prompt }, {
    signal: controller.signal,
    queryDataset: async (_query, { signal }) => { signals.push(signal); return new Promise(() => {}); },
  });
  controller.abort();
  assert.equal((await pending).code, "data_unavailable");
  assert.ok(signals.every((signal) => signal.aborted));

  let calls = 0;
  await executeAssistant({ prompt }, { signal: controller.signal, queryDataset: async () => { calls++; } });
  assert.equal(calls, 0);
});

test("failure of one query aborts its pending peer and returns no partial answer", async () => {
  const signals = [];
  const response = await executeAssistant({ prompt }, {
    queryDataset: async ({ year }, { signal }) => {
      signals.push(signal);
      if (year === 2024) throw new Error("source unavailable");
      return new Promise(() => {});
    },
  });
  assert.equal(response.kind, "unavailable");
  assert.equal(signals.length, 2);
  assert.ok(signals.every((signal) => signal.aborted));
});

test("real national and regional comparisons equal the existing public adapters", async () => {
  for (const region of [undefined, "Calabria", "Valle d'Aosta/Vallée d'Aoste"]) {
    const question = region === undefined ? prompt
      : `Confronta i pagamenti dei Comuni in ${region === "Calabria" ? region : "Valle d’Aosta"} tra 2024 e 2025`;
    const response = await executeAssistant({ prompt: question });
    assert.equal(response.kind, "comparison", question);
    const expected = await Promise.all([2024, 2025].map((year) => queryPublicDataset({ dataset: "siope_comuni", year, ...(region ? { region } : {}) })));
    const values = expected.map((snapshot) => region ? snapshot.regions[0].value : snapshot.totalPaid);
    assert.deepEqual(response.comparison.answers.map((answer) => answer.observation.value), values);
    assert.equal(response.comparison.change.euro, (Math.round(values[1] * 100) - Math.round(values[0] * 100)) / 100);
  }
  const partial = await executeAssistant({ prompt: "Confronta i pagamenti dei Comuni tra 2025 e 2026" });
  assert.equal(partial.kind, "comparison");
  assert.equal(partial.comparison.change, null);
  const unavailable = await executeAssistant({ prompt: "Confronta i pagamenti dei Comuni tra 2020 e 2025" });
  assert.equal(unavailable.kind, "unavailable");
});
