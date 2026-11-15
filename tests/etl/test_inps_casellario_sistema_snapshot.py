from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from inps_casellario_sistema_snapshot import SnapshotError, check, write_outputs

ROOT = Path(__file__).resolve().parents[2]
SPEC = ROOT / "scripts/etl/specs/inps-casellario-sistema.source.json"
DATA = ROOT / "src/data/generated/inps-casellario-sistema.json"


class InpsCasellarioSistemaSnapshotTests(unittest.TestCase):
    def test_check_passes_on_committed_artifact(self) -> None:
        check(SPEC, DATA)

    def test_rebuild_is_stable(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            tmp_root = Path(tmp)
            data_copy = tmp_root / DATA.name
            spec_copy = tmp_root / SPEC.name
            data_copy.write_bytes(DATA.read_bytes())
            spec_copy.write_bytes(SPEC.read_bytes())
            write_outputs(spec_copy, data_copy, published_data_path=DATA)
            self.assertEqual(data_copy.read_bytes(), DATA.read_bytes())
            self.assertEqual(spec_copy.read_bytes(), SPEC.read_bytes())

    def test_tampered_pdf_hash_fails_closed(self) -> None:
        spec = json.loads(SPEC.read_text(encoding="utf-8"))
        spec["source"]["assets"]["comunicatoStampa"]["sha256"] = "0" * 64
        with tempfile.TemporaryDirectory() as tmp:
            bad_spec = Path(tmp) / "bad.source.json"
            bad_spec.write_text(json.dumps(spec), encoding="utf-8")
            with self.assertRaises(SnapshotError):
                write_outputs(bad_spec, Path(tmp) / "out.json")


if __name__ == "__main__":
    unittest.main()
