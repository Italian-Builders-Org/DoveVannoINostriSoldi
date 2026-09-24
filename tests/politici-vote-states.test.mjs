import assert from "node:assert/strict";
import test from "node:test";
import "./helpers/register-ts-alias.mjs";

const {
  addRepublicVoteState,
  countRepublicVoteStates,
  emptyRepublicVoteStateCounts,
  isRepublicActVote,
  OWN_VOTE_LABELS,
} = await import("../src/lib/politici-vote-states.ts");

test("vote states keep every official code separate and leave mandate coverage unavailable", () => {
  const counts = emptyRepublicVoteStateCounts();
  for (const code of ["F", "C", "A", "N", "P", "M", "V", "non-rilevato"]) {
    assert.equal(isRepublicActVote(code), true);
    addRepublicVoteState(counts, code);
  }

  assert.deepEqual(counts, {
    favorevoli: 1,
    contrari: 1,
    astenuti: 1,
    mancatePartecipazioni: 1,
    presenzeSenzaVoto: 1,
    missioniOCongedi: 1,
    votiSegreti: 1,
    datiNonRilevati: 1,
    fuoriMandato: null,
  });
  assert.equal(countRepublicVoteStates(counts), 8);
  assert.equal(OWN_VOTE_LABELS.P, "Presente non votante");
  assert.equal(OWN_VOTE_LABELS.M, "In congedo o missione");
  assert.equal(OWN_VOTE_LABELS["non-rilevato"], "Voto non rilevato nella fonte");
  assert.equal(isRepublicActVote("fuori-mandato"), false);
});

test("outside-mandate zero stays distinct from unavailable coverage", () => {
  const unavailable = emptyRepublicVoteStateCounts();
  assert.equal(unavailable.fuoriMandato, null);
  assert.notEqual(unavailable.fuoriMandato, 0);
  assert.equal(countRepublicVoteStates({ ...unavailable, fuoriMandato: 0 }), 0);
});
