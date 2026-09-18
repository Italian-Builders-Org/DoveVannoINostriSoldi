"""Offline gates for the XIX-legislature judicial proceedings snapshot.

Negative first: every rule that protects a named person must have a test that
proves the pipeline stops instead of publishing.
"""

from __future__ import annotations

import copy
import json
import unittest

from parlamento_giudiziario_xix_snapshot import (
    OUTPUT,
    SnapshotError,
    build_snapshot,
    check_committed,
    load_input,
    load_spec,
    publisher_key,
)


class ParlamentoGiudiziarioSnapshotTest(unittest.TestCase):
    def setUp(self) -> None:
        self.spec = load_spec()
        self.payload = load_input(self.spec)

    def rebuild(self, mutate) -> None:
        payload = copy.deepcopy(self.payload)
        mutate(payload)
        build_snapshot(payload, self.spec)

    def first_case(self, payload, predicate=lambda case: True):
        return next(case for case in payload["cases"] if predicate(case))

    def test_offline_check_passes_on_committed_artifact(self) -> None:
        check_committed(self.spec)

    def test_committed_snapshot_matches_input_projection(self) -> None:
        committed = json.loads(OUTPUT.read_text(encoding="utf-8"))
        rebuilt = build_snapshot(copy.deepcopy(self.payload), self.spec)
        self.assertEqual(committed["coverage"]["cases"], rebuilt["coverage"]["cases"])
        self.assertEqual(committed["totals"], rebuilt["totals"])

    def test_rejects_case_with_a_single_publisher_and_no_official_act(self) -> None:
        def mutate(payload):
            case = self.first_case(payload, lambda c: c["evidenceTier"] == "stampa-concordante")
            case["sources"] = case["sources"][:1]
        with self.assertRaisesRegex(SnapshotError, "editore indipendente"):
            self.rebuild(mutate)

    def test_rejects_two_titles_of_the_same_publisher_group_as_two_sources(self) -> None:
        def mutate(payload):
            case = self.first_case(payload, lambda c: c["evidenceTier"] == "stampa-concordante")
            case["sources"] = [
                {**case["sources"][0], "url": "https://www.repubblica.it/a", "kind": "press"},
                {**case["sources"][0], "url": "https://www.lastampa.it/b", "kind": "press"},
            ]
        with self.assertRaisesRegex(SnapshotError, "editore indipendente"):
            self.rebuild(mutate)

    def test_rejects_official_finding_without_definitive_conviction(self) -> None:
        def mutate(payload):
            case = self.first_case(payload, lambda c: c["status"] == "condanna_non_definitiva")
            case["evidenceLabel"] = "official-finding"
        with self.assertRaisesRegex(SnapshotError, "official-finding"):
            self.rebuild(mutate)

    def test_rejects_declared_outcome_bucket_that_does_not_match_the_status(self) -> None:
        def mutate(payload):
            case = self.first_case(payload, lambda c: c["outcomeBucket"] == "non_condannato")
            case["outcomeBucket"] = "condannato"
        with self.assertRaisesRegex(SnapshotError, "outcomeBucket"):
            self.rebuild(mutate)

    def test_stale_non_definitive_conviction_leaves_the_convicted_count(self) -> None:
        payload = copy.deepcopy(self.payload)
        case = self.first_case(payload, lambda c: c["status"] == "condanna_non_definitiva"
                               and c["outcomeBucket"] == "condannato")
        case["statusAsOf"] = "2005-01-01"
        case["outcomeBucket"] = "esito_ignoto"
        snapshot = build_snapshot(payload, self.spec)
        self.assertLess(
            snapshot["coverage"]["membersByOutcome"]["condannato"],
            self.payload["coverage"]["membersExamined"],
        )
        self.assertGreaterEqual(snapshot["coverage"]["casesByOutcome"].get("esito_ignoto", 0), 1)

    def test_rejects_unknown_status(self) -> None:
        def mutate(payload):
            payload["cases"][0]["status"] = "condanna_morale"
        with self.assertRaisesRegex(SnapshotError, "status fuori contratto"):
            self.rebuild(mutate)

    def test_rejects_member_id_outside_camera_and_senato(self) -> None:
        def mutate(payload):
            payload["cases"][0]["memberId"] = "x999"
        with self.assertRaisesRegex(SnapshotError, "non e un id di Camera o Senato"):
            self.rebuild(mutate)

    def test_rejects_duplicate_case_id(self) -> None:
        def mutate(payload):
            payload["cases"].append(copy.deepcopy(payload["cases"][0]))
        with self.assertRaisesRegex(SnapshotError, "duplicato"):
            self.rebuild(mutate)

    def test_rejects_negative_or_fractional_money(self) -> None:
        def negative(payload):
            self.first_case(payload)["events"][0]["fineEuroCents"] = -100
        with self.assertRaisesRegex(SnapshotError, "non negativo"):
            self.rebuild(negative)

        def fractional(payload):
            self.first_case(payload)["events"][0]["damagesEuroCents"] = 10.5
        with self.assertRaisesRegex(SnapshotError, "centesimi interi"):
            self.rebuild(fractional)

    def test_absent_amount_is_not_read_as_zero(self) -> None:
        payload = copy.deepcopy(self.payload)
        case = self.first_case(payload, lambda c: c["outcomeBucket"] == "contabile")
        for event in case["events"]:
            event["damagesEuroCents"] = None
        snapshot = build_snapshot(payload, self.spec)
        self.assertLess(
            snapshot["totals"]["accountingDamageEuroCents"],
            build_snapshot(copy.deepcopy(self.payload), self.spec)["totals"]["accountingDamageEuroCents"],
        )

    def test_rejects_coverage_that_does_not_add_up(self) -> None:
        def mutate(payload):
            payload["coverage"]["membersSearched"] = 10
        with self.assertRaisesRegex(SnapshotError, "non tornano al totale"):
            self.rebuild(mutate)

    def test_rejects_member_total_drift(self) -> None:
        def mutate(payload):
            payload["coverage"]["membersExamined"] = 500
        with self.assertRaisesRegex(SnapshotError, "parlamentari esaminati"):
            self.rebuild(mutate)

    def test_rejects_missing_caveats(self) -> None:
        def mutate(payload):
            payload["caveats"] = []
        with self.assertRaisesRegex(SnapshotError, "caveats assenti"):
            self.rebuild(mutate)

    def test_rejects_case_without_any_instance(self) -> None:
        def mutate(payload):
            payload["cases"][0]["events"] = []
        with self.assertRaisesRegex(SnapshotError, "nessun grado di giudizio"):
            self.rebuild(mutate)

    def test_rejects_source_without_url_scheme_or_publisher(self) -> None:
        def bad_url(payload):
            self.first_case(payload)["sources"][0]["url"] = "camera.it/x"
        with self.assertRaisesRegex(SnapshotError, "url non valido"):
            self.rebuild(bad_url)

        def no_publisher(payload):
            self.first_case(payload)["sources"][0]["publisher"] = ""
        with self.assertRaisesRegex(SnapshotError, "senza editore"):
            self.rebuild(no_publisher)

    def test_rejects_status_date_in_the_future(self) -> None:
        def mutate(payload):
            payload["cases"][0]["statusAsOf"] = "2999-01-01"
        with self.assertRaisesRegex(SnapshotError, "futuro"):
            self.rebuild(mutate)

    def test_rejects_tampered_input_bytes(self) -> None:
        spec = copy.deepcopy(self.spec)
        spec["source"]["committedInput"]["sha256"] = "0" * 64
        with self.assertRaisesRegex(SnapshotError, "sha256"):
            load_input(spec)

    def test_publisher_key_groups_titles_of_one_publisher(self) -> None:
        groups = self.spec["rules"]["publisherGroups"]
        self.assertEqual(publisher_key("https://www.repubblica.it/x", groups),
                         publisher_key("https://torino.repubblica.it/y", groups))
        self.assertNotEqual(publisher_key("https://www.ansa.it/x", groups),
                            publisher_key("https://www.corriere.it/y", groups))

    def test_archived_copy_keeps_the_identity_of_the_archived_publisher(self) -> None:
        groups = self.spec["rules"]["publisherGroups"]
        archived = "https://web.archive.org/web/2015/http://www.corriere.it/story"
        self.assertEqual(publisher_key(archived, groups), publisher_key("https://www.corriere.it/story", groups))


if __name__ == "__main__":
    unittest.main()
