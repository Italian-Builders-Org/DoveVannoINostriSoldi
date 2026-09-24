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
  assert.equal(snapshot.schemaVersion, 2);
  assert.equal(snapshot.chamber, "camera");
  assert.equal(snapshot.coverage.acts, snapshot.acts.length);
  assert.equal(snapshot.coverage.finalVotes, snapshot.finalVotes.length);
  assert.equal(
    snapshot.coverage.finalVotesObserved,
    snapshot.coverage.finalVotes + snapshot.coverage.finalVotesExcluded,
  );
  assert.ok(snapshot.coverage.actsByInitiative.parliamentary > 0);
  assert.ok(snapshot.coverage.actsByInitiative.government > 0);
  assert.equal(snapshot.soldi.present, false);
  assert.ok(snapshot.caveats.length >= 5);
});

test("camera acts keep initiative, formal proposer and responsible government separate", () => {
  const snapshot = parseCameraAttiVotiSnapshot(attiVotiJson);
  const parliamentary = snapshot.acts.find((act) => act.initiative.kind === "parliamentary");
  const government = snapshot.acts.find(
    (act) =>
      act.initiative.kind === "government" &&
      act.finalVoteIds.length > 0 &&
      act.responsibleGovernment !== null,
  );

  assert.ok(parliamentary);
  assert.equal(parliamentary.proposer.kind, "deputy");
  assert.equal(parliamentary.responsibleGovernment, null);
  assert.ok(government);
  assert.equal(government.proposer.kind, "government");
  assert.equal(government.proposer.label, "Governo");
  assert.match(government.responsibleGovernment.id, /^g\d+$/);
  assert.match(government.responsibleGovernment.label, /Governo/);
  assert.match(government.responsibleGovernment.uri, /^http:\/\/dati\.camera\.it\/ocd\/governo\.rdf\/g\d+$/);
  assert.ok(government.finalVoteIds.every((voteId) => snapshot.finalVotes.some((vote) => vote.id === voteId)));
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

test("deputy profiles expose camera legislative activity", () => {
  const snapshot = parseCameraAttiVotiSnapshot(attiVotiJson);
  const profiles = getRepubblicaProfiles();
  const firstParliamentaryAct = snapshot.acts.find((act) => act.proposer.kind === "deputy");
  assert.ok(firstParliamentaryAct);
  const signerNumericId = firstParliamentaryAct.proposer.deputyId.replace(/^d/, "").replace(/_19$/, "");
  const profile = profiles[`dep-${signerNumericId}`];
  assert.ok(profile, `dep-${signerNumericId}`);
  const activity = profile.legislativeActivity;
  assert.ok(activity);
  assert.equal(activity.chamber, "camera");
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
  assert.equal("firstSignedPercentile" in activity.comparison, false);
  assert.equal("peerCount" in activity.comparison, false);
  assert.ok(activity.comparison.chamberMedianFirstSigned >= 0);
  assert.ok(activity.recentFirstSigned.length <= 3);
  assert.ok(activity.recentFirstSigned.every((act) => act.phases === undefined));
  assert.equal(acts.firstSigned.length, activity.counts.firstSigned);
  const voteCodes = new Set(["F", "C", "A", "N", "V", "non-rilevato"]);
  for (const act of [...acts.firstSigned, ...acts.coSigned]) {
    for (const vote of act.finalVotes) assert.ok(voteCodes.has(vote.ownVote), vote.id);
  }

  const governmentAct = snapshot.acts.find(
    (act) => act.initiative.kind === "government" &&
      act.finalVoteIds.some((voteId) => {
        const vote = snapshot.finalVotes.find((candidate) => candidate.id === voteId);
        return vote && Object.keys(vote.votes).length > 0;
      }),
  );
  assert.ok(governmentAct);
  const governmentVote = snapshot.finalVotes.find((vote) => governmentAct.finalVoteIds.includes(vote.id));
  assert.ok(governmentVote);
  const voterNumericId = Object.keys(governmentVote.votes).find(
    (numericId) => profiles[`dep-${numericId}`],
  );
  assert.ok(voterNumericId);
  const voterActs = getRepubblicaLegislativeActs(`dep-${voterNumericId}`);
  assert.ok(voterActs);
  const votedGovernmentAct = voterActs.voted.find((act) => act.id === governmentAct.id);
  assert.ok(votedGovernmentAct);
  assert.equal(votedGovernmentAct.role, "votante");
  assert.equal(votedGovernmentAct.initiative.kind, "government");
  assert.equal(votedGovernmentAct.proposer.label, "Governo");
  assert.ok(votedGovernmentAct.finalVotes.every((vote) => vote.ownVote !== "non-rilevato"));

  const senator = Object.entries(profiles).find(([, candidate]) =>
    candidate.roles.some((role) => role.kind === "senatore" || role.kind === "senatore-a-vita"),
  );
  assert.ok(senator);
  assert.equal(senator[1].legislativeActivity.chamber, "senato");
  const senatorActs = getRepubblicaLegislativeActs(senator[0]);
  assert.ok(senatorActs);
  assert.equal(senatorActs.firstSigned[0]?.chamber ?? "senato", "senato");

  const nonParliamentarian = Object.entries(profiles).find(([, candidate]) =>
    !candidate.roles.some((role) =>
      ["deputato", "senatore", "senatore-a-vita"].includes(role.kind),
    ),
  );
  assert.ok(nonParliamentarian);
  assert.equal(nonParliamentarian[1].legislativeActivity, null);
  assert.equal(getRepubblicaLegislativeActs(nonParliamentarian[0]), null);
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

test("duplicate final vote IDs fail even when coverage is adjusted", () => {
  const mutated = structuredClone(attiVotiJson);
  mutated.finalVotes.push(structuredClone(mutated.finalVotes[0]));
  mutated.coverage.finalVotes += 1;
  mutated.coverage.finalVotesObserved += 1;
  assert.throws(() => parseCameraAttiVotiSnapshot(mutated));
});

test("a final vote links once and only to its declared act", () => {
  const vote = attiVotiJson.finalVotes[0];
  const wrongAct = structuredClone(attiVotiJson);
  wrongAct.acts.find((act) => act.id !== vote.actId).finalVoteIds.push(vote.id);
  assert.throws(() => parseCameraAttiVotiSnapshot(wrongAct));

  const repeatedLink = structuredClone(attiVotiJson);
  repeatedLink.acts.find((act) => act.id === vote.actId).finalVoteIds.push(vote.id);
  assert.throws(() => parseCameraAttiVotiSnapshot(repeatedLink));
});
