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
  assert.equal("firstSignedPercentile" in activity.comparison, false);
  assert.equal("peerCount" in activity.comparison, false);
  assert.ok(activity.comparison.chamberMedianFirstSigned >= 0);
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

});

test("senators expose their verified final votes with parliamentary attribution", () => {
  const snapshot = parseSenatoAttiVotiSnapshot(attiVotiJson);
  const profiles = getRepubblicaProfiles();
  const act = snapshot.acts.find((candidate) => candidate.finalVoteIds.some((voteId) => {
    const vote = snapshot.finalVotes.find((item) => item.id === voteId);
    return vote && Object.keys(vote.votes).some((numericId) => profiles[`sen-s${numericId}`]);
  }));
  assert.ok(act, "atto con voto nominale e senatore nel roster");
  const linkedVotes = act.finalVoteIds.map((voteId) => snapshot.finalVotes.find((vote) => vote.id === voteId));
  const numericId = linkedVotes.flatMap((vote) => Object.keys(vote?.votes ?? {})).find(
    (candidate) => profiles[`sen-s${candidate}`],
  );
  assert.ok(numericId, "senatore votante nel roster");

  const acts = getRepubblicaLegislativeActs(`sen-s${numericId}`);
  assert.ok(acts);
  const voted = acts.voted.find((candidate) => candidate.id === act.id);
  assert.ok(voted, act.id);
  assert.equal(voted.role, "votante");
  assert.deepEqual(voted.initiative, { kind: "parliamentary", label: "Parlamentare" });
  assert.equal(voted.proposer?.kind, "senator");
  assert.equal(voted.proposer?.id, `sen-s${act.firstSignerId}`);
  assert.ok(voted.proposer?.label.length > 0);
  assert.equal(voted.responsibleGovernment, null);
  assert.ok(voted.finalVotes.length > 0);
  assert.ok(voted.finalVotes.every((vote) => vote.ownVote !== "non-rilevato"));
});

test("a government bill reaches the senator vote trail with official attribution", () => {
  const snapshot = parseSenatoAttiVotiSnapshot(attiVotiJson);
  const act = snapshot.acts.find((item) => item.id === "ddl-52421");
  const vote = snapshot.finalVotes.find((item) => item.id === "19-98-11");
  assert.ok(act?.finalVoteIds.includes(vote?.id));
  const profiles = getRepubblicaProfiles();
  const numericId = Object.keys(vote.votes).find((id) => profiles[`sen-s${id}`]);
  assert.ok(numericId);
  const voted = getRepubblicaLegislativeActs(`sen-s${numericId}`).voted
    .find((item) => item.id === act.id);
  assert.deepEqual(voted.initiative, { kind: "government", label: "Governativa" });
  assert.equal(voted.proposer.kind, "government");
  assert.match(voted.proposer.label, /Giancarlo Giorgetti/u);
  assert.equal(voted.responsibleGovernment.label, "Governo Meloni-I");
  assert.ok(voted.finalVotes.some((item) => item.id === vote.id));
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

test("tampered snapshot with a duplicate final vote fails the parse", () => {
  const mutated = structuredClone(attiVotiJson);
  mutated.finalVotes.push(structuredClone(mutated.finalVotes[0]));
  mutated.coverage.finalVotes += 1;
  assert.throws(() => parseSenatoAttiVotiSnapshot(mutated));
});

test("tampered government attribution fails the parse", () => {
  const mutated = structuredClone(attiVotiJson);
  const act = mutated.acts.find((item) => item.initiativeKind === "government");
  assert.ok(act);
  act.governmentLabels = ["Governo Inventato"];
  assert.throws(() => parseSenatoAttiVotiSnapshot(mutated));
});
