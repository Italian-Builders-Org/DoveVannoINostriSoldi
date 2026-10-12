from __future__ import annotations

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
        before = DATA.read_bytes()
        write_outputs(SPEC, DATA)
        check(SPEC, DATA)
        self.assertEqual(DATA.read_bytes(), before)

    def test_tampered_pdf_hash_fails_closed(self) -> None:
        import json
        import tempfile

        spec = json.loads(SPEC.read_text(encoding="utf-8"))
        spec["source"]["assets"]["comunicatoStampa"]["sha256"] = "0" * 64
        with tempfile.TemporaryDirectory() as tmp:
            bad_spec = Path(tmp) / "bad.source.json"
            bad_spec.write_text(json.dumps(spec), encoding="utf-8")
            with self.assertRaises(SnapshotError):
                write_outputs(bad_spec, Path(tmp) / "out.json")


if __name__ == "__main__":
    unittest.main()
