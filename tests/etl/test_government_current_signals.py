from __future__ import annotations

import copy
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from scripts.etl import government_current_signals as ETL


ROOT = Path(__file__).resolve().parents[2]
SPEC_PATH = ROOT / "scripts/etl/specs/government-current-signals.source.json"


def load_spec() -> dict[str, object]:
    return json.loads(SPEC_PATH.read_text(encoding="utf-8"))


def source_payload() -> bytes:
    periods = ["2022-10", "2022-11", "2022-12"]
    sizes = [1, 2, 3, 4, len(periods)]
    values: dict[str, float] = {}
    for unit_position in range(2):
        for indicator_position in range(3):
            for country_position in range(4):
                for time_position in range(len(periods)):
                    index = (((unit_position * 3 + indicator_position) * 4 + country_position) * len(periods)) + time_position
                    value = (
                        90 + indicator_position * 10 + country_position + time_position / 10
                        if unit_position == 0
                        else 2 + indicator_position + country_position / 10 + time_position / 100
                    )
                    values[str(index)] = value
    payload = {
        "version": "2.0",
        "class": "dataset",
        "label": "Harmonised index of consumer prices (HICP) - ECOICOP ver.2 - indices and rates of change, monthly data",
        "source": "ESTAT",
        "updated": "2023-01-15T11:00:00+0100",
        "value": values,
        "id": ["freq", "unit", "coicop18", "geo", "time"],
        "size": sizes,
        "dimension": {
            "freq": {"label": "Time frequency", "category": {"index": {"M": 0}, "label": {"M": "Monthly"}}},
            "unit": {"label": "Unit of measure", "category": {"index": {"I25": 0, "RCH_A": 1}, "label": {"I25": "Index, 2025=100", "RCH_A": "Annual rate of change"}}},
            "coicop18": {"label": "Classification", "category": {"index": {"TOTAL": 0, "CP01": 1, "CP04": 2}, "label": {"TOTAL": "Total", "CP01": "Food and non-alcoholic beverages", "CP04": "Housing, water, electricity, gas and other fuels"}}},
            "geo": {"label": "Geography", "category": {"index": {"DE": 0, "ES": 1, "FR": 2, "IT": 3}, "label": {"DE": "Germany", "ES": "Spain", "FR": "France", "IT": "Italy"}}},
            "time": {"label": "Time", "category": {"index": {period: index for index, period in enumerate(periods)}, "label": {period: period for period in periods}}},
        },
        "extension": {},
    }
    return json.dumps(payload, separators=(",", ":")).encode("utf-8")


class GovernmentCurrentSignalsTests(unittest.TestCase):
    def test_valid_json_stat_builds_complete_monthly_signals(self) -> None:
        snapshot = ETL.build_snapshot(load_spec(), source_payload(), "2023-01-20T10:00:00Z")
        ETL.validate_snapshot(snapshot)
        self.assertEqual(snapshot["source"]["referencePeriodThrough"], "2022-12")
        self.assertEqual(snapshot["source"]["sourceUpdatedAt"], "2023-01-15T10:00:00Z")
        all_items = snapshot["indicators"][0]
        self.assertEqual(all_items["indexUnit"], "indice 2025=100")
        self.assertEqual(all_items["annualRateUnit"], "variazione percentuale annua")
        self.assertEqual(all_items["countries"]["italy"][0], {"period": "2022-10", "index": 93.0, "annualRate": 2.3})
        self.assertEqual(len(all_items["countries"]["france"]), 3)

    def test_source_contract_rejects_origin_and_filter_drift(self) -> None:
        wrong_origin = load_spec()
        wrong_origin["source"]["apiUrl"] = wrong_origin["source"]["apiUrl"].replace("ec.europa.eu", "example.test")
        with self.assertRaisesRegex(ETL.SnapshotError, "origine"):
            ETL.validate_spec(wrong_origin)
        wrong_filter = load_spec()
        wrong_filter["source"]["apiUrl"] = wrong_filter["source"]["apiUrl"].replace("CP04", "CP07")
        with self.assertRaisesRegex(ETL.SnapshotError, "filtri"):
            ETL.validate_spec(wrong_filter)

    def test_missing_observation_and_label_drift_fail_closed(self) -> None:
        missing = json.loads(source_payload())
        missing["value"].pop("0")
        with self.assertRaisesRegex(ETL.SnapshotError, "osservazioni"):
            ETL.build_snapshot(load_spec(), json.dumps(missing).encode(), "2023-01-20T10:00:00Z")
        wrong_label = json.loads(source_payload())
        wrong_label["dimension"]["coicop18"]["category"]["label"]["CP04"] = "Changed"
        with self.assertRaisesRegex(ETL.SnapshotError, "ECOICOP"):
            ETL.build_snapshot(load_spec(), json.dumps(wrong_label).encode(), "2023-01-20T10:00:00Z")

    def test_period_gaps_and_snapshot_coverage_drift_fail_closed(self) -> None:
        gap = json.loads(source_payload())
        gap["dimension"]["time"]["category"]["index"] = {"2022-10": 0, "2022-12": 1, "2023-01": 2}
        gap["dimension"]["time"]["category"]["label"] = {"2022-10": "2022-10", "2022-12": "2022-12", "2023-01": "2023-01"}
        with self.assertRaisesRegex(ETL.SnapshotError, "non continua"):
            ETL.build_snapshot(load_spec(), json.dumps(gap).encode(), "2023-02-01T10:00:00Z")
        valid = ETL.build_snapshot(load_spec(), source_payload(), "2023-01-20T10:00:00Z")
        broken = copy.deepcopy(valid)
        broken["indicators"][0]["countries"]["italy"].pop()
        with self.assertRaisesRegex(ETL.SnapshotError, "copertura"):
            ETL.validate_snapshot(broken)

    def test_check_mode_validates_the_source_spec_before_the_artifact(self) -> None:
        valid_spec = load_spec()
        snapshot = ETL.build_snapshot(valid_spec, source_payload(), "2023-01-20T10:00:00Z")
        invalid_spec = copy.deepcopy(valid_spec)
        invalid_spec["source"]["datasetCode"] = "wrong_dataset"
        with tempfile.TemporaryDirectory() as directory:
            spec_path = Path(directory) / "source.json"
            output_path = Path(directory) / "snapshot.json"
            spec_path.write_text(json.dumps(invalid_spec), encoding="utf-8")
            output_path.write_text(json.dumps(snapshot), encoding="utf-8")
            with mock.patch.object(sys, "argv", [
                "government_current_signals.py",
                "--check",
                "--spec",
                str(spec_path),
                "--output",
                str(output_path),
            ]):
                with self.assertRaisesRegex(ETL.SnapshotError, "identità inattesa"):
                    ETL.main()


if __name__ == "__main__":
    unittest.main()
