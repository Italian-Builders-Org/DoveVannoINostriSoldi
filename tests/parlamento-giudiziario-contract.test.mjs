import assert from "node:assert/strict";
import test from "node:test";
import "./helpers/register-ts-alias.mjs";

const { parseParlamentoGiudiziarioSnapshot } = await import(
  "../src/lib/data/parlamento-giudiziario-contract.ts"
);
const snapshot = (await import("../src/data/generated/parlamento-giudiziario-xix.json", { with: { type: "json" } }))
  .default;

function clone() {
  return structuredClone(snapshot);
}

test("the committed snapshot satisfies the contract", () => {
  const parsed = parseParlamentoGiudiziarioSnapshot(clone());
  assert.equal(parsed.dataset, "parlamento-giudiziario-xix");
  assert.ok(parsed.cases.length > 0);
  assert.ok(parsed.caveats.length > 0, "il dataset deve dichiarare cosa non misura");
});

test("a case without an official act needs two independent publishers", () => {
  const payload = clone();
  const target = payload.cases.find((item) => item.evidenceTier === "stampa-concordante");
  target.sources = [target.sources[0]];
  assert.throws(() => parseParlamentoGiudiziarioSnapshot(payload), /due editori indipendenti/u);
});

test("official-finding is refused without a definitive conviction backed by an act", () => {
  const payload = clone();
  const target = payload.cases.find((item) => item.status === "condanna_non_definitiva");
  target.evidenceLabel = "official-finding";
  assert.throws(() => parseParlamentoGiudiziarioSnapshot(payload), /official-finding/u);
});

test("the outcome bucket must follow the status of the proceeding", () => {
  const payload = clone();
  const target = payload.cases.find((item) => item.outcomeBucket === "non_condannato");
  target.outcomeBucket = "condannato";
  assert.throws(() => parseParlamentoGiudiziarioSnapshot(payload), /outcomeBucket/u);
});

test("an accounting proceeding cannot carry months of custody", () => {
  const payload = clone();
  const target = payload.cases.find((item) => item.jurisdiction === "contabile");
  target.events[0].sentenceMonths = 12;
  assert.throws(() => parseParlamentoGiudiziarioSnapshot(payload), /mesi di pena/u);
});

test("amounts are integer cents and never negative", () => {
  const payload = clone();
  payload.cases[0].events[0].fineEuroCents = 10.5;
  assert.throws(() => parseParlamentoGiudiziarioSnapshot(payload));
});

test("published aggregates are recomputed, not trusted", () => {
  const payload = clone();
  payload.totals.definitiveSentenceMonths += 12;
  assert.throws(() => parseParlamentoGiudiziarioSnapshot(payload), /pene definitive/u);

  const other = clone();
  other.coverage.membersByOutcome.condannato += 1;
  assert.throws(() => parseParlamentoGiudiziarioSnapshot(other), /membersByOutcome/u);
});

test("coverage must add up to the members examined", () => {
  const payload = clone();
  payload.coverage.membersSearched = 3;
  assert.throws(() => parseParlamentoGiudiziarioSnapshot(payload), /copertura incoerente/u);
});

test("member ids stay the ones the chambers publish", () => {
  const payload = clone();
  payload.cases[0].memberId = "persona-1";
  assert.throws(() => parseParlamentoGiudiziarioSnapshot(payload), /memberId/u);
});

test("unknown fields are refused instead of being carried through", () => {
  const payload = clone();
  payload.cases[0].giudizioMorale = "pessimo";
  assert.throws(() => parseParlamentoGiudiziarioSnapshot(payload));
});
