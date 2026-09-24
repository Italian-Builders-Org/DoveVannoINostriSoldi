"""Offline checks for the Senato bills/phases/final-votes snapshot."""

from __future__ import annotations

import copy
import json
import unittest
from collections import Counter
from unittest.mock import patch

import senato_atti_voti_xix_snapshot as producer

from senato_atti_voti_xix_snapshot import (
    OUTPUT,
    SnapshotError,
    check_committed,
    load_spec,
    validate_snapshot,
)


def committed() -> dict:
    return json.loads(OUTPUT.read_text(encoding="utf-8"))


class SenatoAttiVotiXixSnapshotTest(unittest.TestCase):
    def test_offline_check_passes_on_committed_artifact(self) -> None:
        check_committed(load_spec())

    def test_government_final_vote_retains_formal_proposers(self) -> None:
        payload = committed()
        act = next(act for act in payload["acts"] if act["id"] == "ddl-52421")
        self.assertEqual(act["initiativeKind"], "government")
        self.assertIsNone(act["firstSignerId"])
        self.assertIn("19-98-11", act["finalVoteIds"])
        self.assertIn("Governo Meloni-I", act["governmentLabels"])
        self.assertTrue(any("Giancarlo Giorgetti" in name for name in act["formalProposers"]))

    def test_nominal_tallies_reconcile_with_totals(self) -> None:
        for vote in committed()["finalVotes"]:
            counts = Counter(vote["votes"].values())
            self.assertEqual(counts["F"], vote["favorevoli"], vote["id"])
            self.assertEqual(counts["C"], vote["contrari"], vote["id"])
            self.assertEqual(counts["A"], vote["astenuti"], vote["id"])

    def test_senato_presenti_cover_votanti(self) -> None:
        """Al Senato gli astenuti sono votanti: presenti >= votanti e
        votanti = favorevoli + contrari + astenuti su ogni votazione."""
        for vote in committed()["finalVotes"]:
            self.assertGreaterEqual(vote["presenti"], vote["votanti"], vote["id"])
            self.assertEqual(
                vote["favorevoli"] + vote["contrari"] + vote["astenuti"],
                vote["votanti"],
                vote["id"],
            )

    def test_current_phase_belongs_to_outcome_class(self) -> None:
        payload = committed()
        class_states = {
            item["id"]: set(item["officialStates"]) for item in payload["outcomeClasses"]
        }
        for act in payload["acts"]:
            current = act["currentPhase"]
            entry = f"{current['state']} @ {current['ramo']}"
            self.assertIn(entry, class_states[act["outcomeClass"]], act["id"])

    def test_coverage_reconciles(self) -> None:
        payload = committed()
        coverage = payload["coverage"]
        self.assertEqual(coverage["acts"], len(payload["acts"]))
        self.assertEqual(coverage["phases"], sum(len(act["phases"]) for act in payload["acts"]))
        self.assertEqual(coverage["finalVotes"], len(payload["finalVotes"]))
        self.assertEqual(
            coverage["signatures"],
            sum(1 + len(act["coSignerIds"]) for act in payload["acts"] if act["firstSignerId"]),
        )
        self.assertEqual(coverage["actsByInitiative"]["government"],
                         sum(act["initiativeKind"] == "government" for act in payload["acts"]))
        self.assertEqual(coverage["actsObservedWithInitiative"],
                         coverage["acts"] + coverage["actsExcludedOtherInitiative"]
                         + coverage["actsExcludedNoEligibleSenatePhase"])
        self.assertGreaterEqual(coverage["finalVotes"] + coverage["finalVotesOnOtherActs"],
                                load_spec()["coverageFloor"]["finalVotesObserved"])
        self.assertEqual(
            sum(coverage["actsByOutcomeClass"].values()), len(payload["acts"])
        )

    def test_validate_rejects_response_lock_drift(self) -> None:
        payload = committed()
        spec = load_spec()
        locks = copy.deepcopy(spec["source"]["committedResponses"])
        locks["phases"]["sha256"] = "0" * 64
        with self.assertRaises(SnapshotError):
            validate_snapshot(payload, locks=locks)

    def test_validate_rejects_duplicate_final_vote(self) -> None:
        payload = committed()
        payload["finalVotes"].append(copy.deepcopy(payload["finalVotes"][0]))
        payload["coverage"]["finalVotes"] += 1
        payload["coverage"]["nominalVotes"] += len(payload["finalVotes"][0]["votes"])
        with self.assertRaises(SnapshotError):
            validate_snapshot(payload)

    def test_keyset_rejects_repeated_full_page(self) -> None:
        rows = [
            {"ddl": {"value": f"http://dati.senato.it/ddl/{number}"}}
            for number in (1, 2)
        ]
        payload = {"results": {"bindings": rows}}
        query = "SELECT ?ddl WHERE { ?ddl a <urn:bill> . }\nORDER BY ?ddl"
        with patch.object(producer, "PAGE_SIZE", 2), patch.object(
            producer, "sparql_fetch", return_value=(payload, b"{}")
        ):
            with self.assertRaises(SnapshotError):
                producer.sparql_fetch_keyset(query, "ddl")

    def test_validate_rejects_unmapped_state_ramo_pair(self) -> None:
        payload = committed()
        act = payload["acts"][0]
        act["currentPhase"]["state"] = "Stato inventato"
        with self.assertRaises(SnapshotError):
            validate_snapshot(payload)

    def test_validate_rejects_non_senate_bill_number(self) -> None:
        payload = committed()
        payload["acts"][0]["number"] = "C.123"
        with self.assertRaises(SnapshotError):
            validate_snapshot(payload)

    def test_validate_rejects_first_signer_among_co_signers(self) -> None:
        payload = committed()
        act = payload["acts"][0]
        act["coSignerIds"].append(act["firstSignerId"])
        with self.assertRaises(SnapshotError):
            validate_snapshot(payload)

    def test_validate_rejects_non_presentato_initial_phase(self) -> None:
        payload = committed()
        act = payload["acts"][0]
        lowest = act["phases"][0]["progressivo"]
        for phase in act["phases"]:
            if phase["progressivo"] == lowest and phase["ramo"] == "S":
                phase["kind"] = "trasmesso"
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


if __name__ == "__main__":
    unittest.main()
