"""Offline checks for the per-chamber legislature history of XIX members (#556)."""

from __future__ import annotations

import copy
import json
import unittest

from parlamento_mandati_xix_snapshot import (
    OUTPUT,
    SnapshotError,
    check_committed,
    committed_rosters,
    load_spec,
    parse_camera,
    parse_senato,
    validate_snapshot,
)

CAMERA_TYPE = "http://dati.camera.it/ocd/mandatoCamera"
SENATO_TYPE = "http://dati.camera.it/ocd/mandatoSenato"


def uri(value: str) -> dict[str, str]:
    return {"type": "uri", "value": value}


def literal(value: str) -> dict[str, str]:
    return {"type": "literal", "value": value}


def camera_row(mandate: str, kind: str, legislature: str, start: str) -> dict[str, dict[str, str]]:
    return {
        "deputato": uri("http://dati.camera.it/ocd/deputato.rdf/d1_19"),
        "persona": uri("http://dati.camera.it/ocd/persona.rdf/p1"),
        "mandato": uri(mandate),
        "tipo": uri(kind),
        "legislatura": uri(f"http://dati.camera.it/ocd/legislatura.rdf/{legislature}"),
        "inizio": literal(start),
    }


def senato_row(mandate: str, kind: str, legislature: str) -> dict[str, dict[str, str]]:
    return {
        "senatore": uri("http://dati.senato.it/senatore/7"),
        "mandato": uri(f"http://dati.senato.it/mandato/{mandate}"),
        "tipo": uri(kind),
        "legislatura": literal(legislature),
        "inizio": literal("2018-03-23"),
    }


def bindings(*rows: dict[str, dict[str, str]]) -> dict[str, object]:
    return {"results": {"bindings": list(rows)}}


class ParlamentoMandatiXixSnapshotTest(unittest.TestCase):
    def setUp(self) -> None:
        self.payload = json.loads(OUTPUT.read_text(encoding="utf-8"))
        self.locks = load_spec()["source"]["committedResponses"]
        self.rosters = committed_rosters()

    def assert_rejected(self, payload: dict[str, object], **kwargs: object) -> None:
        with self.assertRaises(SnapshotError):
            validate_snapshot(payload, **kwargs)  # type: ignore[arg-type]

    def test_offline_check_passes_on_committed_artifact(self) -> None:
        check_committed(load_spec())

    def test_rejects_response_hash_drift(self) -> None:
        payload = copy.deepcopy(self.payload)
        payload["source"]["senato"]["response"]["sha256"] = "0" * 64
        self.assert_rejected(payload, locks=self.locks)

    def test_rejects_first_term_flag_not_derived_from_mandates(self) -> None:
        payload = copy.deepcopy(self.payload)
        veteran = next(item for item in payload["members"] if not item["firstTermInChamber"])
        veteran["firstTermInChamber"] = True
        self.assert_rejected(payload)

    def test_rejects_parliament_flag_that_ignores_other_chamber(self) -> None:
        payload = copy.deepcopy(self.payload)
        crossed = next(
            item for item in payload["members"]
            if item["firstTermInChamber"] and not item["firstTermInParliament"]
        )
        crossed["firstTermInParliament"] = True
        self.assert_rejected(payload)

    def test_rejects_legislatures_that_do_not_reconcile(self) -> None:
        payload = copy.deepcopy(self.payload)
        payload["members"][0]["legislatures"]["parliament"].insert(0, 3)
        self.assert_rejected(payload)

    def test_rejects_member_without_open_xix_mandate_in_own_chamber(self) -> None:
        payload = copy.deepcopy(self.payload)
        member = payload["members"][0]
        for mandate in member["mandates"]:
            if mandate["legislature"] == 19 and mandate["chamber"] == member["chamber"]:
                mandate["endDate"] = "2024-01-01"
        self.assert_rejected(payload)

    def test_rejects_duplicate_member(self) -> None:
        payload = copy.deepcopy(self.payload)
        payload["members"].append(copy.deepcopy(payload["members"][0]))
        self.assert_rejected(payload)

    def test_rejects_roster_drift_from_committed_politici_snapshots(self) -> None:
        payload = copy.deepcopy(self.payload)
        dropped = next(item for item in payload["members"] if item["chamber"] == "senato")
        payload["members"].remove(dropped)
        payload["coverage"]["senators"] -= 1
        for key, flag in (
            ("firstTermInChamberSenators", "firstTermInChamber"),
            ("firstTermInParliamentSenators", "firstTermInParliament"),
        ):
            payload["coverage"][key] -= int(dropped[flag])
        if any(item["chamber"] != "senato" for item in dropped["mandates"]):
            payload["coverage"]["membersWithOtherChamberMandates"] -= 1
        validate_snapshot(payload)
        self.assert_rejected(payload, rosters=self.rosters)

    def test_rejects_identity_that_does_not_match_source_uri(self) -> None:
        payload = copy.deepcopy(self.payload)
        payload["members"][0]["sourceUri"] = "http://dati.camera.it/ocd/persona.rdf/p1"
        self.assert_rejected(payload)

    def test_camera_parser_counts_other_chamber_mandates_by_official_link(self) -> None:
        parsed = parse_camera(bindings(
            camera_row("http://dati.camera.it/ocd/mandatoSenato.rdf/ms18_1_20180323", SENATO_TYPE, "repubblica_18", "20180323"),
            camera_row("http://dati.camera.it/ocd/mandatoCamera.rdf/mc19_1_20221013", CAMERA_TYPE, "repubblica_19", "20221013"),
        ))
        self.assertEqual(
            [(item["chamber"], item["legislature"]) for item in parsed["d1_19"]["mandates"]],
            [("senato", 18), ("camera", 19)],
        )

    def test_camera_parser_rejects_non_republican_legislature(self) -> None:
        with self.assertRaises(SnapshotError):
            parse_camera(bindings(
                camera_row("http://dati.camera.it/ocd/mandatoCamera.rdf/mc0_1_19460625", CAMERA_TYPE, "costituente", "19460625"),
            ))

    def test_camera_parser_rejects_type_that_contradicts_uri(self) -> None:
        with self.assertRaises(SnapshotError):
            parse_camera(bindings(
                camera_row("http://dati.camera.it/ocd/mandatoCamera.rdf/mc18_1_20180323", SENATO_TYPE, "repubblica_18", "20180323"),
            ))

    def test_senato_parser_rejects_type_that_contradicts_uri(self) -> None:
        with self.assertRaises(SnapshotError):
            parse_senato(bindings(senato_row("S_18_7_1", CAMERA_TYPE, "18")))

    def test_senato_parser_rejects_mandate_of_another_senator(self) -> None:
        with self.assertRaises(SnapshotError):
            parse_senato(bindings(senato_row("S_18_8_1", SENATO_TYPE, "18")))

    def test_senato_parser_rejects_discordant_repeated_mandate(self) -> None:
        first = senato_row("S_18_7_1", SENATO_TYPE, "18")
        second = copy.deepcopy(first)
        second["inizio"] = literal("2019-07-31")
        with self.assertRaises(SnapshotError):
            parse_senato(bindings(first, second))


if __name__ == "__main__":
    unittest.main()
