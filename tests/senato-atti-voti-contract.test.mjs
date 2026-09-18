import assert from "node:assert/strict";
import test from "node:test";
import attiVotiJson from "../src/data/generated/senato-atti-voti-xix.json" with { type: "json" };
import "./helpers/register-ts-alias.mjs";

const { parseSenatoAttiVotiSnapshot } = await import(
  "../src/lib/data/senato-atti-voti-contract.ts"
);
const { getRepubblicaProfiles, getRepubblicaLegislativeActs } = await import(
  "../src/lib/politici-repubblica.ts"
);

test("senato atti-voti snapshot parses and reconciles coverage", () => {
  const snapshot = parseSenatoAttiVotiSnapshot(attiVotiJson);
  assert.equal(snapshot.chamber, "senato");
  assert.equal(snapshot.coverage.acts, snapshot.acts.length);
  assert.equal(snapshot.coverage.finalVotes, snapshot.finalVotes.length);
  assert.equal(snapshot.coverage.phases, snapshot.acts.reduce((sum, act) => sum + act.phases.length, 0));
  assert.equal(snapshot.soldi.present, false);
  assert.ok(snapshot.caveats.length >= 6);
});

test("nominal tallies reconcile with declared totals on every final vote", () => {
  const snapshot = parseSenatoAttiVotiSnapshot(attiVotiJson);
  for (const vote of snapshot.finalVotes) {
    const counts = { F: 0, C: 0, A: 0, P: 0, M: 0 };
    for (const code of Object.values(vote.votes)) counts[code] += 1;
    assert.equal(counts.F, vote.favorevoli, vote.id);
    assert.equal(counts.C, vote.contrari, vote.id);
    assert.equal(counts.A, vote.astenuti, vote.id);
    assert.equal(vote.favorevoli + vote.contrari + vote.astenuti, vote.votanti, vote.id);
    assert.ok(vote.presenti >= vote.votanti, vote.id);
    assert.equal(vote.approved, vote.favorevoli > vote.maggioranza, vote.id);
  }
});

test("every act's current phase state@ramo belongs to its outcome class", () => {
  const snapshot = parseSenatoAttiVotiSnapshot(attiVotiJson);
  const statesByClass = new Map(
    snapshot.outcomeClasses.map((item) => [item.id, new Set(item.officialStates)]),
  );
  for (const act of snapshot.acts) {
    const stateKey = `${act.currentPhase.state} @ ${act.currentPhase.ramo}`;
    assert.ok(statesByClass.get(act.outcomeClass)?.has(stateKey), `${act.id}: ${stateKey}`);
  }
});

test("senator profiles expose senato legislative activity", () => {
  const snapshot = parseSenatoAttiVotiSnapshot(attiVotiJson);
  const profiles = getRepubblicaProfiles();
  const senatorId = `sen-s${snapshot.acts[0].firstSignerId}`;
  const profile = profiles[senatorId];
  assert.ok(profile, senatorId);
  const activity = profile.legislativeActivity;
  assert.ok(activity);
  assert.equal(activity.chamber, "senato");
  assert.equal(activity.counts.total, activity.counts.firstSigned + activity.counts.coSigned);
  const byOutcomeSum = activity.counts.byOutcome.reduce(
    (sum, row) => sum + row.firstSigned + row.coSigned,
    0,
  );
  assert.equal(byOutcomeSum, activity.counts.total);
  assert.ok(activity.comparison.firstSignedPercentile >= 0);
  assert.ok(activity.comparison.firstSignedPercentile <= 100);
  // percentile = share of the OTHER roster members with fewer first-signed acts
  const senatoCounts = Object.values(profiles)
    .filter((candidate) => candidate.legislativeActivity?.chamber === "senato")
    .map((candidate) => candidate.legislativeActivity.counts.firstSigned);
  const expectedPercentile = Math.round(
    (100 * senatoCounts.filter((count) => count < activity.counts.firstSigned).length) /
      (senatoCounts.length - 1),
  );
  assert.equal(activity.comparison.firstSignedPercentile, expectedPercentile);
  assert.equal(activity.comparison.peerCount, senatoCounts.length - 1);
  assert.ok(activity.recentFirstSigned.length <= 3);
  assert.ok(activity.recentFirstSigned.every((act) => act.phases === undefined));

  const acts = getRepubblicaLegislativeActs(senatorId);
  assert.ok(acts);
  assert.equal(acts.firstSigned.length, activity.counts.firstSigned);
  const voteCodes = new Set(["F", "C", "A", "P", "M", "non-rilevato"]);
  for (const act of [...acts.firstSigned, ...acts.coSigned]) {
    assert.equal(act.chamber, "senato");
    assert.equal(act.phases.at(-1)?.state, act.currentState);
    for (const vote of act.finalVotes) assert.ok(voteCodes.has(vote.ownVote), vote.id);
  }

  const zeroFirstSigned = Object.values(profiles).find(
    (candidate) =>
      candidate.legislativeActivity?.chamber === "senato" &&
      candidate.legislativeActivity.counts.firstSigned === 0,
  );
  assert.ok(zeroFirstSigned);
  assert.equal(zeroFirstSigned.legislativeActivity.comparison.firstSignedPercentile, 0);
});

test("tampered snapshot with a broken tally fails the parse", () => {
  const snapshot = parseSenatoAttiVotiSnapshot(attiVotiJson);
  const mutated = structuredClone(snapshot);
  mutated.finalVotes[0].favorevoli += 1;
  assert.throws(() => parseSenatoAttiVotiSnapshot(mutated));
});

test("tampered snapshot with an unlinked final vote fails the parse", () => {
  const snapshot = parseSenatoAttiVotiSnapshot(attiVotiJson);
  const mutated = structuredClone(snapshot);
  const linked = mutated.acts.find((act) => act.finalVoteIds.length > 0);
  assert.ok(linked);
  linked.finalVoteIds = [];
  assert.throws(() => parseSenatoAttiVotiSnapshot(mutated));
});
