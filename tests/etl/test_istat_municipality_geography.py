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

    def test_health_metadata_is_derived_from_the_snapshot(self):
        snapshot = {
            "datasetId": "istat-municipality-geography",
            "generatedAt": "2026-08-26T00:00:00Z",
            "years": [
                {"year": 2025, "referenceDate": "31/12/2025", "municipalities": 7_896},
                {"year": 2026, "referenceDate": "25/08/2026", "municipalities": 7_894},
            ],
        }
        self.assertEqual(
            MODULE.build_metadata(snapshot),
            {
                "schemaVersion": 1,
                "datasetId": "istat-municipality-geography",
                "generatedAt": "2026-08-26T00:00:00Z",
                "availableYears": [2025, 2026],
                "latest": {
                    "year": 2026,
                    "sourceTimestamp": "2026-08-25",
                    "municipalities": 7_894,
                },
            },
        )


if __name__ == "__main__":
    unittest.main()
