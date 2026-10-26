from __future__ import annotations

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
        spec_before, data_before = SPEC.read_bytes(), DATA.read_bytes()
        # Rebuild into copies, recording the committed artifact path in the lock:
        # both the data and the lock must come out byte-identical to the committed ones.
        with tempfile.TemporaryDirectory() as tmp:
            spec_copy = Path(tmp) / SPEC.name
            data_copy = Path(tmp) / DATA.name
            spec_copy.write_bytes(spec_before)
            write_outputs(spec_copy, data_copy, artifact_path=DATA.relative_to(ROOT).as_posix())
            self.assertEqual(data_copy.read_bytes(), data_before)
            self.assertEqual(spec_copy.read_bytes(), spec_before)
        self.assertEqual((SPEC.read_bytes(), DATA.read_bytes()), (spec_before, data_before))

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
