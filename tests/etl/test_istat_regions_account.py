import importlib.util
import unittest
from pathlib import Path


SCRIPT = Path(__file__).resolve().parents[2] / "scripts/etl/istat_regions_account.py"
SPEC = importlib.util.spec_from_file_location("istat_regions_account", SCRIPT)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC.loader
SPEC.loader.exec_module(MODULE)


class IstatRegionsAccountTests(unittest.TestCase):
    def test_import_rejects_an_unlocked_archive(self):
        with self.assertRaisesRegex(ValueError, "diverso dal file validato"):
            MODULE.build_snapshot(b"not-the-official-archive", "2026-08-22T00:00:00Z")

    def test_committed_snapshot_is_byte_bound(self):
        MODULE.validate_committed()


if __name__ == "__main__":
    unittest.main()
