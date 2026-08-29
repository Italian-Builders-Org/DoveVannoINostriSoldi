from __future__ import annotations

import copy
import csv
import io
import json
import unittest
import warnings
import zipfile
from pathlib import Path
from tempfile import TemporaryDirectory

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
                base = 10 if indicator["id"] == "unemployment" else 0 if indicator["id"] == "primary_balance" else 100
                row = [
                    indicator["codeTemplate"].format(country=country_code),
                    country_name,
                    "fixture",
                    indicator["title"],
                    indicator["unit"],
                    *values(missing_before=1995 if indicator["id"] == "primary_balance" else None, base=base),
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


ITALIAN_MONTHS = (
    "gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno",
    "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre",
)


def chronology_html(
    spec: dict[str, object],
    *,
    newer_government: str | None = None,
    omit_historical_dates: bool = False,
) -> bytes:
    lines = []
    if newer_government:
        lines.append(f"{newer_government} (dal 1 gennaio 2027 - in carica)")
    historical_ids = {
        page["governmentId"]
        for page in spec["governmentChronology"]["historicalPages"]
    }
    for government in reversed(spec["governmentChronology"]["governments"]):
        if omit_historical_dates and government["id"] in historical_ids:
            lines.append(government["sourceLabel"])
            continue
        year, month, day = (int(part) for part in government["startDate"].split("-"))
        if government["status"] == "current":
            status = " - in carica"
        else:
            end_year, end_month, end_day = (int(part) for part in government["endDate"].split("-"))
            status = f" al {end_day} {ITALIAN_MONTHS[end_month - 1]} {end_year}"
        lines.append(f"{government['sourceLabel']} (dal {day} {ITALIAN_MONTHS[month - 1]} {year}{status})")
    body = "<br />\n".join(lines)
    return f"""<!doctype html><html><body>
    <h1>I Governi nelle Legislature</h1><dl><dt>Legislature</dt><dd>{body}</dd></dl>
    </body></html>""".encode()


def historical_payloads(spec: dict[str, object]) -> dict[str, bytes]:
    return {
        page["governmentId"]: (
            f"<!doctype html><html><head><title>{page['pageTitle']}</title></head><body>"
            f"<h1>{page['pageTitle']}</h1>Dal {int(page['startDate'][8:10])} "
            f"{ITALIAN_MONTHS[int(page['startDate'][5:7]) - 1]} {page['startDate'][:4]} "
            f"al {int(page['endDate'][8:10])} {ITALIAN_MONTHS[int(page['endDate'][5:7]) - 1]} "
            f"{page['endDate'][:4]}</body></html>"
        ).encode()
        for page in spec["governmentChronology"]["historicalPages"]
    }


class GovernmentScorecardSnapshotTests(unittest.TestCase):
    def test_valid_inputs_build_a_reconciled_snapshot(self) -> None:
        spec = load_spec()
        ameco = ameco_zip(spec)
        chronology = chronology_html(spec)
        snapshot = ETL.build_snapshot(spec, ameco, chronology, "2026-08-29T08:00:00Z", historical_payloads(spec))
        ETL.validate_snapshot(snapshot)
        self.assertEqual(len(snapshot["indicators"]), 6)
        self.assertEqual(len(snapshot["governments"]), 17)
        self.assertEqual(snapshot["governments"][-1]["name"], "Meloni-I")
        investment = next(item for item in snapshot["indicators"] if item["id"] == "investment_share")
        self.assertEqual(investment["sourceId"], "ameco")
        self.assertEqual(
            investment["sourceSeries"],
            [
                {
                    "file": "AMECO3.CSV",
                    "codeTemplate": "{country}.1.0.0.0.UIGT",
                    "title": "Gross fixed capital formation at current prices: total economy",
                    "unit": "Mrd national currency",
                },
                {
                    "file": "AMECO6.CSV",
                    "codeTemplate": "{country}.1.0.0.0.UVGD",
                    "title": "Gross domestic product at current prices",
                    "unit": "Mrd national currency",
                },
            ],
        )
        self.assertEqual(investment["derived"], "gross-fixed-capital-formation / gross-domestic-product * 100")
        self.assertIn("1995-2024", investment["coverageNotes"])
        self.assertAlmostEqual(investment["countries"]["italy"][0]["value"], 20.0)
        self.assertEqual(snapshot["sources"]["ameco"]["sha256"], ETL.sha256_bytes(ameco))
        self.assertEqual(len(snapshot["sources"]["governmentChronology"]["historicalReceipts"]), 5)
        self.assertEqual(snapshot["sources"]["governmentChronology"]["dateMeaning"], ETL.GOVERNMENT_DATE_BOUNDARY_MEANING)

    def test_camera_history_receipts_require_allowlisted_pages_and_dates(self) -> None:
        spec = load_spec()
        payloads = historical_payloads(spec)
        receipts = ETL.extract_historical_receipts(spec, payloads, "2026-08-29T08:00:00Z")
        self.assertEqual([receipt["governmentId"] for receipt in receipts], [
            "dini-i", "prodi-i", "dalema-i", "dalema-ii", "amato-ii",
        ])
        self.assertTrue(all(receipt["bytes"] > 0 and len(receipt["sha256"]) == 64 for receipt in receipts))
        with self.assertRaisesRegex(ETL.SnapshotError, "mancanti"):
            ETL.extract_historical_receipts(spec, {key: value for key, value in payloads.items() if key != "dini-i"})
        altered_payloads = dict(payloads)
        altered_payloads["dini-i"] = altered_payloads["dini-i"].replace(b"1996", b"1995", 1)
        with self.assertRaisesRegex(ETL.SnapshotError, "date"):
            ETL.extract_historical_receipts(spec, altered_payloads)
        altered_spec = copy.deepcopy(spec)
        altered_spec["governmentChronology"]["historicalPages"][0]["pageUrl"] = "https://storia.camera.it/governi/i-governo-dini/other"
        with self.assertRaisesRegex(ETL.SnapshotError, "URL o metadati storici"):
            ETL.validate_spec(altered_spec)
        altered_owner = copy.deepcopy(spec)
        altered_owner["governmentChronology"]["historicalOwner"] = "Fonte sconosciuta"
        with self.assertRaisesRegex(ETL.SnapshotError, "titolare"):
            ETL.validate_spec(altered_owner)

    def test_camera_fixture_directory_keeps_input_explicit(self) -> None:
        spec = load_spec()
        payloads = historical_payloads(spec)
        with TemporaryDirectory() as directory_name:
            directory = Path(directory_name)
            for government_id, payload in payloads.items():
                (directory / f"{government_id}.html").write_bytes(payload)
            loaded = ETL.load_historical_payloads(spec, directory)
        self.assertEqual(loaded, payloads)

    def test_spec_rejects_host_changes_and_methodology_drift(self) -> None:
        hostile = load_spec()
        hostile["ameco"]["downloadUrl"] = "https://example.test/ameco.zip"
        with self.assertRaisesRegex(ETL.SnapshotError, "origine"):
            ETL.validate_spec(hostile)
        weights = load_spec()
        weights["ameco"]["series"][0]["weightBasisPoints"] += 500
        weights["ameco"]["series"][1]["weightBasisPoints"] -= 500
        with self.assertRaisesRegex(ETL.SnapshotError, "manifest metodologia"):
            ETL.validate_spec(weights)
        direction = load_spec()
        direction["ameco"]["series"][0]["direction"] = "lower"
        with self.assertRaisesRegex(ETL.SnapshotError, "manifest metodologia"):
            ETL.validate_spec(direction)
        code = load_spec()
        code["ameco"]["series"][0]["codeTemplate"] = "{country}.wrong"
        with self.assertRaisesRegex(ETL.SnapshotError, "manifest metodologia"):
            ETL.validate_spec(code)
        country = load_spec()
        country["ameco"]["countries"]["italy"]["code"] = "XXX"
        with self.assertRaisesRegex(ETL.SnapshotError, "set non autorizzato"):
            ETL.validate_spec(country)
        method = load_spec()
        method["method"]["robustScale"] = 1
        with self.assertRaisesRegex(ETL.SnapshotError, "manifest metodologia"):
            ETL.validate_spec(method)

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
        live_shape = chronology_html(spec, omit_historical_dates=True)
        self.assertEqual(len(ETL.extract_governments(spec, live_shape)), 17)
        missing_recent_dates = chronology_html(spec).replace(
            b"Governo Berlusconi II (dal 11 giugno 2001 al 23 aprile 2005)",
            b"Governo Berlusconi II",
        )
        with self.assertRaisesRegex(ETL.SnapshotError, "data iniziale assente"):
            ETL.extract_governments(spec, missing_recent_dates)
        with self.assertRaisesRegex(ETL.SnapshotError, "pagina ufficiale"):
            ETL.extract_governments(spec, b"<html>unexpected</html>")
        with self.assertRaisesRegex(ETL.SnapshotError, "fonte e specifica divergono"):
            ETL.extract_governments(spec, chronology_html(spec, newer_government="Governo Nuovo"))
        altered = copy.deepcopy(spec)
        altered["governmentChronology"]["governments"][-1]["sourceLabel"] = "Governo Sconosciuto"
        with self.assertRaisesRegex(ETL.SnapshotError, "fonte e specifica divergono"):
            ETL.extract_governments(altered, chronology_html(spec))
        altered_end = copy.deepcopy(spec)
        altered_end["governmentChronology"]["governments"][5]["endDate"] = "2004-04-23"
        with self.assertRaisesRegex(ETL.SnapshotError, "data finale divergente"):
            ETL.extract_governments(altered_end, chronology_html(spec))
        altered_dini = copy.deepcopy(spec)
        altered_dini["governmentChronology"]["governments"][0]["startDate"] = "1995-01-18"
        with self.assertRaisesRegex(ETL.SnapshotError, "data iniziale divergente"):
            ETL.extract_governments(altered_dini, chronology_html(spec))
        altered_dalema = copy.deepcopy(spec)
        altered_dalema["governmentChronology"]["governments"][3]["endDate"] = "2000-04-24"
        with self.assertRaisesRegex(ETL.SnapshotError, "data finale divergente"):
            ETL.extract_governments(altered_dalema, chronology_html(spec))

    def test_runtime_validation_rejects_missing_required_year_and_measure_orphan(self) -> None:
        spec = load_spec()
        snapshot = ETL.build_snapshot(spec, ameco_zip(spec), chronology_html(spec), "2026-08-29T08:00:00Z", historical_payloads(spec))
        broken_value = copy.deepcopy(snapshot)
        broken_value["indicators"][0]["countries"]["italy"][2024 - 1960]["value"] = None
        with self.assertRaisesRegex(ETL.SnapshotError, "dato obbligatorio"):
            ETL.validate_snapshot(broken_value)
        absurd_value = copy.deepcopy(snapshot)
        absurd_value["indicators"][0]["countries"]["italy"][2024 - 1960]["value"] = 1_000_000
        with self.assertRaisesRegex(ETL.SnapshotError, "intervallo plausibile"):
            ETL.validate_snapshot(absurd_value)
        orphan = copy.deepcopy(snapshot)
        orphan["measures"][0]["government"] = "Missing-I"
        with self.assertRaisesRegex(ETL.SnapshotError, "governo assente"):
            ETL.validate_snapshot(orphan)
        balanced_weights = copy.deepcopy(snapshot)
        balanced_weights["indicators"][0]["weightBasisPoints"] += 500
        balanced_weights["indicators"][1]["weightBasisPoints"] -= 500
        with self.assertRaisesRegex(ETL.SnapshotError, "manifest indicatore"):
            ETL.validate_snapshot(balanced_weights)
        wrong_code = copy.deepcopy(snapshot)
        wrong_code["indicators"][0]["sourceCodes"]["italy"][0] = "ITA.wrong"
        with self.assertRaisesRegex(ETL.SnapshotError, "codici serie"):
            ETL.validate_snapshot(wrong_code)
        wrong_receipt = copy.deepcopy(snapshot)
        wrong_receipt["sources"]["governmentChronology"]["historicalReceipts"][0]["sha256"] = "x"
        with self.assertRaisesRegex(ETL.SnapshotError, "ricevuta Camera"):
            ETL.validate_snapshot(wrong_receipt)
        wrong_series = copy.deepcopy(snapshot)
        wrong_series["indicators"][0]["sourceSeries"][0]["file"] = "AMECO18.CSV"
        with self.assertRaisesRegex(ETL.SnapshotError, "provenance serie"):
            ETL.validate_snapshot(wrong_series)
        wrong_formula = copy.deepcopy(snapshot)
        wrong_formula["indicators"][5]["derived"] = "gross-fixed-capital-formation / gross-domestic-product"
        with self.assertRaisesRegex(ETL.SnapshotError, "formula derivata"):
            ETL.validate_snapshot(wrong_formula)

    def test_forecast_gaps_do_not_invalidate_complete_observations(self) -> None:
        spec = load_spec()
        snapshot = ETL.build_snapshot(spec, ameco_zip(spec), chronology_html(spec), "2026-08-29T08:00:00Z", historical_payloads(spec))
        for indicator in snapshot["indicators"]:
            for points in indicator["countries"].values():
                for point in points:
                    if point["year"] >= snapshot["sources"]["ameco"]["forecastFrom"]:
                        point["value"] = None
        ETL.validate_snapshot(snapshot)


if __name__ == "__main__":
    unittest.main()
