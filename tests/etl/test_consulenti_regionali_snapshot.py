from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

import consulenti_regionali_snapshot as etl

ROOT = Path(__file__).resolve().parents[2]
FIXTURES = ROOT / "tests/fixtures/consulenti-regionali"
OUTPUT = ROOT / "src/data/generated/consulenti-regionali.json"


class ConsulentiRegionaliSnapshotTests(unittest.TestCase):
    def test_check_passes_on_committed_artifact(self) -> None:
        etl.validate_snapshot(etl.load_json(OUTPUT))

    def test_fixture_rebuild_is_stable(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "consulenti-regionali.json"
            national = etl.load_json(FIXTURES / "national.json")
            regional = {
                row["year"]: etl.load_json(FIXTURES / f"regioni-{row['year']}.json")
                for row in etl.national_years(national)
            }
            first = etl.build_snapshot(national, regional, "2026-10-10T08:00:00Z")
            second = etl.build_snapshot(national, regional, "2026-10-10T09:00:00Z")
            etl.validate_snapshot(first)
            etl.validate_snapshot(second)
            self.assertEqual(etl.semantic_view(first), etl.semantic_view(second))
            out.write_text(json.dumps(first, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
            etl.validate_snapshot(etl.load_json(out))

    def test_duplicate_territory_label_fails_closed(self) -> None:
        national = etl.load_json(FIXTURES / "national.json")
        national_row = etl.national_years(national)[0]
        year = int(national_row["year"])
        rows = etl.load_json(FIXTURES / f"regioni-{year}.json")
        forged = json.loads(json.dumps(rows, default=str))
        # Re-load with Decimal so money parsing stays valid, then duplicate a label.
        forged = etl.load_json(FIXTURES / f"regioni-{year}.json")
        assert isinstance(forged, list)
        forged.append(dict(forged[0]))
        with self.assertRaisesRegex(etl.StructuralError, "etichette territorio duplicate"):
            etl.normalize_year(year, forged, national_row)

    def test_national_mismatch_fails_closed(self) -> None:
        national = etl.load_json(FIXTURES / "national.json")
        national_row = dict(etl.national_years(national)[0])
        year = int(national_row["year"])
        rows = etl.load_json(FIXTURES / f"regioni-{year}.json")
        national_row["assignments"] = int(national_row["assignments"]) + 1
        with self.assertRaisesRegex(etl.StructuralError, "somma incarichi"):
            etl.normalize_year(year, rows, national_row)


if __name__ == "__main__":
    unittest.main()
