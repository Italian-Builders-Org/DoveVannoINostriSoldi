import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import "./helpers/register-ts-alias.mjs";
const { buildBudgetLawRefresh, fetchBudgetLawRefresh, writeBudgetLawRefresh } = await import("../scripts/etl/bdap_budget_law_refresh.mjs");
const { validateBudgetLawSnapshotArtifact } = await import("../src/lib/bdap-legge-bilancio.ts");

const previous = JSON.parse(readFileSync("src/data/generated/openbdap-budget-law-missions.json"));
const previousLock = JSON.parse(readFileSync("scripts/etl/specs/openbdap-budget-law-missions.source.json"));
const observedAt = new Date(Date.parse(previous.source.observedAt) + 86_400_000).toISOString();
const fields = ["Esercizio Finanziario", "Stato di Previsione", "Amministrazione", "Missione", "Programma", "Unità di voto 1° Livello", "Unità di voto 2° Livello", "Unità di voto 3° Livello", "Macroaggregato", "Legge di Bilancio CP A1", "Legge di Bilancio CP A2", "Legge di Bilancio CP A3", "Legge di Bilancio CS A1", "Legge di Bilancio CS A2", "Legge di Bilancio CS A3"];
const pkg = {
  id: previous.source.packageId, name: previous.series.dataset.name, title: previous.source.title,
  notes: previous.series.dataset.notes, metadata_modified: previous.series.dataset.metadataModified,
  license_id: "cc-by", license_title: previous.source.license, license_url: previous.source.licenseUrl,
  resources: [{ id: previous.source.resourceId, url: previous.source.csvUrl, format: "CSV", mimetype: "text/csv" }],
};
const catalog = (packages = [pkg]) => Buffer.from(JSON.stringify({ success: true, result: { results: packages } }));
const csv = (rows = previous.series.allocations) => Buffer.from([
  fields.join(";"), ...rows.map((row) => [row.year, "01", "AMMINISTRAZIONE", row.mission, "PROGRAMMA", "1", "2", "3", "MACRO", row.amountEur, 0, 0, 0, 0, 0]
    .map((value) => `"${String(value).replaceAll('"', '""')}"`).join(";")), "",
].join("\r\n"), "latin1");
const candidate = (overrides = {}) => buildBudgetLawRefresh({ previous, previousLock, observedAt, catalogBytes: catalog(), csvBytes: csv(), ...overrides });

test("refresh reconciles exact totals and binds source bytes without altering published input", () => {
  const before = JSON.stringify(previous);
  const next = candidate();
  assert.equal(next.changed, true);
  assert.deepEqual(next.artifact.series.allocations, previous.series.allocations);
  assert.deepEqual(next.lock.expectedAnnualTotalsEur, previousLock.expectedAnnualTotalsEur);
  assert.equal(next.lock.source.csv.rowsIncludingHeader, previous.series.allocations.length + 1);
  assert.doesNotThrow(() => validateBudgetLawSnapshotArtifact(next.artifact, next.lock));
  assert.throws(() => validateBudgetLawSnapshotArtifact(next.artifact));
  assert.equal(JSON.stringify(previous), before);
});

test("unchanged sources do not churn observation timestamps or files", () => {
  const first = candidate();
  const next = candidate({ previous: first.artifact, previousLock: first.lock, observedAt: new Date(Date.parse(observedAt) + 86_400_000).toISOString() });
  assert.equal(next.changed, false);
  assert.deepEqual(next.artifact, first.artifact);
  assert.deepEqual(next.lock, first.lock);
});

test("new consecutive years are accepted with the complete existing mission taxonomy", () => {
  const year = previous.series.years.at(-1) + 1;
  const rows = [...previous.series.allocations, ...previous.series.missions.map((mission) => ({ year, mission, amountEur: 1_000 }))];
  const next = candidate({ csvBytes: csv(rows) });
  assert.equal(next.artifact.series.years.at(-1), year);
  assert.equal(next.lock.expectedAnnualTotalsEur[year], 34_000);
});

test("ambiguous identity, licence and reduced coverage fail closed", () => {
  assert.throws(() => candidate({ catalogBytes: catalog([pkg, pkg]) }), /un solo/);
  assert.throws(() => candidate({ catalogBytes: catalog([{ ...pkg, license_title: "different licence" }]) }));
  assert.throws(() => candidate({ csvBytes: csv(previous.series.allocations.slice(1)) }), /missioni/);
  assert.throws(() => candidate({ csvBytes: csv(previous.series.allocations.filter((row) => row.year !== previous.series.years[0])) }), /temporale/);
  assert.throws(() => candidate({ csvBytes: Buffer.from(csv().toString("latin1").replace("Missione;", "Altro;"), "latin1") }), /Schema/);
  assert.throws(() => candidate({ csvBytes: csv([...previous.series.allocations, previous.series.allocations[0]]) }), /duplicata/);
  assert.throws(() => candidate({ csvBytes: Buffer.from(csv().toString("latin1").replaceAll('"0"\r\n', '"0";"extra"\r\n'), "latin1") }), /Schema/);
  assert.throws(() => candidate({ csvBytes: Buffer.from(csv().toString("latin1"), "utf8") }), /Schema/);
  assert.throws(() => candidate({ observedAt: "2000-01-01T00:00:00.000Z" }), /osservazione/);
  const next = candidate();
  next.lock.expectedAnnualTotalsEur[2017] += 1;
  assert.throws(() => validateBudgetLawSnapshotArtifact(next.artifact, next.lock), /non riconciliato/);
});

test("online refresh uses only the official product URLs and never falls back", async () => {
  const calls = [];
  const next = await fetchBudgetLawRefresh({ previous, previousLock, observedAt, fetchSource: async (id, url, options) => {
    calls.push({ id, url, options });
    return new Response(calls.length === 1 ? catalog() : csv(), { headers: { "content-type": calls.length === 1 ? "application/json" : "text/csv" } });
  } });
  assert.equal(next.changed, true);
  assert.deepEqual(calls.map((call) => call.url), [previous.source.catalogUrl, previous.source.csvUrl]);
  assert.ok(calls.every((call) => call.id === "openbdap" && call.options.cacheMode === "no-store" && call.options.signal instanceof AbortSignal));
  for (const status of [403, 429, 503]) {
    await assert.rejects(fetchBudgetLawRefresh({ previous, previousLock, fetchSource: async () => new Response("error", { status }) }), new RegExp(String(status)));
  }
  await assert.rejects(fetchBudgetLawRefresh({ previous, previousLock, fetchSource: async () => new Response("<html/>", { headers: { "content-type": "text/html" } }) }), /formato/);
});

test("candidate is validated before both files are replaced; no-op leaves bytes untouched", () => {
  const dir = mkdtempSync(join(tmpdir(), "budget-refresh-"));
  const paths = { snapshotPath: join(dir, "snapshot.json"), lockPath: join(dir, "lock.json") };
  try {
    writeFileSync(paths.snapshotPath, JSON.stringify(previous));
    writeFileSync(paths.lockPath, JSON.stringify(previousLock));
    const next = candidate();
    writeBudgetLawRefresh(next, paths);
    assert.deepEqual(JSON.parse(readFileSync(paths.snapshotPath)), next.artifact);
    assert.deepEqual(JSON.parse(readFileSync(paths.lockPath)), next.lock);
    const bytes = readFileSync(paths.snapshotPath);
    writeBudgetLawRefresh({ ...next, changed: false }, paths);
    assert.deepEqual(readFileSync(paths.snapshotPath), bytes);
    next.artifact.series.allocations[0].amountEur += 1;
    assert.throws(() => writeBudgetLawRefresh(next, paths));
    assert.deepEqual(readFileSync(paths.snapshotPath), bytes);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});


test("historical rows outside the stable taxonomy may omit mission; published years may not", () => {
  const rows = [...previous.series.allocations, { year: 2016, mission: "", amountEur: 10 }];
  assert.deepEqual(candidate({ csvBytes: csv(rows) }).artifact.series.allocations, previous.series.allocations);
  rows.at(-1).year = 2017;
  assert.throws(() => candidate({ csvBytes: csv(rows) }), /priva di anno o missione/);
});

test("oversized discovery responses are cancelled before a CSV request", async () => {
  let cancelled = false;
  let calls = 0;
  await assert.rejects(fetchBudgetLawRefresh({ previous, previousLock, fetchSource: async () => {
    calls += 1;
    return new Response(new ReadableStream({
      start(controller) { controller.enqueue(new Uint8Array(2 * 1024 * 1024 + 1)); },
      cancel() { cancelled = true; },
    }), { headers: { "content-type": "application/json" } });
  } }), /supera il limite/);
  assert.equal(calls, 1);
  assert.equal(cancelled, true);
});
