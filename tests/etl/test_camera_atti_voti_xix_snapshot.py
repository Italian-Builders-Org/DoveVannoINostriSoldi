"""Offline checks for the Camera acts/iter/final-votes snapshot."""

from __future__ import annotations

import copy
import json
import unittest
from collections import Counter

from camera_atti_voti_xix_snapshot import (
    OUTPUT,
    SnapshotError,
    check_committed,
    load_spec,
    validate_snapshot,
)


def committed() -> dict:
    return json.loads(OUTPUT.read_text(encoding="utf-8"))


class CameraAttiVotiXixSnapshotTest(unittest.TestCase):
    def test_offline_check_passes_on_committed_artifact(self) -> None:
        check_committed(load_spec())

    def test_nominal_tallies_reconcile_with_totals(self) -> None:
        for vote in committed()["finalVotes"]:
            counts = Counter(vote["votes"].values())
            self.assertEqual(counts["F"], vote["favorevoli"], vote["id"])
            self.assertEqual(counts["C"], vote["contrari"], vote["id"])
            self.assertEqual(counts["A"], vote["astenuti"], vote["id"])

    def test_current_state_belongs_to_outcome_class(self) -> None:
        payload = committed()
        class_states = {
            item["id"]: set(item["officialStates"]) for item in payload["outcomeClasses"]
        }
        for act in payload["acts"]:
            current = act["currentState"]
            if current is None:
                self.assertIsNone(act["outcomeClass"], act["id"])
                continue
            self.assertIn(current["state"], class_states[act["outcomeClass"]], act["id"])

    def test_coverage_acts_reconciles(self) -> None:
        payload = committed()
        self.assertEqual(payload["coverage"]["acts"], len(payload["acts"]))
        initiatives = Counter(act["initiative"]["kind"] for act in payload["acts"])
        self.assertEqual(payload["coverage"]["actsByInitiative"], {
            "parliamentary": initiatives["parliamentary"],
            "government": initiatives["government"],
        })

    def test_final_vote_coverage_reconciles_included_and_excluded(self) -> None:
        payload = committed()
        coverage = payload["coverage"]
        self.assertEqual(
            coverage["finalVotesObserved"],
            coverage["finalVotes"] + coverage["finalVotesExcluded"],
        )

    def test_coverage_outcome_classes_reconcile(self) -> None:
        payload = committed()
        with_state = sum(1 for act in payload["acts"] if act["currentState"] is not None)
        self.assertEqual(sum(payload["coverage"]["actsByOutcomeClass"].values()), with_state)

    def test_validate_rejects_response_lock_drift(self) -> None:
        payload = committed()
        spec = load_spec()
        locks = copy.deepcopy(spec["source"]["committedResponses"])
        locks["acts"]["sha256"] = "0" * 64
        with self.assertRaises(SnapshotError):
            validate_snapshot(payload, locks=locks)

    def test_validate_rejects_unknown_iter_state(self) -> None:
        payload = committed()
        for act in payload["acts"]:
            if act["iter"]:
                act["iter"][0]["state"] = "Stato inventato"
                break
        else:
            self.fail("nessun atto con iter nel fixture")
        with self.assertRaises(SnapshotError):
            validate_snapshot(payload)

    def test_validate_rejects_official_state_in_wrong_class(self) -> None:
        payload = committed()
        classes = {item["id"]: item for item in payload["outcomeClasses"]}
        ritirato_state = classes["ritirato"]["officialStates"][0]
        assegnato_state = classes["assegnato"]["officialStates"][0]
        classes["ritirato"]["officialStates"][0] = assegnato_state
        classes["assegnato"]["officialStates"][0] = ritirato_state
        with self.assertRaises(SnapshotError):
            validate_snapshot(payload)

    def test_validate_rejects_first_signer_among_co_signers(self) -> None:
        payload = committed()
        act = next(act for act in payload["acts"] if act["proposer"]["kind"] == "deputy")
        act["coSignerIds"].append(act["proposer"]["deputyId"])
        with self.assertRaises(SnapshotError):
            validate_snapshot(payload)

    def test_validate_rejects_government_act_attributed_to_a_deputy(self) -> None:
        payload = committed()
        act = next(act for act in payload["acts"] if act["initiative"]["kind"] == "government")
        act["proposer"] = {"kind": "deputy", "deputyId": "d1_19"}
        with self.assertRaises(SnapshotError):
            validate_snapshot(payload)

    def test_validate_rejects_repeated_or_foreign_final_vote_link(self) -> None:
        for repeated in (False, True):
            with self.subTest(repeated=repeated):
                payload = committed()
                vote = payload["finalVotes"][0]
                act = next(act for act in payload["acts"]
                           if (act["id"] == vote["actId"]) == repeated)
                act["finalVoteIds"].append(vote["id"])
                with self.assertRaises(SnapshotError):
                    validate_snapshot(payload)


if __name__ == "__main__":
    unittest.main()
