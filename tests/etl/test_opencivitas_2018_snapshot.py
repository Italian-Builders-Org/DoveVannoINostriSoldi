import copy
import json
from pathlib import Path
import unittest
from unittest.mock import patch

import opencivitas_2018_snapshot as snapshot
from opencivitas_common import normalize_municipality

SAMPLE = json.loads(Path("tests/fixtures/opencivitas-2018-source-sample.json").read_text())


class FC50ReleaseTests(unittest.TestCase):
    def test_source_sample_reconciles_money_and_service_denominators(self):
        row = normalize_municipality(SAMPLE["username"], SAMPLE["entity"], SAMPLE["indicators"])
        self.assertEqual(row["historicalSpendingCents"], 299693120810)
        self.assertEqual(row["standardSpendingCents"], 281541030940)
        self.assertEqual(row["historicalPerCapitaCents"], 106266)
        self.assertEqual(row["standardPerCapitaCents"], 99829)
        self.assertEqual(row["differenceBasisPoints"], 645)
        self.assertEqual(row["serviceDifferenceBasisPoints"], 404)
        self.assertEqual(row["spendingLevel"], 7)
        self.assertEqual(row["serviceLevel"], 6)

    def test_zero_optional_missing_and_privacy_are_distinct(self):
        rows = copy.deepcopy(SAMPLE["indicators"])
        rows["POSIZIONE_OUTPUT_PERC_TOT"]["value"] = "0"
        rows["DIFF_OUT_PERC_TOT"]["value"] = ""
        row = normalize_municipality(SAMPLE["username"], SAMPLE["entity"], rows)
        self.assertEqual(row["serviceLevel"], 0)
        self.assertIsNone(row["serviceDifferenceBasisPoints"])
        rows["SPESA_STORICA"]["privacy"] = "cod_privacy"
        with self.assertRaises(snapshot.StructuralError):
            normalize_municipality(SAMPLE["username"], SAMPLE["entity"], rows)

    def test_inconsistent_denominator_and_invalid_amounts_fail_closed(self):
        for code, value in [("SPESA_STORICA_PROAB", "1000"), ("SPESA_STORICA", ""),
                            ("FST_RIPROPORZIONATO_BI", "0"), ("SPESA_STORICA", "NaN"),
                            ("POSIZIONE_OUTPUT_PERC_TOT", "11")]:
            with self.subTest(code=code, value=value):
                rows = copy.deepcopy(SAMPLE["indicators"])
                rows[code]["value"] = value
                with self.assertRaises(snapshot.StructuralError):
                    normalize_municipality(SAMPLE["username"], SAMPLE["entity"], rows)

    def test_metadata_units_function_language_and_duplicates_are_checked(self):
        snapshot.verify_definitions(SAMPLE["definitions"])
        for field, value in [("VAR_IND_DES", "Spesa standard - migliaia di euro"),
                             ("VAR_IND_FUNZIONE", "ISTRUZIONE"), ("VAR_IND_TIP", "NAVIGA"), ("VAR_IND_LINGUA", "EN")]:
            definitions = copy.deepcopy(SAMPLE["definitions"])
            definitions[0][field] = value
            with self.assertRaises(snapshot.StructuralError):
                snapshot.verify_definitions(definitions)
        with self.assertRaises(snapshot.StructuralError):
            snapshot.verify_definitions(SAMPLE["definitions"] + SAMPLE["definitions"][:1])

    def test_join_rejects_rss_unknown_entities_missing_indicators_and_flags(self):
        username = SAMPLE["username"]
        with patch.dict(snapshot.SPEC, {"municipalities": 1, "regionCounts": {"LAZIO": 1}, "excludedAggregates": ["ZZ999ITA001"]}):
            entities = {username: copy.deepcopy(SAMPLE["entity"])}
            raw = {username: copy.deepcopy(SAMPLE["indicators"]), "ZZ999ITA001": {}}
            self.assertEqual(len(snapshot.normalize_rows(entities, raw)), 1)
            for change in ("rss", "unknown", "missing", "flag", "coverage"):
                with self.subTest(change=change):
                    e, r = copy.deepcopy(entities), copy.deepcopy(raw)
                    if change == "rss": e[username]["region"] = "SICILIA"
                    if change == "unknown": r["UNKNOWN"] = {}
                    if change == "missing": del r[username]["SPESA_STORICA"]
                    if change == "flag": r[username]["DESCR_NON_VALUTABILE_OUT_TOT"]["privacy"] = "cod_privacy"
                    if change == "coverage": del r[username]
                    with self.assertRaises(snapshot.StructuralError): snapshot.normalize_rows(e, r)

    def test_byte_pin_and_entire_historical_artifact_are_immutable(self):
        for key in ("data", "entities", "indicators"):
            with self.assertRaisesRegex(snapshot.StructuralError, "byte/SHA-256"):
                snapshot.verify_bytes(b"PK-invalid", key)
        original = json.loads(snapshot.OUTPUT.read_text())
        snapshot.validate_snapshot(original)
        for change in ("amounts", "period", "license", "hash", "null", "coverage"):
            altered = copy.deepcopy(original)
            if change == "amounts":
                altered["municipalityRows"][0][4] += 100
                altered["municipalityRows"][0][6] += 100
            if change == "period": altered["referenceYear"] = 2020
            if change == "license": altered["source"]["license"] = "Unverified"
            if change == "hash": altered["source"]["sha256"]["data"] = "0" * 64
            if change == "null": altered["municipalityRows"][0][11] = None
            if change == "coverage": altered["coverage"]["municipalities"] -= 1
            with self.subTest(change=change), self.assertRaisesRegex(snapshot.StructuralError, "SHA-256 semantico"):
                snapshot.validate_snapshot(altered)
        original["generatedAt"] = original["source"]["observedAt"] = "2020-01-01T00:00:00Z"
        with self.assertRaisesRegex(snapshot.StructuralError, "timestamp"):
            snapshot.validate_snapshot(original)

    def test_fc50_metadata_is_distinct_from_fc60_and_reasons_remain_text(self):
        fc60 = json.loads(Path("tests/fixtures/opencivitas-2019-source-sample.json").read_text())
        self.assertEqual(len(SAMPLE["definitions"]), 25)
        self.assertEqual(len(fc60["definitions"]), 27)
        fc50_codes = {row["VAR_IND_COD"]: row for row in SAMPLE["definitions"]}
        fc60_codes = {row["VAR_IND_COD"]: row for row in fc60["definitions"]}
        self.assertEqual(set(fc60_codes) - set(fc50_codes), {"FL_NO_CONFRONTO_SPESA", "FL_NO_CONFRONTO_OUT"})
        # These navigation flags changed meaning/type and are NOT imported as
        # the selected assessment-reason indicators.
        for code in ("SERV_NO_VALUT_SPESA_TOT", "SERV_NO_VALUT_OUT_TOT"):
            self.assertEqual(fc50_codes[code]["VAR_IND_TIP"], "NAVIGA")
            self.assertEqual(fc60_codes[code]["VAR_IND_TIP"], "LQP")
            self.assertNotEqual(fc50_codes[code]["VAR_IND_DES"], fc60_codes[code]["VAR_IND_DES"])
        with self.assertRaises(snapshot.StructuralError):
            snapshot.verify_definitions(fc60["definitions"])
        rows = copy.deepcopy(SAMPLE["indicators"])
        rows["POSIZIONE_OUTPUT_PERC_TOT"]["value"] = ""
        rows["DESCR_NON_VALUTABILE_OUT_TOT"]["value"] = "Servizi non valutabili"
        result = normalize_municipality(SAMPLE["username"], SAMPLE["entity"], rows)
        self.assertIsNone(result["serviceLevel"])
        self.assertEqual(result["servicesAssessmentReason"], "Servizi non valutabili")
        self.assertIsNone(result["spendingAssessmentReason"])
