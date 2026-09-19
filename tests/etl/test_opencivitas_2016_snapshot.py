import copy
from decimal import Decimal
import json
from pathlib import Path
import unittest
from unittest.mock import patch

import opencivitas_2016_snapshot as snapshot
from opencivitas_common import StructuralError, decimal_value, load_raw_data

FC30_SAMPLE = json.loads(Path("tests/fixtures/opencivitas-2016-source-sample.json").read_text(encoding="utf-8"))
COMMITTED = json.loads(snapshot.OUTPUT.read_text(encoding="utf-8"))


class FC30ReleaseTests(unittest.TestCase):
    def test_definitions_keep_the_verified_25_definition_shape(self):
        snapshot.verify_definitions(FC30_SAMPLE["definitions"])
        for field, value in [
            ("VAR_IND_DES", "Spesa standard - migliaia di euro"),
            ("VAR_IND_FUNZIONE", "ISTRUZIONE"),
            ("VAR_IND_TIP", "NAVIGA"),
            ("VAR_IND_LINGUA", "EN"),
        ]:
            definitions = copy.deepcopy(FC30_SAMPLE["definitions"])
            definitions[0][field] = value
            with self.subTest(field=field), self.assertRaises(StructuralError):
                snapshot.verify_definitions(definitions)
        with self.assertRaises(StructuralError):
            snapshot.verify_definitions(FC30_SAMPLE["definitions"] + FC30_SAMPLE["definitions"][:1])

    def test_join_rejects_rss_unknown_entities_missing_indicators_and_flags(self):
        username = FC30_SAMPLE["username"]
        totals = {
            "historicalSpendingCents": 0, "standardSpendingCents": 0,
            "roundingToleranceCents": 10 ** 12,
            "note": FC30_SAMPLE["username"],
        }
        with patch.dict(snapshot.SPEC, {
            "municipalities": 1,
            "regionCounts": {"LAZIO": 1},
            "excludedAggregates": ["ZZ999ITA001"],
            "nationalTotals": totals,
        }):
            entities = {username: copy.deepcopy(FC30_SAMPLE["entity"])}
            raw = {username: copy.deepcopy(FC30_SAMPLE["indicators"]), "ZZ999ITA001": {}}
            with patch.object(snapshot, "verify_national_totals", lambda rows: None):
                self.assertEqual(len(snapshot.normalize_rows(entities, raw)), 1)
                for change in ("rss", "unknown", "missing", "flag", "coverage"):
                    with self.subTest(change=change):
                        changed_entities, changed_raw = copy.deepcopy(entities), copy.deepcopy(raw)
                        if change == "rss": changed_entities[username]["region"] = "SICILIA"
                        if change == "unknown": changed_raw["UNKNOWN"] = {}
                        if change == "missing": del changed_raw[username]["SPESA_STORICA"]
                        if change == "flag": changed_raw[username]["SPESA_STORICA"]["privacy"] = "cod_privacy"
                        if change == "coverage": del changed_raw[username]
                        with self.assertRaises(StructuralError):
                            snapshot.normalize_rows(changed_entities, changed_raw)

    def test_declared_decimal_separator_is_not_guessed(self):
        """Il 2016 pubblica il punto: la virgola degli anni recenti deve fallire, e viceversa."""
        self.assertEqual(decimal_value("1234.5", "test", decimal_separator="."), Decimal("1234.5"))
        with self.assertRaisesRegex(StructuralError, "formato numerico"):
            decimal_value("1234,5", "test", decimal_separator=".")
        with self.assertRaisesRegex(StructuralError, "formato numerico"):
            decimal_value("1234.5", "test", decimal_separator=",")
        with self.assertRaisesRegex(StructuralError, "separatore decimale"):
            decimal_value("1234.5", "test", decimal_separator=";")

    def test_declared_encoding_is_not_guessed(self):
        """Il CSV 2016 è cp1252: leggerlo come UTF-8 deve fallire invece di ripiegare."""
        payload = Path("tests/fixtures/opencivitas-2016-latin1-sample.zip").read_bytes()
        rows = load_raw_data(payload, encoding="cp1252")
        self.assertEqual(rows["FR001SIF11RZ"]["DESCR_NON_VALUTABILE_OUT_TOT"]["value"], "Viabilità e Territorio")
        with self.assertRaises(UnicodeDecodeError):
            load_raw_data(payload)

    def test_byte_locks_and_entire_committed_artifact_fail_closed(self):
        for key in ("data", "entities", "indicators"):
            with self.assertRaisesRegex(StructuralError, "byte/SHA-256"):
                snapshot.verify_bytes(b"PK-invalid", key)
        snapshot.validate_snapshot(copy.deepcopy(COMMITTED))
        for change in ("amount", "period", "license", "hash", "coverage", "encoding"):
            altered = copy.deepcopy(COMMITTED)
            if change == "amount":
                altered["municipalityRows"][0][4] += 100
                altered["municipalityRows"][0][6] += 100
            if change == "period": altered["referenceYear"] = 2017
            if change == "license": altered["source"]["license"] = "Unverified"
            if change == "hash": altered["source"]["sha256"]["data"] = "0" * 64
            if change == "coverage": altered["coverage"]["municipalities"] -= 1
            if change == "encoding": altered["source"]["csvEncoding"] = "utf-8"
            with self.subTest(change=change), self.assertRaisesRegex(StructuralError, "SHA-256 semantico"):
                snapshot.validate_snapshot(altered)

    def test_standard_spending_is_reproportioned_on_historical_total(self):
        """Proprietà dichiarata del rilascio 2016: se cambia, il bundle si blocca."""
        rows = [dict(zip(COMMITTED["municipalityColumns"], row)) for row in COMMITTED["municipalityRows"]]
        historical = sum(row["historicalSpendingCents"] for row in rows)
        standard = sum(row["standardSpendingCents"] for row in rows)
        self.assertEqual(historical, snapshot.SPEC["nationalTotals"]["historicalSpendingCents"])
        self.assertEqual(standard, snapshot.SPEC["nationalTotals"]["standardSpendingCents"])
        self.assertLessEqual(abs(historical - standard), snapshot.SPEC["nationalTotals"]["roundingToleranceCents"])
        snapshot.verify_national_totals(rows)
        drifted = copy.deepcopy(rows)
        drifted[0]["standardSpendingCents"] += 10 ** 6
        with self.assertRaisesRegex(StructuralError, "totali nazionali"):
            snapshot.verify_national_totals(drifted)

    def test_non_evaluable_municipalities_remain_source_coded(self):
        rows = [dict(zip(COMMITTED["municipalityColumns"], row)) for row in COMMITTED["municipalityRows"]]
        spending = [row for row in rows if row["spendingAssessmentReason"] is not None]
        services = [row for row in rows if row["servicesAssessmentReason"] is not None]
        self.assertEqual(len(spending), 109)
        self.assertEqual(len(services), 190)
        self.assertTrue(all(row["spendingAssessmentReason"] == "cod_sps_noval" for row in spending))
        self.assertEqual(
            sorted({row["servicesAssessmentReason"] for row in services}),
            ["cod_no_quest", "cod_out_noval", "cod_out_noval_nospesa"],
        )
        self.assertTrue(all(row["spendingLevel"] is None for row in spending))
        self.assertTrue(all(row["serviceLevel"] is None for row in services))


if __name__ == "__main__":
    unittest.main()
