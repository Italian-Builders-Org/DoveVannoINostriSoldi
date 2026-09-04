"""Fixture-level checks for the education atlas ETL contract."""

from __future__ import annotations

import copy
import csv
import io
import json
import unittest
from pathlib import Path
from unittest.mock import patch

from scripts.etl import education_atlas_snapshot as etl


SNAPSHOT_PATH = Path(__file__).resolve().parents[2] / "src/data/generated/education-atlas-snapshot.json"


def csv_bytes(fields: tuple[str, ...], rows: list[dict[str, str]]) -> bytes:
    output = io.StringIO(newline="")
    writer = csv.DictWriter(output, fieldnames=fields, lineterminator="\n")
    writer.writeheader()
    writer.writerows(rows)
    return output.getvalue().encode("utf-8")


def student_row(**overrides: str) -> dict[str, str]:
    row = {
        "ANNOSCOLASTICO": "202425",
        "CODICESCUOLA": "ABC123",
        "ORDINESCUOLA": "SCUOLA SECONDARIA II GRADO",
        "ANNOCORSO": "1",
        "TIPOPERCORSO": "LICEO",
        "PERCORSO": "SCIENTIFICO",
        "INDIRIZZO": "SCIENTIFICO",
        "ALUNNIMASCHI": "1",
        "ALUNNIFEMMINE": "2",
    }
    row.update(overrides)
    return row


def full_registry_rows() -> list[dict[str, str]]:
    source_labels = {code: label for label, code in etl.REGION_SOURCE_LABELS.items()}
    return [
        {
            "ANNOSCOLASTICO": "202425",
            "CODICESCUOLA": f"ABC{code}",
            "REGIONE": source_labels[code],
        }
        for code in etl.REGION_NAMES
        if code not in {"02", "04"}
    ]


def full_student_rows() -> list[dict[str, str]]:
    rows = [student_row(CODICESCUOLA=f"ABC{code}") for code in etl.REGION_NAMES if code not in {"02", "04"}]
    rows[0]["TIPOPERCORSO"] = "PROFESSIONALE IeFP"
    rows[0]["PERCORSO"] = "IEFP"
    return rows


class EducationAtlasSnapshotETLTests(unittest.TestCase):
    def committed_snapshot(self) -> dict:
        return json.loads(SNAPSHOT_PATH.read_text(encoding="utf-8"))

    def test_fixture_with_expected_schema_and_join_reconciles(self) -> None:
        students = etl.read_csv_bytes(
            csv_bytes(etl.STUDENT_FIELDS, full_student_rows()),
            etl.STUDENT_FIELDS,
            "https://example.test/students.csv",
        )
        registry = etl.registry_map(
            full_registry_rows(),
            "https://example.test/registry.csv",
            expected_period="202425",
        )

        regional, pathways, addresses, coverage = etl.aggregate_source(
            period="202425",
            school_type="state",
            students=students,
            registry=registry,
            source_url="https://example.test/students.csv",
        )

        self.assertEqual(coverage["sourceRows"], 18)
        self.assertEqual(coverage["matchedRows"], 18)
        self.assertEqual(coverage["unmatchedRows"], 0)
        self.assertEqual(coverage["regionCount"], 18)
        self.assertEqual(coverage["studentCount"], 54)
        self.assertEqual(regional[0]["studentCount"], 3)
        self.assertEqual(sum(row["femaleCount"] for row in pathways), 36)
        self.assertEqual(sum(row["maleCount"] for row in addresses), 18)

    def test_modified_csv_schema_fails_closed(self) -> None:
        fields = (*etl.STUDENT_FIELDS[:-1], "ALUNNIFEMMINE_MODIFICATO")
        row = student_row()
        row["ALUNNIFEMMINE_MODIFICATO"] = row.pop("ALUNNIFEMMINE")
        with self.assertRaises(ValueError):
            etl.read_csv_bytes(
                csv_bytes(fields, [row]),
                etl.STUDENT_FIELDS,
                "https://example.test/students.csv",
            )

    def test_regional_gender_total_must_reconcile(self) -> None:
        snapshot = self.committed_snapshot()
        snapshot["regionalObservations"][0]["studentCount"] += 1

        with self.assertRaisesRegex(ValueError, "Totale regionale non riconciliato"):
            etl.assert_snapshot(snapshot)

    def test_student_dimension_values_fail_closed(self) -> None:
        registry = {"ABC123": "15"}
        invalid_dimensions = (
            ("ANNOSCOLASTICO", "202324", "ANNOSCOLASTICO incoerente"),
            ("ORDINESCUOLA", "PRIMARIA", "ORDINESCUOLA inatteso"),
            ("TIPOPERCORSO", "ALTRO", "TIPOPERCORSO inatteso"),
        )

        for field, value, message in invalid_dimensions:
            with self.subTest(field=field):
                with self.assertRaisesRegex(ValueError, message):
                    etl.aggregate_source(
                        period="202425",
                        school_type="state",
                        students=[student_row(**{field: value})],
                        registry=registry,
                        source_url="https://example.test/students.csv",
                    )

    def test_registry_period_and_duplicate_codes_fail_closed(self) -> None:
        with self.assertRaisesRegex(ValueError, "ANNOSCOLASTICO incoerente nell'anagrafe"):
            etl.registry_map(
                [{"ANNOSCOLASTICO": "202324", "CODICESCUOLA": "ABC123", "REGIONE": "CAMPANIA"}],
                "https://example.test/registry.csv",
                expected_period="202425",
            )

        duplicate = [
            {"ANNOSCOLASTICO": "202425", "CODICESCUOLA": "ABC123", "REGIONE": "CAMPANIA"},
            {"ANNOSCOLASTICO": "202425", "CODICESCUOLA": "ABC123", "REGIONE": "CAMPANIA"},
        ]
        with self.assertRaisesRegex(ValueError, "Codice scuola duplicato"):
            etl.registry_map(duplicate, "https://example.test/registry.csv", expected_period="202425")

    def test_region_period_type_duplicate_and_short_coverage_fail_closed(self) -> None:
        duplicate_students = full_student_rows() + [full_student_rows()[0]]
        with self.assertRaisesRegex(ValueError, "Riga studenti duplicata"):
            etl.aggregate_source(
                period="202425",
                school_type="state",
                students=duplicate_students,
                registry=etl.registry_map(full_registry_rows(), "https://example.test/registry.csv"),
                source_url="https://example.test/students.csv",
            )

        with self.assertRaisesRegex(ValueError, "Copertura regionale inattesa"):
            etl.aggregate_source(
                period="202425",
                school_type="state",
                students=[student_row()],
                registry={"ABC123": "15"},
                source_url="https://example.test/students.csv",
            )

    def test_remote_source_size_is_bounded(self) -> None:
        class OversizedResponse:
            headers = {"Content-Length": str(etl.MAX_REMOTE_SOURCE_BYTES + 1)}

            def __enter__(self):
                return self

            def __exit__(self, *_args) -> None:
                return None

        with patch.object(etl.urllib.request, "urlopen", return_value=OversizedResponse()):
            with self.assertRaisesRegex(ValueError, "oltre il limite"):
                etl.source_bytes("https://example.test/too-large.csv", None, "unused.csv")

    def test_orphan_school_code_fails_closed(self) -> None:
        students = [student_row()]
        with self.assertRaisesRegex(ValueError, "non presente nell'anagrafe"):
            etl.aggregate_source(
                period="202425",
                school_type="state",
                students=students,
                registry={},
                source_url="https://example.test/students.csv",
            )

    def test_source_file_period_and_role_inventory_fails_closed(self) -> None:
        snapshot = self.committed_snapshot()

        incoherent_period = copy.deepcopy(snapshot)
        incoherent_period["sourceFiles"][0]["period"] = "202526"
        with self.assertRaises(ValueError):
            etl.assert_snapshot(incoherent_period)

        duplicate_role = copy.deepcopy(snapshot)
        duplicate_role["sourceFiles"][1]["role"] = "students"
        with self.assertRaises(ValueError):
            etl.assert_snapshot(duplicate_role)

    def test_snapshot_taxonomy_and_receipts_fail_closed(self) -> None:
        snapshot = self.committed_snapshot()

        unknown_pathway = copy.deepcopy(snapshot)
        unknown_pathway["pathways"][0]["code"] = "UNKNOWN"
        with self.assertRaisesRegex(ValueError, "Tassonomia percorsi incoerente"):
            etl.assert_snapshot(unknown_pathway)

        empty_receipt = copy.deepcopy(snapshot)
        empty_receipt["sourceFiles"][0]["rows"] = 0
        with self.assertRaisesRegex(ValueError, "Ricevuta sorgente non valida"):
            etl.assert_snapshot(empty_receipt)

        incomplete_coverage = copy.deepcopy(snapshot)
        incomplete_coverage["regionalObservations"][0]["regionCode"] = "02"
        incomplete_coverage["regionalObservations"][0]["regionName"] = "Valle d'Aosta"
        with self.assertRaisesRegex(ValueError, "Codici Regione incompleti"):
            etl.assert_snapshot(incomplete_coverage)

    def test_duplicate_source_url_fails_closed_and_manifest_reconciles(self) -> None:
        snapshot = self.committed_snapshot()

        duplicate_url = copy.deepcopy(snapshot)
        duplicate_url["sourceFiles"][1]["url"] = duplicate_url["sourceFiles"][0]["url"]
        with self.assertRaises(ValueError):
            etl.assert_snapshot(duplicate_url)

        manifest = etl.source_file_manifest(snapshot, etl.DEFAULT_OUTPUT)
        etl.assert_source_file_manifest(manifest, snapshot)
        self.assertEqual(len(manifest["files"]), 12)


if __name__ == "__main__":
    unittest.main()
