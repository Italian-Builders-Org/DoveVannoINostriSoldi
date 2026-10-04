"""Offline checks for the six pinned OpenCivitas FC60 per-function 2019 snapshots."""
from __future__ import annotations

from decimal import Decimal
import io
import json
import unittest
from zipfile import ZipFile

from opencivitas_common import StructuralError
from opencivitas_function_release import (
    load_raw_data,
    per_capita_reconciles,
    scientific_historical,
    semantic_digest,
    validate_snapshot,
    verify_bytes,
    verify_national_totals,
)
from opencivitas_2019_amministrazione_snapshot import RELEASE as AMMINISTRAZIONE
from opencivitas_2019_istruzione_snapshot import RELEASE as ISTRUZIONE
from opencivitas_2019_polizia_snapshot import RELEASE as POLIZIA
from opencivitas_2019_rifiuti_snapshot import RELEASE as RIFIUTI
from opencivitas_2019_sociale_asili_snapshot import RELEASE as SOCIALE_ASILI
from opencivitas_2019_viabilita_snapshot import RELEASE as VIABILITA

# family, function, published Comuni, excluded ISTAT codes (empty or scientific historical)
EXPECTED = {
    ISTRUZIONE: ("FC60ISTRUZ", "ISTRUZIONE", 6555, {"065040", "001134"}),
    POLIZIA: ("FC60POLIZIA", "POLIZIA", 6564, set()),
    VIABILITA: ("FC60TERRVIAB", "TERR_VIAB", 6566, set()),
    RIFIUTI: ("FC60RIFIUTI", "RIFIUTI", 6567, set()),
    SOCIALE_ASILI: ("FC60SOCNID", "SOCIALE E NIDO", 6566, {"101016"}),
    AMMINISTRAZIONE: ("FC60AMMIN", "AMMINISTRAZIONE", 6494, set()),
}


def load(release) -> dict:
    return json.loads(release.output.read_text(encoding="utf-8"))


def rows(snapshot: dict) -> list[dict]:
    return [dict(zip(snapshot["municipalityColumns"], row)) for row in snapshot["municipalityRows"]]


def csv_zip(text: str) -> bytes:
    buffer = io.BytesIO()
    with ZipFile(buffer, "w") as archive:
        archive.writestr("data.csv", text)
    return buffer.getvalue()


class OpenCivitas2019FunctionsSnapshotTest(unittest.TestCase):
    def test_committed_snapshots_match_semantic_pins_and_coverage(self) -> None:
        for release, (family, function, municipalities, excluded) in EXPECTED.items():
            with self.subTest(family=family):
                snapshot = load(release)
                validate_snapshot(release, snapshot)
                self.assertEqual(semantic_digest(snapshot), release.semantic_sha256)
                self.assertEqual(snapshot["referenceYear"], 2019)
                self.assertEqual(snapshot["source"]["family"], family)
                self.assertEqual(snapshot["coverage"]["function"], function)
                self.assertEqual(snapshot["coverage"]["municipalities"], municipalities)
                self.assertEqual(len(snapshot["municipalityRows"]), municipalities)
                codes = {row["istatCode"] for row in rows(snapshot)}
                self.assertFalse(codes & excluded)
                self.assertFalse(any(row["region"] in {"SICILIA", "EMILIA ROMAGNA"} for row in rows(snapshot)))
                self.assertIn("FC60TOT 2019", snapshot["methodology"]["functionSeparationWarning"])

    def test_tampering_and_pre_release_timestamps_are_rejected(self) -> None:
        for mutate in (
            lambda value: value.update(referenceYear=2021),
            lambda value: value["source"].update(family="FC60TOT"),
            lambda value: value["municipalityRows"][0].__setitem__(4, value["municipalityRows"][0][4] + 1),
            lambda value: (value.update(generatedAt="2023-01-01T00:00:00Z"), value["source"].update(observedAt="2023-01-01T00:00:00Z")),
        ):
            snapshot = load(POLIZIA)
            mutate(snapshot)
            with self.assertRaises(StructuralError):
                validate_snapshot(POLIZIA, snapshot)

    def test_national_totals_stay_pinned_including_the_non_reproportioned_function(self) -> None:
        for release in EXPECTED:
            with self.subTest(family=release.family):
                spec = release.spec
                totals = spec["nationalTotals"]
                published = rows(load(release))
                verify_national_totals(release, spec, published, totals["standardSpendingCentsExcluded"])
                drifted = [dict(row) for row in published]
                drifted[0]["standardSpendingCents"] += 10 ** 6
                with self.assertRaises(StructuralError):
                    verify_national_totals(release, spec, drifted, totals["standardSpendingCentsExcluded"])
                with self.assertRaises(StructuralError):
                    verify_national_totals(release, spec, published, totals["standardSpendingCentsExcluded"] + 1)
        # Sociale e asili nido: la fonte non riproporziona; il contratto non lo finge.
        socnid = SOCIALE_ASILI.spec["nationalTotals"]
        self.assertFalse(socnid["reproportioned"])
        self.assertGreater(socnid["standardSpendingCentsPublished"], socnid["historicalSpendingCents"])
        self.assertIn("non riproporziona", load(SOCIALE_ASILI)["methodology"]["nationalDifferenceWarning"])
        self.assertTrue(all(release.spec["nationalTotals"]["reproportioned"] for release in EXPECTED if release is not SOCIALE_ASILI))

    def test_per_capita_reconciliation_tolerates_only_the_last_published_digit(self) -> None:
        # Nola, Istruzione 2019: 1 € e 0,0000291834 € per abitante su circa 34.266 abitanti.
        population = Decimal("2227235.1502") / Decimal("64.998399293")
        self.assertTrue(per_capita_reconciles(Decimal("1"), Decimal("0.0000291834"), population))
        self.assertFalse(per_capita_reconciles(Decimal("1"), Decimal("0.0000293834"), population))
        self.assertFalse(per_capita_reconciles(Decimal("1000"), Decimal("0.0291834"), population * Decimal("1.01")))
        nola = next(row for row in rows(load(ISTRUZIONE)) if row["istatCode"] == "063050")
        self.assertEqual(nola["historicalSpendingCents"], 100)

    def test_scientific_notation_is_excluded_not_rewritten_to_zero(self) -> None:
        cell = lambda value: {"value": value, "anomaly": "", "privacy": ""}
        self.assertTrue(scientific_historical({"SPESA_STORICA": cell("2,728484E-12"), "SPESA_STORICA_PROAB": cell("1,193041E-15")}))
        self.assertFalse(scientific_historical({"SPESA_STORICA": cell("0"), "SPESA_STORICA_PROAB": cell("0")}))
        self.assertEqual(ISTRUZIONE.spec["excludedScientificHistorical"], ["SA040SIF11AE", "TO134SIF11HT"])
        self.assertEqual(SOCIALE_ASILI.spec["excludedScientificHistorical"], ["KR016SIF11FI"])

    def test_declared_csv_schema_and_encoding_are_enforced(self) -> None:
        # FC60RIFIUTI non pubblica Privacy: un CSV con Privacy non è lo stesso rilascio.
        with self.assertRaisesRegex(StructuralError, "schema CSV"):
            load_raw_data(RIFIUTI, RIFIUTI.spec, csv_zip("USERNAME;Indicatore/Determinante;Valore;Anomalia;Privacy\n"))
        with self.assertRaisesRegex(StructuralError, "numero di righe"):
            load_raw_data(RIFIUTI, RIFIUTI.spec, csv_zip("USERNAME;Indicatore/Determinante;Valore;Anomalia\nX;SPESA_STORICA;1;\n"))
        # Amministrazione è cp1252: il simbolo dell'euro arriva intatto nei motivi della fonte.
        self.assertEqual(AMMINISTRAZIONE.spec["csvEncoding"], "cp1252")
        reasons = [row["spendingAssessmentReason"] for row in rows(load(AMMINISTRAZIONE)) if row["istatCode"] == "015016"]
        self.assertEqual(reasons, ["Spesa storica inferiore a 25 € procapite, valore individuato come spesa minima per l'erogazione dei servizi di Amministrazione"])

    def test_bytes_must_match_the_lock(self) -> None:
        with self.assertRaisesRegex(StructuralError, "byte/SHA-256"):
            verify_bytes(POLIZIA, POLIZIA.spec, b"not the official zip", "data")


if __name__ == "__main__":
    unittest.main()
