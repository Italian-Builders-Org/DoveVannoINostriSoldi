from __future__ import annotations

import copy
import csv
import hashlib
import io
import json
import tempfile
import unittest
from unittest.mock import patch
import zipfile
from pathlib import Path

import anac_procurement_cpv as cpv


class AnacCpvTests(unittest.TestCase):
    def test_failed_post_publish_check_restores_previous_output(self):
        for existing in (False, True):
            with self.subTest(existing=existing), tempfile.TemporaryDirectory() as directory:
                output = Path(directory) / "output"
                if existing:
                    output.mkdir()
                    (output / "previous").write_text("valid previous snapshot")
                spec = {"dataset": "anac-procurement-cpv", "profiles": {"path": "fixture/meta.json"}}
                with patch.object(cpv, "read_spec", return_value=(spec, {}, {"shards": []})), \
                     patch.object(cpv.profiles, "check_artifact"), \
                     patch.object(cpv, "classify_sources", return_value=({}, {})), \
                     patch.object(cpv, "check", side_effect=[None, cpv.ContractError("verification failed")]):
                    with self.assertRaises(cpv.ContractError):
                        cpv.build(Path(directory), output)
                self.assertEqual(output.exists(), existing)
                if existing:
                    self.assertEqual((output / "previous").read_text(), "valid previous snapshot")
                    self.assertEqual([p.name for p in output.iterdir()], ["previous"])

    def source(self, directory: Path, *, duplicate=False, invalid_period=False):
        source = copy.deepcopy(json.loads((cpv.ROOT / "scripts/etl/specs/anac-entity-procurement.source.json").read_text()))
        for entry in source["inputs"]["cig"]:
            month = entry["month"]
            row = {key: "" for key in cpv.profiles.base.CIG_HEADERS}
            row.update(cig="CIG0000001" if duplicate else f"CIG{month:07d}", flag_prevalente="1", anno_pubblicazione="2024" if invalid_period else "2025", mese_pubblicazione=str(month), data_pubblicazione=f"2025-{month:02d}-01", cod_cpv="45112000-5" if month % 2 else "85312320", descrizione_cpv="Descrizione fonte")
            stream = io.StringIO(newline="")
            writer = csv.DictWriter(stream, fieldnames=cpv.profiles.base.CIG_HEADERS, delimiter=";")
            writer.writeheader(); writer.writerow(row)
            payload = stream.getvalue().encode("utf-8-sig")
            path = directory / entry["fileName"]
            with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
                archive.writestr(entry["member"]["name"], payload)
            entry["archiveBytes"] = path.stat().st_size
            entry["archiveSha256"] = hashlib.sha256(path.read_bytes()).hexdigest()
            with zipfile.ZipFile(path) as archive:
                member = archive.getinfo(entry["member"]["name"])
                entry["member"].update(bytes=len(payload), sha256=hashlib.sha256(payload).hexdigest(), crc32=f"{member.CRC:08x}")
        return source

    def test_complete_archives_retain_source_codes_and_descriptions(self):
        with tempfile.TemporaryDirectory() as directory:
            source = self.source(Path(directory))
            rows, counts = cpv.classify_sources(Path(directory), source)
            self.assertEqual(counts, {"rawRows": 12, "primaryRows": 12, "nonPrimaryRows": 0, "classified": 12, "unclassified": 0})
            self.assertEqual(rows["CIG0000001"], ({"cig": "CIG0000001", "rawCode": "45112000-5", "description": "Descrizione fonte"}, "2025-01-01"))

    def test_reject_duplicate_primary_cigs_and_wrong_period(self):
        for options in ({"duplicate": True}, {"invalid_period": True}):
            with self.subTest(options=options), tempfile.TemporaryDirectory() as directory:
                source = self.source(Path(directory), **options)
                with self.assertRaises(cpv.ContractError):
                    cpv.classify_sources(Path(directory), source)

    def test_reject_incomplete_archive_or_changed_bytes(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = self.source(root)
            with self.assertRaises(cpv.ContractError):
                cpv.classify_sources(root, {**source, "inputs": {**source["inputs"], "cig": source["inputs"]["cig"][:-1]}})
            path = root / source["inputs"]["cig"][0]["fileName"]
            path.write_bytes(path.read_bytes() + b"changed")
            with self.assertRaises(cpv.profiles.base.ContractError):
                cpv.classify_sources(root, source)

    def test_source_formats_and_unclassified_do_not_infer_from_names(self):
        self.assertEqual(cpv.cpv_code(" 45112000-5 "), "45112000")
        self.assertEqual(cpv.cpv_code("85312320"), "85312320")
        for value in ("", "00000000-0", "45", "45112000-55", "Lavori"):
            self.assertIsNone(cpv.cpv_code(value))
        parent = {"codiceIpa": "test", "procedures": [{"cig": "CIG0000001"}]}
        record = {"codiceIpa": "test", "procedures": [{"cig": "CIG0000001", "rawCode": "", "description": "Lavori"}]}
        self.assertEqual(cpv.validate_record(record, parent)["unclassified"], 1)
        for broken in ({**record, "codiceIpa": "other"}, {**record, "procedures": []}, {**record, "procedures": record["procedures"] * 2}):
            with self.assertRaises(cpv.ContractError):
                cpv.validate_record(broken, parent)


if __name__ == "__main__":
    unittest.main()
