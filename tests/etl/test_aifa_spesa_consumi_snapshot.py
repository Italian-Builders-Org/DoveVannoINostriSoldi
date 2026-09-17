"""Offline checks for the AIFA spesa e consumo reader (issue #371).

The official releases are ~30 MB each and stay out of the repository, so these
tests build small synthetic releases with the published record layout. When
DVNS_AIFA_INPUT_DIR points at the locked files, the real 2024 release is
parsed as well.
"""

from __future__ import annotations

import io
import json
import os
import tempfile
import unittest
import zipfile
from pathlib import Path

import aifa_spesa_consumi_snapshot as aifa

INPUT_DIR = os.environ.get("DVNS_AIFA_INPUT_DIR")
REAL_2024 = {
    "name": "dati2024_04.12.2025.csv",
    "bytes": 31_895_365,
    "sha256": "a7ccd6b30a10fdec78d4ad53d3da1b24c0d87130de54adba309462f220f059eb",
}


def record(month: int, region: str, *, klass: str = "A", atc4: str = "A02BC",
           traceability: tuple[str, str] = ("10", "100.50"),
           convenzionata: tuple[str, str] = ("20", "200.25"),
           label: str = "Inibitori della pompa protonica") -> str:
    atc1, atc2, atc3 = atc4[:1], atc4[:3], atc4[:4]
    fields = [
        "2024", f"{month:02d}", region, "REGIONE", klass,
        atc1, "APPARATO", atc2, "ULCERA", atc3, "ANTIULCERA", atc4, label,
        traceability[0], traceability[1], convenzionata[0], convenzionata[1],
    ]
    return "|".join(fields)


def release(extra: list[str] | None = None, *, skip: tuple[int, str] | None = None) -> bytes:
    lines = ["|".join(aifa.HEADER)]
    for region in sorted(aifa.REGION_CODES):
        for month in aifa.MONTHS:
            if skip == (month, region):
                continue
            lines.append(record(month, region))
    lines.extend(extra or [])
    return ("\r\n".join(lines) + "\r\n").encode("cp1252")


class CommittedArtifactsTests(unittest.TestCase):
    """Gli artefatti committati devono restare coerenti con lock e meta, senza rete."""

    def test_check_passes_on_committed_pair(self):
        aifa.check(aifa.DEFAULT_SPEC, aifa.DEFAULT_DATA, aifa.DEFAULT_META)

    def test_published_rows_and_totals_are_declared(self):
        data = json.loads(aifa.DEFAULT_DATA.read_text(encoding="utf-8"))
        spec = aifa.load_spec()
        self.assertEqual(len(data["observations"]), spec["expected"]["publishedRows"])
        self.assertEqual(data["granularity"], "annual-region-class-atc2")
        years = [entry["year"] for entry in data["reconciliation"]["byYear"]]
        self.assertEqual(years, spec["expected"]["years"])
        # I due canali restano separati: se fossero stati fusi i totali coinciderebbero.
        for entry in data["reconciliation"]["byYear"]:
            self.assertNotEqual(entry["traceabilitySpendCents"], entry["convenzionataSpendCents"])

    def test_tampered_artifact_fails_check(self):
        data = json.loads(aifa.DEFAULT_DATA.read_text(encoding="utf-8"))
        data["observations"][0]["convenzionataSpendCents"] = 1
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "data.json"
            path.write_bytes(aifa.canonical_bytes(data) + b"\n")
            with self.assertRaises(aifa.SnapshotError):
                aifa.check(aifa.DEFAULT_SPEC, path, aifa.DEFAULT_META)


class ParseReleaseTests(unittest.TestCase):
    def test_complete_release_parses_and_covers_every_region_month(self):
        rows = aifa.parse_release(release(), 2024)
        self.assertEqual(len(rows), 21 * 12)
        aifa.check_coverage(rows, 2024)
        totals = aifa.release_totals(rows)
        self.assertEqual(totals["traceability"]["spendCents"], 252 * 10_050)
        self.assertEqual(totals["convenzionata"]["spendCents"], 252 * 20_025)

    def test_money_is_exact_cents_and_rejects_hidden_precision(self):
        self.assertEqual(aifa.parse_money_cents("12.3", "t", signed=False), 1230)
        self.assertEqual(aifa.parse_money_cents("-0.05", "t", signed=True), -5)
        self.assertIsNone(aifa.parse_money_cents("", "t", signed=False))
        with self.assertRaises(aifa.SnapshotError):
            aifa.parse_money_cents("8.5000039339", "t", signed=False)
        with self.assertRaises(aifa.SnapshotError):
            aifa.parse_money_cents("-1.00", "t", signed=False)

    def test_empty_channel_stays_null_and_zero_stays_zero(self):
        extra = [
            record(1, "010", atc4="B01AC", convenzionata=("", "")),
            record(1, "010", atc4="B01AB", traceability=("0", "0")),
        ]
        rows = aifa.parse_release(release(extra), 2024)
        empty = next(row for row in rows if row["atc4"] == "B01AC")
        zero = next(row for row in rows if row["atc4"] == "B01AB")
        self.assertEqual(empty["measures"]["convenzionata"], {"packs": None, "spendCents": None})
        self.assertEqual(zero["measures"]["traceability"], {"packs": 0, "spendCents": 0})

    def test_negative_only_on_traceability(self):
        rows = aifa.parse_release(release([record(2, "030", atc4="J07BX", traceability=("-3", "-45.10"))]), 2024)
        self.assertEqual(next(row for row in rows if row["atc4"] == "J07BX")["measures"]["traceability"]["spendCents"], -4510)
        with self.assertRaisesRegex(aifa.SnapshotError, "negativ"):
            aifa.parse_release(release([record(2, "030", atc4="J07BX", convenzionata=("-3", "-45.10"))]), 2024)

    def test_class_aliases_are_normalized_and_unknown_classes_fail(self):
        rows = aifa.parse_release(release([record(3, "050", klass="C-BIS", atc4="N02BE"), record(3, "050", klass="", atc4="N02BF")]), 2024)
        cbis = next(row for row in rows if row["atc4"] == "N02BE")
        self.assertEqual((cbis["classRaw"], cbis["class"]), ("C-BIS", "C-bis"))
        self.assertEqual(next(row for row in rows if row["atc4"] == "N02BF")["class"], "")
        with self.assertRaisesRegex(aifa.SnapshotError, "classe sconosciuta"):
            aifa.parse_release(release([record(3, "050", klass="0", atc4="N02BG")]), 2024)

    def test_atc_above_level_iv_is_flagged_not_rewritten(self):
        rows = aifa.parse_release(release([record(4, "080", atc4="V09X")]), 2024)
        row = next(row for row in rows if row["atc4"] == "V09X")
        self.assertEqual(row["atcLevel"], "above-IV")
        self.assertEqual(row["atc4"], "V09X")

    def test_structural_errors_fail_closed(self):
        cases = {
            "duplicata": release([record(1, "010")]),
            "mese non canonico": release([record(1, "010", atc4="B01AC").replace("|01|", "|1|", 1)]),
            "regione sconosciuto": release([record(1, "999", atc4="B01AC")]),
            "gerarchia ATC": release([record(1, "010", atc4="B01AC").replace("|B01|", "|C01|", 1)]),
            "entrambe presenti": release([record(1, "010", atc4="B01AC", convenzionata=("5", ""))]),
            "header": release()[:10] + b"X" + release()[11:],
        }
        for message, payload in cases.items():
            with self.subTest(message=message):
                with self.assertRaisesRegex(aifa.SnapshotError, message):
                    aifa.parse_release(payload, 2024)
        with self.assertRaisesRegex(aifa.SnapshotError, "CRLF"):
            aifa.parse_release(release().replace(b"\r\n", b"\n"), 2024)

    def test_missing_region_month_fails_coverage(self):
        rows = aifa.parse_release(release(skip=(6, "140")), 2024)
        with self.assertRaisesRegex(aifa.SnapshotError, "senza spesa positiva"):
            aifa.check_coverage(rows, 2024)

    def test_descriptions_are_trimmed_including_non_breaking_spaces(self):
        rows = aifa.parse_release(release([record(5, "090", atc4="L04AH", label="\xa0INIBITORI")]), 2024)
        self.assertEqual(next(row for row in rows if row["atc4"] == "L04AH")["atc4Label"], "INIBITORI")


class AggregateTests(unittest.TestCase):
    def test_every_granularity_reconciles_to_the_cent(self):
        extra = [
            record(1, "010", atc4="A02BA", traceability=("-1", "-0.01")),
            record(1, "010", atc4="A02BB", convenzionata=("", "")),
        ]
        rows = aifa.parse_release(release(extra), 2024)
        totals = aifa.release_totals(rows)
        for granularity in aifa.GRANULARITIES:
            with self.subTest(granularity=granularity):
                groups = aifa.aggregate(rows, granularity)
                self.assertEqual(sum(group["sourceRows"] for group in groups), len(rows))
                self.assertEqual(
                    sum(group["measures"]["traceability"]["spendCents"] or 0 for group in groups),
                    totals["traceability"]["spendCents"],
                )

    def test_channel_absent_in_whole_group_stays_null(self):
        rows = aifa.parse_release(release(), 2024)
        rows.append({**rows[0], "atc2": "Z99", "atc4": "Z99XX", "measures": {
            "traceability": {"packs": 1, "spendCents": 100},
            "convenzionata": {"packs": None, "spendCents": None},
        }})
        groups = aifa.aggregate(rows, "annual-region-class-atc2")
        lonely = next(group for group in groups if group["atc2"] == "Z99")
        self.assertIsNone(lonely["measures"]["convenzionata"]["spendCents"])
        self.assertEqual(lonely["measures"]["traceability"]["spendCents"], 100)

    def test_tampered_aggregate_does_not_reconcile(self):
        rows = aifa.parse_release(release(), 2024)
        groups = aifa.aggregate(rows, "annual-region-class-atc2")
        groups[0]["measures"]["convenzionata"]["spendCents"] += 1
        with self.assertRaisesRegex(aifa.SnapshotError, "non riconcilia"):
            aifa.reconcile(rows, groups)


class ReadReleaseTests(unittest.TestCase):
    def test_file_and_zip_member_are_pinned(self):
        payload = release()
        with tempfile.TemporaryDirectory() as directory:
            csv_path = Path(directory) / "dati.csv"
            csv_path.write_bytes(payload)
            self.assertEqual(
                aifa.read_release(csv_path, expected_bytes=len(payload), expected_sha256=aifa.digest(payload)),
                payload,
            )
            with self.assertRaisesRegex(aifa.SnapshotError, "diversi dal lock"):
                aifa.read_release(csv_path, expected_bytes=len(payload), expected_sha256="0" * 64)

            buffer = io.BytesIO()
            with zipfile.ZipFile(buffer, "w") as archive:
                archive.writestr("dati.csv", payload)
            zip_path = Path(directory) / "dati.zip"
            zip_path.write_bytes(buffer.getvalue())
            zipped = zip_path.read_bytes()
            inner = aifa.read_release(
                zip_path, expected_bytes=len(zipped), expected_sha256=aifa.digest(zipped),
                member="dati.csv", member_bytes=len(payload), member_sha256=aifa.digest(payload),
            )
            self.assertEqual(inner, payload)
            with self.assertRaisesRegex(aifa.SnapshotError, "diversi dal lock"):
                aifa.read_release(
                    zip_path, expected_bytes=len(zipped), expected_sha256=aifa.digest(zipped),
                    member="dati.csv", member_bytes=len(payload), member_sha256="0" * 64,
                )

    @unittest.skipUnless(INPUT_DIR and (Path(INPUT_DIR) / REAL_2024["name"]).is_file(), "rilascio AIFA 2024 non disponibile in locale")
    def test_real_2024_release_parses_and_reconciles(self):
        payload = aifa.read_release(
            Path(INPUT_DIR) / REAL_2024["name"],
            expected_bytes=REAL_2024["bytes"],
            expected_sha256=REAL_2024["sha256"],
        )
        rows = aifa.parse_release(payload, 2024)
        aifa.check_coverage(rows, 2024)
        self.assertEqual(len(rows), 177_749)
        totals = aifa.release_totals(rows)
        # Totali del rilascio ricalcolati in centesimi; la tracciabilità coincide con
        # OsMed 2024 Tab. 1.1.2 (18.065 M€), la convenzionata no (vedi il lock in #371).
        self.assertEqual(round(totals["traceability"]["spendCents"] / 10**8), 18_068)
        self.assertEqual(round(totals["convenzionata"]["spendCents"] / 10**8), 10_032)
        for granularity in aifa.GRANULARITIES:
            aifa.aggregate(rows, granularity)


if __name__ == "__main__":
    unittest.main()
