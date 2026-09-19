import assert from "node:assert/strict";
import test from "node:test";
import attiVotiJson from "../src/data/generated/camera-atti-voti-xix.json" with { type: "json" };
import "./helpers/register-ts-alias.mjs";

const { parseCameraAttiVotiSnapshot } = await import(
  "../src/lib/data/camera-atti-voti-contract.ts"
);
const { getRepubblicaProfiles, getRepubblicaLegislativeActs } = await import(
  "../src/lib/politici-repubblica.ts"
);

test("camera atti-voti snapshot parses and reconciles coverage", () => {
  const snapshot = parseCameraAttiVotiSnapshot(attiVotiJson);
  assert.equal(snapshot.chamber, "camera");
  assert.equal(snapshot.coverage.acts, snapshot.acts.length);
  assert.equal(snapshot.coverage.finalVotes, snapshot.finalVotes.length);
  assert.equal(snapshot.soldi.present, false);
  assert.ok(snapshot.caveats.length >= 5);
});

test("nominal tallies reconcile with declared totals on every final vote", () => {
  const snapshot = parseCameraAttiVotiSnapshot(attiVotiJson);
  for (const vote of snapshot.finalVotes) {
    const counts = { F: 0, C: 0, A: 0, N: 0, V: 0 };
    for (const code of Object.values(vote.votes)) counts[code] += 1;
    assert.equal(counts.F, vote.favorevoli, vote.id);
    assert.equal(counts.C, vote.contrari, vote.id);
    assert.equal(counts.A, vote.astenuti, vote.id);
    assert.equal(vote.favorevoli + vote.contrari, vote.votanti, vote.id);
    assert.equal(vote.favorevoli + vote.contrari + vote.astenuti, vote.presenti, vote.id);
    assert.equal(vote.approved, vote.favorevoli > vote.maggioranza, vote.id);
  }
});

test("every act's current state belongs to its outcome class official states", () => {
  const snapshot = parseCameraAttiVotiSnapshot(attiVotiJson);
  const statesByClass = new Map(
    snapshot.outcomeClasses.map((item) => [item.id, new Set(item.officialStates)]),
  );
  for (const act of snapshot.acts) {
    if (!act.currentState) {
      assert.equal(act.outcomeClass, null, act.id);
      continue;
    }
    assert.ok(statesByClass.get(act.outcomeClass)?.has(act.currentState.state), act.id);
  }
});

test("deputy profiles expose legislative activity; senators never do", () => {
  const snapshot = parseCameraAttiVotiSnapshot(attiVotiJson);
  const profiles = getRepubblicaProfiles();
  const signerNumericId = snapshot.acts[0].firstSignerId.replace(/^d/, "").replace(/_19$/, "");
  const profile = profiles[`dep-${signerNumericId}`];
  assert.ok(profile, `dep-${signerNumericId}`);
  const activity = profile.legislativeActivity;
  assert.ok(activity);
  assert.equal(activity.counts.total, activity.counts.firstSigned + activity.counts.coSigned);
  const byOutcomeSum = activity.counts.byOutcome.reduce(
    (sum, row) => sum + row.firstSigned + row.coSigned,
    0,
  );
  assert.ok(byOutcomeSum <= activity.counts.total);
  const acts = getRepubblicaLegislativeActs(`dep-${signerNumericId}`);
  assert.ok(acts);
  const withState = [...acts.firstSigned, ...acts.coSigned].filter(
    (act) => act.currentState !== null,
  ).length;
  assert.equal(byOutcomeSum, withState);
  assert.ok(activity.comparison.firstSignedPercentile >= 0);
  assert.ok(activity.comparison.firstSignedPercentile <= 100);
  assert.ok(activity.recentFirstSigned.length <= 3);
  assert.equal(acts.firstSigned.length, activity.counts.firstSigned);
  const voteCodes = new Set(["F", "C", "A", "N", "V", "non-rilevato"]);
  for (const act of [...acts.firstSigned, ...acts.coSigned]) {
    for (const vote of act.finalVotes) assert.ok(voteCodes.has(vote.ownVote), vote.id);
  }

  const zeroFirstSigned = Object.values(profiles).find(
    (candidate) => candidate.legislativeActivity && candidate.legislativeActivity.counts.firstSigned === 0,
  );
  assert.ok(zeroFirstSigned);
  assert.equal(zeroFirstSigned.legislativeActivity.comparison.firstSignedPercentile, 0);

  const senator = Object.entries(profiles).find(([, candidate]) =>
    candidate.roles.some((role) => role.kind === "senatore" || role.kind === "senatore-a-vita"),
  );
  assert.ok(senator);
  assert.equal(senator[1].legislativeActivity, null);
  assert.equal(getRepubblicaLegislativeActs(senator[0]), null);
});

test("tampered snapshot with a broken tally fails the parse", () => {
  const snapshot = parseCameraAttiVotiSnapshot(attiVotiJson);
  const mutated = structuredClone(snapshot);
  mutated.finalVotes[0].favorevoli += 1;
  assert.throws(() => parseCameraAttiVotiSnapshot(mutated));
});

test("tampered snapshot with an unlinked final vote fails the parse", () => {
  const snapshot = parseCameraAttiVotiSnapshot(attiVotiJson);
  const mutated = structuredClone(snapshot);
  const linked = mutated.acts.find((act) => act.finalVoteIds.length > 0);
  assert.ok(linked);
  linked.finalVoteIds = [];
  assert.throws(() => parseCameraAttiVotiSnapshot(mutated));
});
