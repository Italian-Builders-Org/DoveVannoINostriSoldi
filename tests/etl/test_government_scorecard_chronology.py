from __future__ import annotations

import copy
import json
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from scripts.etl import government_scorecard_chronology as ETL


ROOT = Path(__file__).resolve().parents[2]
REGISTRY_PATH = ROOT / "scripts/etl/specs/government-scorecard-chronology.json"


def registry() -> dict[str, object]:
    return json.loads(REGISTRY_PATH.read_text(encoding="utf-8"))


class GovernmentScorecardChronologyTests(unittest.TestCase):
    def test_registry_accepts_exactly_the_17_verified_oaths(self) -> None:
        parsed = ETL.validate_registry(registry())

        self.assertEqual(len(parsed["governments"]), 17)
        self.assertEqual(parsed["governments"][0]["id"], "dini-i")
        self.assertEqual(parsed["governments"][-1]["id"], "meloni-i")
        self.assertEqual(parsed["governments"][-1]["startDate"], "2022-10-22")

    def test_registry_rejects_missing_source_duplicate_date_order_id_count_current_and_editorial_end(self) -> None:
        mutations = [
            lambda value: value["governments"][0].__setitem__("sourceLocator", ""),
            lambda value: value["governments"][0].__setitem__("sourceUrl", ""),
            lambda value: value["governments"][0].__setitem__("startDate", "1995-1-17"),
            lambda value: value["governments"][1].__setitem__("startDate", "1995-01-17"),
            lambda value: value["governments"].__setitem__(slice(0, 2), list(reversed(value["governments"][:2]))),
            lambda value: value["governments"][0].__setitem__("id", "new-government"),
            lambda value: value["governments"].pop(),
            lambda value: value["governments"].append(copy.deepcopy(value["governments"][-1])),
            lambda value: value["governments"][0].__setitem__("status", "current"),
            lambda value: value["governments"][0].__setitem__("endExclusive", "1996-05-18"),
        ]

        for mutate in mutations:
            candidate = copy.deepcopy(registry())
            mutate(candidate)
            with self.subTest(mutate=mutate):
                with self.assertRaises(ETL.RegistryValidationError):
                    ETL.validate_registry(candidate)

    def test_failed_refresh_never_replaces_the_last_valid_registry(self) -> None:
        with TemporaryDirectory() as directory:
            output = Path(directory) / "registry.json"
            original = b'{"last":"valid"}\n'
            output.write_bytes(original)
            candidate = registry()
            candidate["governments"].append({
                "id": "unregistered-government",
                "name": "Unregistered",
                "startDate": "2026-09-02",
                "sourceOwner": "Presidenza della Repubblica",
                "sourceUrl": "https://www.quirinale.it/",
                "sourceLocator": "Unexpected new government locator 2026",
            })

            with self.assertRaises(ETL.RegistryValidationError):
                ETL.refresh_registry(candidate, output)

            self.assertEqual(output.read_bytes(), original)

    def test_valid_refresh_uses_a_complete_atomic_json_write(self) -> None:
        with TemporaryDirectory() as directory:
            output = Path(directory) / "registry.json"
            ETL.refresh_registry(registry(), output)

            self.assertEqual(json.loads(output.read_text(encoding="utf-8")), registry())
            self.assertTrue(output.read_bytes().endswith(b"\n"))


if __name__ == "__main__":
    unittest.main()
