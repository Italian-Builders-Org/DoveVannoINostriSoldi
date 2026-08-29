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


def values(*, missing_before: int | None = None, invalid_year: int | None = None, base: float = 100) -> list[str]:
    result = []
    for year in range(1960, 2028):
        if missing_before is not None and year < missing_before:
            result.append("NA")
        elif invalid_year == year:
            result.append("not-a-number")
        else:
            result.append(f"{base + (year - 1960) * 0.25:.5f}")
    return result


def ameco_zip(spec: dict[str, object], *, mutate_row=None, extra_member: tuple[str, bytes] | None = None) -> bytes:
    ameco = spec["ameco"]
    rows_by_file: dict[str, list[list[str]]] = {f"AMECO{index}.CSV": [] for index in range(1, 19)}
    for indicator in ameco["series"]:
        for country_id, country in ameco["countries"].items():
            country_code = country["code"]
            country_name = country_id.title()
            if "derived" in indicator:
                for part, base in ((indicator["numerator"], 20), (indicator["denominator"], 100)):
                    row = [
                        part["codeTemplate"].format(country=country_code),
                        country_name,
                        "fixture",
                        part["title"],
                        part["unit"],
                        *values(base=base),
                        "",
                    ]
                    if mutate_row:
                        mutate_row(indicator["id"], country_id, part["file"], row)
                    rows_by_file[part["file"]].append(row)
            else:
                row = [
                    indicator["codeTemplate"].format(country=country_code),
                    country_name,
                    "fixture",
                    indicator["title"],
                    indicator["unit"],
                    *values(missing_before=1995 if indicator["id"] == "primary_balance" else None),
                    "",
                ]
                if mutate_row:
                    mutate_row(indicator["id"], country_id, indicator["file"], row)
                rows_by_file[indicator["file"]].append(row)
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for name, rows in rows_by_file.items():
            archive.writestr(name, csv_payload(rows))
        if extra_member:
            archive.writestr(*extra_member)
    return output.getvalue()


def chronology_html() -> bytes:
    return b"""<!doctype html><html><body>
    <h1>I Governi nelle Legislature</h1>
    <p>Governo Meloni</p><p>Governo Berlusconi II</p><p>Governo Dini</p>
    </body></html>"""


class GovernmentScorecardSnapshotTests(unittest.TestCase):
    def test_valid_inputs_build_a_reconciled_snapshot(self) -> None:
        spec = load_spec()
        ameco = ameco_zip(spec)
        chronology = chronology_html()
        snapshot = ETL.build_snapshot(spec, ameco, chronology, "2026-08-29T08:00:00Z")
        ETL.validate_snapshot(snapshot)
        self.assertEqual(len(snapshot["indicators"]), 6)
        self.assertEqual(len(snapshot["governments"]), 17)
        self.assertEqual(snapshot["governments"][-1]["name"], "Meloni-I")
        investment = next(item for item in snapshot["indicators"] if item["id"] == "investment_share")
        self.assertAlmostEqual(investment["countries"]["italy"][0]["value"], 20.0)
        self.assertEqual(snapshot["sources"]["ameco"]["sha256"], ETL.sha256_bytes(ameco))

    def test_spec_rejects_host_changes_and_weight_drift(self) -> None:
        hostile = load_spec()
        hostile["ameco"]["downloadUrl"] = "https://example.test/ameco.zip"
        with self.assertRaisesRegex(ETL.SnapshotError, "origine"):
            ETL.validate_spec(hostile)
        weights = load_spec()
        weights["ameco"]["series"][0]["weightBasisPoints"] += 1
        with self.assertRaisesRegex(ETL.SnapshotError, "pesi"):
            ETL.validate_spec(weights)

    def test_archive_rejects_extra_traversal_and_duplicate_members(self) -> None:
        spec = load_spec()
        with self.assertRaisesRegex(ETL.SnapshotError, "membro ZIP"):
            ETL.extract_ameco(spec, ameco_zip(spec, extra_member=("../AMECO19.CSV", b"x")))

        payload = ameco_zip(spec)
        duplicate = io.BytesIO()
        with zipfile.ZipFile(io.BytesIO(payload)) as source, zipfile.ZipFile(duplicate, "w") as target:
            for info in source.infolist():
                target.writestr(info.filename, source.read(info.filename))
            with warnings.catch_warnings():
                warnings.simplefilter("ignore", UserWarning)
                target.writestr("AMECO1.CSV", source.read("AMECO1.CSV"))
        with self.assertRaisesRegex(ETL.SnapshotError, "duplicato"):
            ETL.extract_ameco(spec, duplicate.getvalue())

    def test_series_title_and_numeric_schema_fail_closed(self) -> None:
        spec = load_spec()

        def wrong_title(indicator_id, country_id, _file, row):
            if indicator_id == "unemployment" and country_id == "italy":
                row[3] = "Wrong definition"

        with self.assertRaisesRegex(ETL.SnapshotError, "serie o titolo"):
            ETL.extract_ameco(spec, ameco_zip(spec, mutate_row=wrong_title))

        def wrong_number(indicator_id, country_id, _file, row):
            if indicator_id == "real_compensation" and country_id == "france":
                row[5 + (2024 - 1960)] = "not-a-number"

        with self.assertRaisesRegex(ETL.SnapshotError, "valore numerico"):
            ETL.extract_ameco(spec, ameco_zip(spec, mutate_row=wrong_number))

    def test_chronology_page_and_current_government_are_required(self) -> None:
        spec = load_spec()
        with self.assertRaisesRegex(ETL.SnapshotError, "pagina ufficiale"):
            ETL.extract_governments(spec, b"<html>unexpected</html>")
        altered = copy.deepcopy(spec)
        altered["governmentChronology"]["governments"][-1]["name"] = "Unknown-I"
        with self.assertRaisesRegex(ETL.SnapshotError, "governo corrente"):
            ETL.validate_spec(altered)

    def test_runtime_validation_rejects_missing_required_year_and_measure_orphan(self) -> None:
        spec = load_spec()
        snapshot = ETL.build_snapshot(spec, ameco_zip(spec), chronology_html(), "2026-08-29T08:00:00Z")
        broken_value = copy.deepcopy(snapshot)
        broken_value["indicators"][0]["countries"]["italy"][2024 - 1960]["value"] = None
        with self.assertRaisesRegex(ETL.SnapshotError, "dato obbligatorio"):
            ETL.validate_snapshot(broken_value)
        orphan = copy.deepcopy(snapshot)
        orphan["measures"][0]["government"] = "Missing-I"
        with self.assertRaisesRegex(ETL.SnapshotError, "governo assente"):
            ETL.validate_snapshot(orphan)


if __name__ == "__main__":
    unittest.main()
