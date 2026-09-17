from __future__ import annotations

import copy
import csv
import io
import json
import unittest
import warnings
import zipfile
from pathlib import Path

from scripts.etl import government_scorecard_snapshot as ETL


ROOT = Path(__file__).resolve().parents[2]
SPEC_PATH = ROOT / "scripts/etl/specs/government-scorecard.source.json"
YEARS = [str(year) for year in range(1960, 2028)]


def load_spec() -> dict[str, object]:
    return json.loads(SPEC_PATH.read_text(encoding="utf-8"))


def csv_payload(rows: list[list[str]]) -> bytes:
    output = io.StringIO(newline="")
    writer = csv.writer(output, lineterminator="\n")
    writer.writerow(["CODE", "COUNTRY", "SUB-CHAPTER", "TITLE", "UNIT", *YEARS, "Unnamed: 73"])
    writer.writerows(rows)
    return output.getvalue().encode("latin-1")


def values(*, base: float) -> list[str]:
    return [f"{base + (year - 1960) * 0.25:.5f}" for year in range(1960, 2028)]


def ameco_zip(
    spec: dict[str, object],
    *,
    mutate_row=None,
    extra_member: tuple[str, bytes] | None = None,
    omit_member: str | None = None,
) -> bytes:
    ameco = spec["ameco"]
    rows_by_file: dict[str, list[list[str]]] = {f"AMECO{index}.CSV": [] for index in range(1, 19)}
    for indicator in ameco["series"]:
        for country_id, country in ameco["countries"].items():
            country_code = country["code"]
            if "derived" in indicator:
                parts = ((indicator["numerator"], 20), (indicator["denominator"], 100))
            else:
                base = 10 if indicator["id"] == "unemployment" else 0 if indicator["id"] == "primary_balance" else 100
                parts = ((indicator, base),)
            for part, base in parts:
                row = [
                    part["codeTemplate"].format(country=country_code),
                    country_id.title(),
                    "fixture",
                    part["title"],
                    part["rawUnitTemplate"].format(currency=country["currencyCode"]),
                    *values(base=base),
                    "",
                ]
                if mutate_row:
                    mutate_row(indicator["id"], country_id, part["file"], row)
                rows_by_file[part["file"]].append(row)
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for name, rows in rows_by_file.items():
            if name != omit_member:
                archive.writestr(name, csv_payload(rows))
        if extra_member:
            archive.writestr(*extra_member)
    return output.getvalue()


class GovernmentScorecardSnapshotTests(unittest.TestCase):
    def test_valid_official_shape_builds_the_normalized_artifact(self) -> None:
        spec = load_spec()
        payload = ameco_zip(spec)
        snapshot = ETL.build_snapshot(spec, payload, "2026-09-03T08:00:00Z")
        ETL.validate_snapshot(snapshot)

        self.assertEqual(
            set(snapshot),
            {"schemaVersion", "methodologyVersion", "generatedAt", "sources", "indicators", "caveats"},
        )
        self.assertEqual(snapshot["schemaVersion"], 2)
        self.assertEqual(len(snapshot["indicators"]), 6)
        self.assertEqual(snapshot["sources"]["ameco"]["sha256"], ETL.sha256(payload))
        investment = next(item for item in snapshot["indicators"] if item["id"] == "investment_share")
        self.assertAlmostEqual(investment["countries"]["italy"][0]["value"], 20.0)
        self.assertNotIn("governments", snapshot)
        self.assertNotIn("measures", snapshot)

    def test_source_spec_rejects_origin_country_and_method_drift(self) -> None:
        mutations = [
            lambda value: value["ameco"].__setitem__("license", "other license"),
            lambda value: value["ameco"].__setitem__("downloadUrl", "https://example.test/ameco.zip"),
            lambda value: value["ameco"]["countries"]["italy"].__setitem__("code", "XXX"),
            lambda value: value["ameco"]["series"][0].__setitem__("direction", "lower"),
            lambda value: value["ameco"]["series"][0].__setitem__("codeTemplate", "{country}.wrong"),
        ]
        for mutate in mutations:
            candidate = copy.deepcopy(load_spec())
            mutate(candidate)
            with self.subTest(mutate=mutate), self.assertRaises(ETL.SnapshotError):
                ETL.validate_spec(candidate)

    def test_archive_rejects_missing_extra_traversal_and_duplicate_members(self) -> None:
        spec = load_spec()
        for payload in (
            ameco_zip(spec, omit_member="AMECO18.CSV"),
            ameco_zip(spec, extra_member=("EXTRA.CSV", b"x")),
            ameco_zip(spec, extra_member=("../AMECO21.CSV", b"x")),
        ):
            with self.subTest(), self.assertRaisesRegex(ETL.SnapshotError, "set dei file"):
                ETL.safe_archive(payload)

        payload = ameco_zip(spec)
        duplicate = io.BytesIO()
        with zipfile.ZipFile(io.BytesIO(payload)) as source, zipfile.ZipFile(duplicate, "w") as target:
            for info in source.infolist():
                target.writestr(info.filename, source.read(info.filename))
            with warnings.catch_warnings():
                warnings.simplefilter("ignore", UserWarning)
                target.writestr("AMECO1.CSV", source.read("AMECO1.CSV"))
        with self.assertRaises(ETL.SnapshotError):
            ETL.safe_archive(duplicate.getvalue())

    def test_series_identity_numbers_and_required_observations_fail_closed(self) -> None:
        spec = load_spec()

        def wrong_title(indicator_id, country_id, _file, row):
            if indicator_id == "unemployment" and country_id == "italy":
                row[3] = "Wrong definition"

        with self.assertRaisesRegex(ETL.SnapshotError, "serie mancante"):
            ETL.extract_indicators(spec, ETL.validate_spec(spec), ameco_zip(spec, mutate_row=wrong_title))

        def wrong_number(indicator_id, country_id, _file, row):
            if indicator_id == "real_compensation" and country_id == "france":
                row[5 + (2024 - 1960)] = "not-a-number"

        with self.assertRaisesRegex(ETL.SnapshotError, "numero non valido"):
            ETL.extract_indicators(spec, ETL.validate_spec(spec), ameco_zip(spec, mutate_row=wrong_number))

        snapshot = ETL.build_snapshot(spec, ameco_zip(spec), "2026-09-03T08:00:00Z")
        snapshot["indicators"][0]["countries"]["italy"][2024 - 1960]["value"] = None
        with self.assertRaisesRegex(ETL.SnapshotError, "osservazione obbligatoria"):
            ETL.validate_snapshot(snapshot)

    def test_forecasts_may_be_missing_because_they_never_enter_the_score(self) -> None:
        spec = load_spec()
        snapshot = ETL.build_snapshot(spec, ameco_zip(spec), "2026-09-03T08:00:00Z")
        for indicator in snapshot["indicators"]:
            for points in indicator["countries"].values():
                for point in points:
                    if point["year"] >= snapshot["sources"]["ameco"]["forecastFrom"]:
                        point["value"] = None
        ETL.validate_snapshot(snapshot)


if __name__ == "__main__":
    unittest.main()
