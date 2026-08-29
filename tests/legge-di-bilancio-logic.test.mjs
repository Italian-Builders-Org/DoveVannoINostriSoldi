import assert from "node:assert/strict";
import test from "node:test";
import "./helpers/register-ts-alias.mjs";

const { computePlan, computeVerdict, clampPct, netToneColor } = await import(
  "../src/app/spese/legge-di-bilancio/reallocation.ts"
);
const { encodePiano, decodePiano, orderedMissionList } = await import(
  "../src/app/spese/legge-di-bilancio/piano-codec.ts"
);

const SUMMARIES = [
  { mission: "Tutela della salute", latestAmountEur: 200_000_000_000, realDeltaPct: 1.5 },
  { mission: "Istruzione scolastica", latestAmountEur: 60_000_000_000, realDeltaPct: 0 },
  { mission: "Difesa e sicurezza del territorio", latestAmountEur: 30_000_000_000, realDeltaPct: 2 },
  { mission: "Debito pubblico", latestAmountEur: 400_000_000_000, realDeltaPct: 10 },
];

test("computePlan sums net, increases and cuts", () => {
  const plan = computePlan(SUMMARIES, {
    "Tutela della salute": 10, // +20 mld
    "Difesa e sicurezza del territorio": -20, // −6 mld
  });
  assert.equal(plan.entries.length, 2);
  assert.equal(plan.increasesCount, 1);
  assert.equal(plan.cutsCount, 1);
  assert.ok(Math.abs(plan.increasesTotal - 20_000_000_000) < 1);
  assert.ok(Math.abs(plan.cutsTotal + 6_000_000_000) < 1);
  assert.ok(Math.abs(plan.net - 14_000_000_000) < 1);
  // entries sorted by |diff| desc
  assert.equal(plan.entries[0].mission, "Tutela della salute");
});

test("computePlan ignores untouched and zero-amount missions", () => {
  const plan = computePlan(SUMMARIES, { "Istruzione scolastica": 0 });
  assert.equal(plan.entries.length, 0);
  assert.equal(plan.net, 0);
});

test("computeVerdict flags a social-spending footprint", () => {
  const scenario = { "Tutela della salute": 12, "Istruzione scolastica": 8 };
  const verdict = computeVerdict(computePlan(SUMMARIES, scenario), SUMMARIES, scenario);
  assert.match(verdict.headline, /spesa sociale/);
});

test("computeVerdict describes the official comparison as a published appropriation", () => {
  const scenario = { "Tutela della salute": 12 };
  const verdict = computeVerdict(computePlan(SUMMARIES, scenario), SUMMARIES, scenario);
  assert.match(verdict.detail, /stanziamento pubblicato/);
  assert.doesNotMatch(verdict.detail, /manovra reale/);
});

test("computeVerdict flags a balanced manovra", () => {
  // +5% salute (+10 mld) offset by a cut on debito large enough to net ~0
  const scenario = { "Tutela della salute": 5, "Debito pubblico": -2.5 };
  const plan = computePlan(SUMMARIES, scenario);
  const verdict = computeVerdict(plan, SUMMARIES, scenario);
  assert.match(verdict.headline, /pareggio/i);
});

test("computeVerdict flags rigore with broad deep cuts", () => {
  const scenario = {
    "Tutela della salute": -10,
    "Istruzione scolastica": -10,
    "Difesa e sicurezza del territorio": -10,
    "Debito pubblico": -10,
  };
  const plan = computePlan(SUMMARIES, scenario);
  const verdict = computeVerdict(plan, SUMMARIES, scenario);
  assert.match(verdict.headline, /rigore/i);
});

test("computeVerdict is empty on an untouched budget", () => {
  const verdict = computeVerdict(computePlan(SUMMARIES, {}), SUMMARIES, {});
  assert.match(verdict.headline, /nessuna modifica/i);
  assert.equal(verdict.detail, null);
});

test("netToneColor is inverted: overspending is red, saving is green", () => {
  assert.equal(netToneColor(5_000_000_000), "var(--color-critical)");
  assert.equal(netToneColor(0), "var(--color-positive)");
  assert.equal(netToneColor(-5_000_000_000), "var(--color-positive)");
});

test("clampPct rounds and bounds to ±50", () => {
  assert.equal(clampPct(3.4), 3);
  assert.equal(clampPct(80), 50);
  assert.equal(clampPct(-99), -50);
});

test("piano codec round-trips through the ordered mission list", () => {
  const missions = SUMMARIES.map((s) => s.mission);
  const ordered = orderedMissionList(missions);
  const scenario = { "Tutela della salute": 15, "Debito pubblico": -12 };
  const encoded = encodePiano(scenario, ordered);
  assert.deepEqual(decodePiano(encoded, ordered), scenario);
});

test("piano codec drops unknown slugs, zero values, and links missing the version prefix", () => {
  const ordered = orderedMissionList(SUMMARIES.map((s) => s.mission));
  assert.deepEqual(decodePiano("v1:missione-che-non-esiste:10,tutela-della-salute:0", ordered), {});
  // A link encoded by a future/older format is dropped rather than misread.
  assert.deepEqual(decodePiano("tutela-della-salute:10", ordered), {});
});

test("piano codec is stable across mission renames: an unknown slug is dropped, not remapped", () => {
  const missions = SUMMARIES.map((s) => s.mission);
  const encoded = encodePiano({ "Tutela della salute": 15 }, missions);
  const renamed = missions.map((mission) =>
    mission === "Tutela della salute" ? "Tutela e promozione della salute" : mission,
  );
  // With index-based encoding this used to silently land on whichever mission
  // took the old alphabetical slot; slug-based encoding just drops it.
  assert.deepEqual(decodePiano(encoded, renamed), {});
});
