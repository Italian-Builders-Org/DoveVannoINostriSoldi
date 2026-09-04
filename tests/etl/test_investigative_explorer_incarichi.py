import csv
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "scripts/etl/investigative_explorer_build.py"
REAL_INPUT = ROOT / "data/relations/persona_incarico_ente__incarichi_nominativi_shard.csv"
ARTIFACT = ROOT / "src/data/generated/investigative-explorer-incarichi.json"

sys.path.insert(0, str(SCRIPT.parent))
import investigative_explorer_build as _etl

REQUIRED = _etl.REQUIRED
EDGE_FIELDS = [
    *REQUIRED,
    "role",
    "amount",
    "ipa",
    "source_url",
    "note_source",
]


def run(args):
    return subprocess.run(
        [sys.executable, str(SCRIPT), *args],
        capture_output=True,
        text=True,
    )


class InvestigativeExplorerIncarichiTestCase(unittest.TestCase):
    def test_build_then_check_real(self):
        if not REAL_INPUT.exists():
            self.skipTest(f"input di sviluppo assente: {REAL_INPUT}")
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "inv.json"
            built = run(["--input", str(REAL_INPUT), "--output", str(out)])
            self.assertEqual(built.returncode, 0, built.stderr)
            checked = run(["--check", "--output", str(out)])
            self.assertEqual(checked.returncode, 0, checked.stderr)
            data = json.loads(out.read_text(encoding="utf-8"))
            with REAL_INPUT.open(encoding="utf-8", newline="") as fh:
                raw_rows = sum(1 for _ in csv.DictReader(fh))
            self.assertIsInstance(data.get("duplicatesRemoved"), int)
            self.assertGreaterEqual(data["duplicatesRemoved"], 0)
            self.assertIsInstance(data.get("suspectDuplicates"), int)
            self.assertGreaterEqual(data["suspectDuplicates"], 0)
            self.assertEqual(data["relationCount"], raw_rows - data["duplicatesRemoved"])
            self.assertEqual(data["relationCount"], len(data["relations"]))
            self.assertEqual(
                data["suspectDuplicates"],
                sum(1 for rel in data["relations"] if rel.get("suspect_duplicate")),
            )
            seen = set()
            for rel in data["relations"]:
                for field in REQUIRED:
                    self.assertTrue(rel.get(field), f"campo obbligatorio mancante: {field}")
                if rel.get("amount") is not None:
                    self.assertGreaterEqual(rel["amount"], 0)
                key = json.dumps([rel.get(f) for f in EDGE_FIELDS], sort_keys=True)
                self.assertNotIn(key, seen, "arco duplicato (merge non consentito)")
                seen.add(key)

    def test_artifact_contract(self):
        if not ARTIFACT.exists():
            self.skipTest(f"artifact non generato: {ARTIFACT}")
        data = json.loads(ARTIFACT.read_text(encoding="utf-8"))
        self.assertEqual(data["schemaVersion"], 1)
        self.assertEqual(data["transformVersion"], 2)
        self.assertEqual(data["scope"], "investigative-explorer-incarichi")
        self.assertIsInstance(data["relations"], list)
        self.assertGreater(len(data["relations"]), 0)
        self.assertEqual(data["relationCount"], len(data["relations"]))
        self.assertEqual(
            data["suspectDuplicates"],
            sum(1 for rel in data["relations"] if rel.get("suspect_duplicate")),
        )
        seen = set()
        for rel in data["relations"]:
            for field in REQUIRED:
                self.assertTrue(rel.get(field), f"campo obbligatorio mancante: {field}")
            if rel.get("amount") is not None:
                self.assertGreaterEqual(rel["amount"], 0)
            key = json.dumps([rel.get(f) for f in EDGE_FIELDS], sort_keys=True)
            self.assertNotIn(key, seen, "arco duplicato (merge non consentito)")
            seen.add(key)

    def test_fixture_no_person_merge(self):
        with tempfile.TemporaryDirectory() as tmp:
            fixture = Path(tmp) / "fix.csv"
            fixture.write_text(
                "relation_type,subject_type,subject_key,object_type,object_key,source_dataset,"
                "source_record_id,period,acquisition_date,confidence_note,role,importo_if_present,"
                "ipa,fonte_url,note_source\n"
                "person_has_appointment,person,MARIO ROSSI,public_entity,Comune X,"
                "incarichi-nominativi-shard,aaa,2025-01-01,2026-08-25,nota,dirigente,1000.00,IPAX,u,u\n"
                "person_has_appointment,person,MARIO ROSSI,public_entity,Comune Y,"
                "incarichi-nominativi-shard,bbb,2025-02-02,2026-08-25,nota2,consulente,,IPAY,v,v\n",
                encoding="utf-8",
            )
            out = Path(tmp) / "inv.json"
            self.assertEqual(
                run(["--input", str(fixture), "--output", str(out)]).returncode, 0
            )
            data = json.loads(out.read_text(encoding="utf-8"))
            self.assertEqual(data["relationCount"], 2)
            self.assertEqual(len({r["source_record_id"] for r in data["relations"]}), 2)
            amounts = [r["amount"] for r in data["relations"]]
            self.assertEqual(amounts[0], 1000.0)
            self.assertIsNone(amounts[1])

    def test_negative_amount_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            fixture = Path(tmp) / "fix.csv"
            fixture.write_text(
                "relation_type,subject_type,subject_key,object_type,object_key,source_dataset,"
                "source_record_id,period,acquisition_date,confidence_note,role,importo_if_present,"
                "ipa,fonte_url,note_source\n"
                "person_has_appointment,person,MARIO ROSSI,public_entity,Comune X,"
                "incarichi-nominativi-shard,aaa,2025-01-01,2026-08-25,nota,dirigente,-5,IPAX,u,u\n",
                encoding="utf-8",
            )
            out = Path(tmp) / "inv.json"
            built = run(["--input", str(fixture), "--output", str(out)])
            self.assertNotEqual(built.returncode, 0)
            self.assertIn("importo", built.stderr.lower())

    def test_dvns_integrated_rows_shape(self):
        # Lo schema reale delle righe integrate DVNS avvolge i campi in "cells"
        # e porta sourceRowSha256 + sourceUrls; i campi privati (cf_ente/cf_piva)
        # sono gia' redatti e vanno esclusi. L'adapter deve leggerli li'.
        with tempfile.TemporaryDirectory() as tmp:
            sample = Path(tmp) / "rows.jsonl"
            sample.write_text(
                json.dumps(
                    {
                        "cells": {
                            "cf_ente": None,
                            "cf_piva": "",
                            "cig": "",
                            "data": "2025-10-29",
                            "ente": "Ente Parco",
                            "fonte_url": "https://example.org/a",
                            "importo_euro": "12.500,00",
                            "ipa": "IPA1",
                            "nominativo": "RALLO ALICE",
                            "note": "nota",
                            "oggetto": "Collaboratrice",
                            "tipo": "consulente",
                        },
                        "id": "row-abc",
                        "redactions": [{"field": "cf_ente", "reason": "personal-identifier"}],
                        "sourceRowSha256": "deadbeef" * 8,
                        "sourceUrls": ["https://example.org/a"],
                    }
                )
                + "\n",
                encoding="utf-8",
            )
            out = Path(tmp) / "inv.json"
            built = run(["--input", str(sample), "--acquired", "2026-08-23", "--output", str(out)])
            self.assertEqual(built.returncode, 0, built.stderr)
            data = json.loads(out.read_text(encoding="utf-8"))
            self.assertEqual(data["relationCount"], 1)
            rel = data["relations"][0]
            self.assertEqual(rel["source_record_id"], "deadbeef" * 8)
            self.assertEqual(rel["subject_key"], "RALLO ALICE")
            self.assertEqual(rel["object_key"], "Ente Parco")
            self.assertEqual(rel["amount"], 12500.0)
            self.assertEqual(rel["source_url"], "https://example.org/a")
            self.assertNotIn("cf_ente", rel)
            self.assertNotIn("cf_piva", rel)
            checked = run(["--check", "--output", str(out)])
            self.assertEqual(checked.returncode, 0, checked.stderr)

    def test_amount_italian_thousands(self):
        with tempfile.TemporaryDirectory() as tmp:
            fixture = Path(tmp) / "fix.csv"
            fixture.write_text(
                'relation_type,subject_type,subject_key,object_type,object_key,source_dataset,'
                'source_record_id,period,acquisition_date,confidence_note,role,importo_if_present,'
                'ipa,fonte_url,note_source\n'
                'person_has_appointment,person,MARIO ROSSI,public_entity,Comune X,'
                'incarichi-nominativi-shard,aaa,2025-01-01,2026-08-25,nota,dirigente,"12.500,00",IPAX,u,u\n',
                encoding="utf-8",
            )
            out = Path(tmp) / "inv.json"
            built = run(["--input", str(fixture), "--output", str(out)])
            self.assertEqual(built.returncode, 0, built.stderr)
            data = json.loads(out.read_text(encoding="utf-8"))
            self.assertEqual(data["relations"][0]["amount"], 12500.0)

    def test_empty_period_allowed(self):
        with tempfile.TemporaryDirectory() as tmp:
            fixture = Path(tmp) / "fix.csv"
            fixture.write_text(
                'relation_type,subject_type,subject_key,object_type,object_key,source_dataset,'
                'source_record_id,period,acquisition_date,confidence_note,role,importo_if_present,'
                'ipa,fonte_url,note_source\n'
                'person_has_appointment,person,MARIO ROSSI,public_entity,Comune X,'
                'incarichi-nominativi-shard,aaa,,2026-08-25,nota,dirigente,1000.00,IPAX,u,u\n',
                encoding="utf-8",
            )
            out = Path(tmp) / "inv.json"
            built = run(["--input", str(fixture), "--output", str(out)])
            self.assertEqual(built.returncode, 0, built.stderr)
            data = json.loads(out.read_text(encoding="utf-8"))
            self.assertEqual(data["relations"][0]["period"], "")
            checked = run(["--check", "--output", str(out)])
            self.assertEqual(checked.returncode, 0, checked.stderr)

    def test_amount_placeholder_is_none(self):
        with tempfile.TemporaryDirectory() as tmp:
            fixture = Path(tmp) / "fix.csv"
            fixture.write_text(
                'relation_type,subject_type,subject_key,object_type,object_key,source_dataset,'
                'source_record_id,period,acquisition_date,confidence_note,role,importo_if_present,'
                'ipa,fonte_url,note_source\n'
                'person_has_appointment,person,MARIO ROSSI,public_entity,Comune X,'
                'incarichi-nominativi-shard,aaa,2025-01-01,2026-08-25,nota,dirigente,n.d.,IPAX,u,u\n',
                encoding="utf-8",
            )
            out = Path(tmp) / "inv.json"
            built = run(["--input", str(fixture), "--output", str(out)])
            self.assertEqual(built.returncode, 0, built.stderr)
            data = json.loads(out.read_text(encoding="utf-8"))
            self.assertIsNone(data["relations"][0]["amount"])
            checked = run(["--check", "--output", str(out)])
            self.assertEqual(checked.returncode, 0, checked.stderr)

    def test_meta_gz_and_stable_id(self):
        with tempfile.TemporaryDirectory() as tmp:
            fixture = Path(tmp) / "fix.csv"
            fixture.write_text(
                "relation_type,subject_type,subject_key,object_type,object_key,source_dataset,"
                "source_record_id,period,acquisition_date,confidence_note,role,importo_if_present,"
                "ipa,fonte_url,note_source\n"
                "person_has_appointment,person,MARIO ROSSI,public_entity,Comune X,"
                "incarichi-nominativi-shard,aaa,2025-01-01,2026-08-25,nota,dirigente,1000.00,IPAX,u,u\n"
                "person_has_appointment,person,MARIO ROSSI,public_entity,Comune Y,"
                "incarichi-nominativi-shard,bbb,2025-02-02,2026-08-25,nota2,consulente,,IPAY,v,v\n",
                encoding="utf-8",
            )
            out = Path(tmp) / "inv.json"
            built = run(["--input", str(fixture), "--output", str(out)])
            self.assertEqual(built.returncode, 0, built.stderr)
            meta = out.with_suffix(".meta.json")
            gz = out.with_suffix(".json.gz")
            self.assertTrue(meta.exists(), "meta non emesso")
            self.assertTrue(gz.exists(), "gz non emesso")
            data = json.loads(out.read_text(encoding="utf-8"))
            ids = [r["id"] for r in data["relations"]]
            self.assertEqual(len(ids), len(set(ids)), "id non univoci")
            m = json.loads(meta.read_text(encoding="utf-8"))
            self.assertEqual(m["relationCount"], data["relationCount"])
            self.assertEqual(m["suspectDuplicates"], data["suspectDuplicates"])
            self.assertNotIn("relations", m, "il meta non deve contenere gli archi")
            self.assertIn("topPersons", m)
            self.assertIn("topEntities", m)
            self.assertTrue(gz.stat().st_size < out.stat().st_size, "gz non comprime")

    def _write_edges(self, tmp: str, rows: list[str]) -> Path:
        fixture = Path(tmp) / "fix.csv"
        fixture.write_text(
            "relation_type,subject_type,subject_key,object_type,object_key,source_dataset,"
            "source_record_id,period,acquisition_date,confidence_note,role,importo_if_present,"
            "ipa,fonte_url,note_source\n"
            + "\n".join(rows)
            + "\n",
            encoding="utf-8",
        )
        return fixture

    def test_scale_twin_marks_inflated_keeps_both_rows(self):
        # Issue #147: same person, same act extrema, same period, amounts ×100.
        note = (
            "Collaborazione - Consulenza specialistica in ambito medico — "
            "INPS.6480.20/06/2025.0003791; PerlaPA CCE 2025; periodo 2025-07-01–2026-06-30"
        )
        peer_note = (
            "Collaborazione - Consulenza specialistica in ambito medico — "
            "INPS.6480.20/06/2025.0003787; PerlaPA CCE 2025; periodo 2025-07-01–2026-06-30"
        )
        with tempfile.TemporaryDirectory() as tmp:
            fixture = self._write_edges(
                tmp,
                [
                    'person_has_appointment,person,D ANGELI DOMENICO,public_entity,INPS,'
                    'incarichi-nominativi-shard,keep,2025-06-30,2026-08-23,nota,consulente,47040,IPA,u,'
                    f'"{note}"',
                    'person_has_appointment,person,D ANGELI DOMENICO,public_entity,INPS,'
                    'incarichi-nominativi-shard,inflated,2025-06-30,2026-08-23,nota,consulente,4704000,IPA,u,'
                    f'"{note}"',
                    'person_has_appointment,person,GENOVESE LEONARDO,public_entity,INPS,'
                    'incarichi-nominativi-shard,peer,2025-06-30,2026-08-23,nota,consulente,47040,IPA,u,'
                    f'"{peer_note}"',
                ],
            )
            out = Path(tmp) / "inv.json"
            built = run(["--input", str(fixture), "--output", str(out)])
            self.assertEqual(built.returncode, 0, built.stderr)
            data = json.loads(out.read_text(encoding="utf-8"))
            self.assertEqual(data["relationCount"], 3)
            self.assertEqual(data["suspectDuplicates"], 1)
            by_id = {rel["source_record_id"]: rel for rel in data["relations"]}
            self.assertTrue(by_id["inflated"].get("suspect_duplicate"))
            self.assertFalse(by_id["keep"].get("suspect_duplicate"))
            self.assertFalse(by_id["peer"].get("suspect_duplicate"))
            self.assertEqual(by_id["keep"]["amount"], 47040.0)
            self.assertEqual(by_id["inflated"]["amount"], 4704000.0)
            meta = json.loads(out.with_suffix(".meta.json").read_text(encoding="utf-8"))
            self.assertEqual(meta["suspectDuplicates"], 1)
            person_counts = {row["key"]: row["count"] for row in meta["topPersons"]}
            self.assertEqual(person_counts["D ANGELI DOMENICO"], 1)
            checked = run(["--check", "--output", str(out)])
            self.assertEqual(checked.returncode, 0, checked.stderr)

    def test_scale_twin_without_peers_keeps_smaller_amount(self):
        note = "Consulenza — INPS.6480.20/06/2025.0003791; periodo 2025-07-01–2026-06-30"
        with tempfile.TemporaryDirectory() as tmp:
            fixture = self._write_edges(
                tmp,
                [
                    'person_has_appointment,person,ROSSI MARIO,public_entity,Ente X,'
                    'incarichi-nominativi-shard,small,2025-01-01,2026-08-23,nota,consulente,50,IPA,u,'
                    f'"{note}"',
                    'person_has_appointment,person,ROSSI MARIO,public_entity,Ente X,'
                    'incarichi-nominativi-shard,big,2025-01-01,2026-08-23,nota,consulente,50000,IPA,u,'
                    f'"{note}"',
                ],
            )
            out = Path(tmp) / "inv.json"
            self.assertEqual(run(["--input", str(fixture), "--output", str(out)]).returncode, 0)
            data = json.loads(out.read_text(encoding="utf-8"))
            by_id = {rel["source_record_id"]: rel for rel in data["relations"]}
            self.assertEqual(data["suspectDuplicates"], 1)
            self.assertTrue(by_id["big"].get("suspect_duplicate"))
            self.assertFalse(by_id["small"].get("suspect_duplicate"))

    def test_different_acts_are_not_scale_twins(self):
        with tempfile.TemporaryDirectory() as tmp:
            fixture = self._write_edges(
                tmp,
                [
                    'person_has_appointment,person,ROSSI MARIO,public_entity,Ente X,'
                    'incarichi-nominativi-shard,a,2025-01-01,2026-08-23,nota,consulente,47040,IPA,u,'
                    '"Atto — INPS.6480.20/06/2025.0003791; nota"',
                    'person_has_appointment,person,ROSSI MARIO,public_entity,Ente X,'
                    'incarichi-nominativi-shard,b,2025-01-01,2026-08-23,nota,consulente,4704000,IPA,u,'
                    '"Atto — INPS.6480.20/06/2025.0003999; nota"',
                ],
            )
            out = Path(tmp) / "inv.json"
            self.assertEqual(run(["--input", str(fixture), "--output", str(out)]).returncode, 0)
            data = json.loads(out.read_text(encoding="utf-8"))
            self.assertEqual(data["suspectDuplicates"], 0)
            self.assertFalse(any(rel.get("suspect_duplicate") for rel in data["relations"]))

    def test_committed_perla_twin_is_flagged_when_present(self):
        if not ARTIFACT.exists():
            self.skipTest(f"artifact non generato: {ARTIFACT}")
        data = json.loads(ARTIFACT.read_text(encoding="utf-8"))
        inflated = [
            rel
            for rel in data["relations"]
            if rel.get("amount") == 4704000.0
            and "INPS.6480.20/06/2025.0003791" in (rel.get("note_source") or "")
        ]
        if not inflated:
            self.skipTest("coppia PerlaPA #147 assente dallo snapshot")
        self.assertTrue(all(rel.get("suspect_duplicate") for rel in inflated))
        kept = [
            rel
            for rel in data["relations"]
            if rel.get("amount") == 47040.0
            and "INPS.6480.20/06/2025.0003791" in (rel.get("note_source") or "")
            and not rel.get("suspect_duplicate")
        ]
        self.assertGreaterEqual(len(kept), 1)


if __name__ == "__main__":
    unittest.main()
