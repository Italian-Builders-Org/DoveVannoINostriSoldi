import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import "./helpers/register-ts-alias.mjs";

const { getGovernmentScorecardV6SupplementalSnapshot } = await import("../src/lib/data/government-scorecard-page-contract.ts");
const { GOVERNMENT_SCORECARD_V6_CHRONOLOGY } = await import("../src/lib/government-scorecard-chronology.ts");
const {
  GOVERNMENT_DEBATE_QUESTIONS,
  buildGovernmentDebateAnswers,
} = await import("../src/lib/government-debate-questions.ts");

const snapshot = getGovernmentScorecardV6SupplementalSnapshot();
const answers = buildGovernmentDebateAnswers();
const rawPoint = (indicatorId, geography, period) => snapshot.series
  .find((series) => series.indicator_id === indicatorId)
  ?.geographies.find((entry) => entry.geography === geography)
  ?.points.find((point) => point.period === period);

test("every question covers all governments in chronological order", () => {
  assert.equal(answers.length, GOVERNMENT_DEBATE_QUESTIONS.length);
  assert.ok(answers.length >= 5);
  assert.equal(new Set(answers.map((answer) => answer.id)).size, answers.length);
  for (const answer of answers) {
    assert.ok(snapshot.series.some((series) => series.indicator_id === answer.indicator_id), answer.indicator_id);
    assert.deepEqual(answer.rows.map((row) => row.government_id), GOVERNMENT_SCORECARD_V6_CHRONOLOGY.map((government) => government.id));
    assert.equal(answer.rows.at(-1).status, "current");
    assert.ok(answer.rows.slice(0, -1).every((row) => row.status === "ended"));
  }
});

test("answers use the published Italian values at the mandate boundaries, without filling gaps", () => {
  let compared = 0;
  for (const answer of answers) {
    for (const row of answer.rows) {
      if (row.change === null) {
        assert.equal(typeof row.missing_reason, "string", `${answer.id}/${row.government_id}`);
        continue;
      }
      assert.equal(row.missing_reason, null);
      const first = rawPoint(answer.indicator_id, "IT", row.first.period);
      const last = rawPoint(answer.indicator_id, "IT", row.last.period);
      assert.equal(row.first.value, first.value);
      assert.equal(row.last.value, last.value);
      assert.ok(Math.abs(row.change - (last.value - first.value)) < 1e-9);
      assert.ok(row.first.period < row.last.period);
      // The starting period may begin before the oath, but never after the mandate ends.
      assert.ok(first.period_start < (row.end_date ?? snapshot.as_of_date));
      assert.ok(last.period_start >= row.start_date.slice(0, 4), "periodo finale precedente al mandato");
      if (/-Q[1-4]$/.test(row.last.period)) assert.equal(row.first.period.slice(-3), row.last.period.slice(-3));
      assert.deepEqual(row.peers.map((peer) => peer.id), ["FR", "DE", "ES"]);
      compared += 1;
    }
  }
  assert.ok(compared > 60, `solo ${compared} confronti calcolati`);
});

test("a known mandate compares the same quarter, as the government page does", () => {
  const debt = answers.find((answer) => answer.indicator_id === "debt_ratio");
  assert.ok(debt);
  const row = debt.rows.find((candidate) => candidate.government_id === "berlusconi-iv");
  // Oath 2008-05-08 (Q2), successor 2011-11-16: last published quarter 2011-Q4,
  // so the baseline is the first Q4 inside the mandate, not Q2.
  assert.equal(row.last.period, "2011-Q4");
  assert.equal(row.first.period, "2008-Q4");
  const monthly = answers.find((answer) => answer.indicator_id === "unemployment")
    .rows.find((candidate) => candidate.government_id === "berlusconi-iv");
  assert.equal(monthly.first.period, "2008-05");
  assert.equal(monthly.last.period, "2011-11");
  assert.deepEqual(row.event_numbers, [2, 3], "crisi finanziaria e debiti sovrani");
  assert.equal(row.start_date, "2008-05-08");
  assert.equal(row.end_date, "2011-11-16");
  const unavailable = debt.rows.find((candidate) => candidate.government_id === "dini-i");
  assert.equal(unavailable.change, null, "il debito/PIL trimestrale parte nel 2000");
});

test("public copy stays descriptive: no verdicts, rankings or blame", () => {
  const copy = JSON.stringify(GOVERNMENT_DEBATE_QUESTIONS);
  assert.doesNotMatch(copy, /ranking|vincitore|classifica|colpa|merito|bocciat|promoss/i);
  const page = readFileSync(new URL("../src/app/governi/domande/page.tsx", import.meta.url), "utf8");
  assert.match(page, /GOVERNMENT_SCORECARD_V6_CAUSAL_DISCLAIMER/);
  assert.match(page, /href="\/governi"/);
  assert.doesNotMatch(page, /ranking|vincitore|classifica/i);
});
