import importlib.util
import unittest
from pathlib import Path


SCRIPT = Path(__file__).resolve().parents[2] / "scripts/etl/istat_municipality_geography.py"
SPEC = importlib.util.spec_from_file_location("istat_municipality_geography", SCRIPT)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC.loader
SPEC.loader.exec_module(MODULE)


class IstatMunicipalityGeographyTests(unittest.TestCase):
    def test_committed_snapshot_contract(self):
        MODULE.validate_committed()

    def test_contract_rejects_a_missing_denominator(self):
        snapshot = {
            "schemaVersion": 1,
            "datasetId": "istat-municipality-geography",
            "columns": list(MODULE.COLUMNS),
            "years": [],
        }
        with self.assertRaisesRegex(MODULE.SnapshotError, "annualità inattese"):
            MODULE.validate_snapshot(snapshot)


if __name__ == "__main__":
    unittest.main()
