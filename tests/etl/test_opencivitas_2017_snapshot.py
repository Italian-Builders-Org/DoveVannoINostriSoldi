import copy
import json
from pathlib import Path
import unittest
from unittest.mock import patch

import opencivitas_2017_snapshot as snapshot

FC50_SAMPLE = json.loads(Path("tests/fixtures/opencivitas-2018-source-sample.json").read_text())


class FC40ReleaseTests(unittest.TestCase):
    def test_fc40_and_fc50_share_only_the_verified_25_definition_shape(self):
        snapshot.verify_definitions(FC50_SAMPLE["definitions"])
        for field, value in [
            ("VAR_IND_DES", "Spesa standard - migliaia di euro"),
            ("VAR_IND_FUNZIONE", "ISTRUZIONE"),
            ("VAR_IND_TIP", "NAVIGA"),
            ("VAR_IND_LINGUA", "EN"),
        ]:
            definitions = copy.deepcopy(FC50_SAMPLE["definitions"])
            definitions[0][field] = value
            with self.subTest(field=field), self.assertRaises(snapshot.StructuralError):
                snapshot.verify_definitions(definitions)
        with self.assertRaises(snapshot.StructuralError):
            snapshot.verify_definitions(FC50_SAMPLE["definitions"] + FC50_SAMPLE["definitions"][:1])

    def test_join_rejects_rss_unknown_entities_missing_indicators_and_flags(self):
        username = FC50_SAMPLE["username"]
        with patch.dict(snapshot.SPEC, {
            "municipalities": 1,
            "regionCounts": {"LAZIO": 1},
            "excludedAggregates": ["ZZ999ITA001"],
        }):
            entities = {username: copy.deepcopy(FC50_SAMPLE["entity"])}
            raw = {username: copy.deepcopy(FC50_SAMPLE["indicators"]), "ZZ999ITA001": {}}
            self.assertEqual(len(snapshot.normalize_rows(entities, raw)), 1)
            for change in ("rss", "unknown", "missing", "flag", "coverage"):
                with self.subTest(change=change):
                    changed_entities, changed_raw = copy.deepcopy(entities), copy.deepcopy(raw)
                    if change == "rss": changed_entities[username]["region"] = "SICILIA"
                    if change == "unknown": changed_raw["UNKNOWN"] = {}
                    if change == "missing": del changed_raw[username]["SPESA_STORICA"]
                    if change == "flag": changed_raw[username]["SPESA_STORICA"]["privacy"] = "cod_privacy"
                    if change == "coverage": del changed_raw[username]
                    with self.assertRaises(snapshot.StructuralError):
                        snapshot.normalize_rows(changed_entities, changed_raw)

    def test_byte_locks_and_entire_committed_artifact_fail_closed(self):
        for key in ("data", "entities", "indicators"):
            with self.assertRaisesRegex(snapshot.StructuralError, "byte/SHA-256"):
                snapshot.verify_bytes(b"PK-invalid", key)
        original = json.loads(snapshot.OUTPUT.read_text())
        snapshot.validate_snapshot(original)
        for change in ("amount", "period", "license", "hash", "coverage"):
            altered = copy.deepcopy(original)
            if change == "amount":
                altered["municipalityRows"][0][4] += 100
                altered["municipalityRows"][0][6] += 100
            if change == "period": altered["referenceYear"] = 2018
            if change == "license": altered["source"]["license"] = "Unverified"
            if change == "hash": altered["source"]["sha256"]["data"] = "0" * 64
            if change == "coverage": altered["coverage"]["municipalities"] -= 1
            with self.subTest(change=change), self.assertRaisesRegex(snapshot.StructuralError, "SHA-256 semantico"):
                snapshot.validate_snapshot(altered)

    def test_two_non_evaluable_municipalities_remain_source_coded(self):
        committed = json.loads(snapshot.OUTPUT.read_text())
        rows = [dict(zip(committed["municipalityColumns"], row)) for row in committed["municipalityRows"]]
        unavailable = [row for row in rows if row["servicesAssessmentReason"] is not None]
        self.assertEqual([row["istatCode"] for row in unavailable], ["001316", "079110"])
        self.assertTrue(all(row["servicesAssessmentReason"] == "cod_out_noval_nospesa" for row in unavailable))
        self.assertTrue(all(row["spendingAssessmentReason"] == "cod_sps_noval" for row in unavailable))


if __name__ == "__main__":
    unittest.main()
