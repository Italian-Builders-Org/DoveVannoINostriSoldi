import csv
import gzip
import hashlib
import io
import json
import sqlite3
import tempfile
import unittest
import zipfile
from contextlib import closing
from datetime import date
from decimal import Decimal, Inexact, localcontext
from pathlib import Path
from unittest.mock import patch

from anac_operator_awards_index import ContractError, project_operator
from anac_operator_history import (
    lot_amount,
    project_cig,
    screening_2025,
    summarize_history,
)
from anac_operator_history_build import load_cigs
from anac_operator_history_blocks import write_blocks


def procedure(amount="135000", **changes):
    row = {
        "cig": "A000000001",
        "anno_pubblicazione": "2025",
        "flag_prevalente": "1",
        "stato": "ATTIVO",
        "importo_lotto": amount,
        "oggetto_principale_contratto": "SERVIZI",
        "tipo_scelta_contraente": "AFFIDAMENTO DIRETTO",
        "modalita_realizzazione": "CONTRATTO D'APPALTO",
        "cf_amministrazione_appaltante": "",
        "denominazione_amministrazione_appaltante": "Ente",
        "oggetto_lotto": "",
        "oggetto_gara": "",
        "cod_cpv": "",
        "descrizione_cpv": "",
        **changes,
    }
    return project_cig(row)


class OperatorHistoryTests(unittest.TestCase):
    def test_annual_and_operator_totals_preserve_all_source_decimals(self):
        rows = [
            (
                "A000000001",
                "1",
                "Operatore",
                "2024-01-01",
                "13967918771.31369701537537695",
                "positive-subcent",
                1,
            ),
            (
                "A000000002",
                "2",
                "Operatore",
                "2025-01-01",
                "0.0000000000000000054",
                "positive-subcent",
                1,
            ),
        ]
        with localcontext() as context:
            context.prec = 3
            context.traps[Inexact] = True
            operator = project_operator("op-00000001", rows, award_limit=None)
            summary = summarize_history(operator, {})
        self.assertEqual(
            Decimal(operator["attributedValue"]),
            Decimal("13967918771.3136970153753769554"),
        )
        self.assertEqual(
            [row["attributedValue"] for row in summary["yearly"]],
            [row[4] for row in rows],
        )

    def test_award_duplicates_keep_only_unambiguous_values_in_either_order(self):
        from anac_operator_awards_index import AWARD_HEADERS, load_awards, prepare_db

        def read(rows):
            with tempfile.TemporaryDirectory() as folder, closing(
                sqlite3.connect(":memory:")
            ) as db:
                prepare_db(db)
                path = Path(folder) / "awards.csv"
                with path.open("w", newline="") as stream:
                    writer = csv.DictWriter(
                        stream, fieldnames=AWARD_HEADERS, delimiter=";"
                    )
                    writer.writeheader()
                    for awarded_at, amount in rows:
                        row = dict.fromkeys(AWARD_HEADERS, "")
                        row.update(
                            cig="A000000001",
                            id_aggiudicazione="1",
                            data_aggiudicazione_definitiva=awarded_at,
                            importo_aggiudicazione=amount,
                        )
                        writer.writerow(row)
                load_awards(db, path, path.name, "utf-8", date(2026, 9, 12))
                return db.execute(
                    "SELECT awarded_at,amount,amount_status FROM awards"
                ).fetchall()

        rows = [
            ("2025-11-28", "45082.0"),
            ("2025-11-28", "51639.34"),
            ("2025-11-28", "45082.0"),
        ]
        self.assertEqual(read(rows), [("2025-11-28", None, "conflicting")])
        self.assertEqual(
            read(list(reversed(rows))), [("2025-11-28", None, "conflicting")]
        )
        for rows in [
            [("", "10"), ("2025-01-01", "10")],
            [("2025-01-01", "10"), ("", "10")],
        ]:
            self.assertEqual(read(rows), [("2025-01-01", "10", "positive-exact-cent")])
        with self.assertRaises(ContractError):
            read([("2025-01-01", "10"), ("2025-01-02", "10")])

    def test_packed_pages_are_independent_and_filters_cover_every_award(self):
        rows = [
            (
                "A000000001",
                str(i),
                "Impresa",
                "2025-01-01",
                "10",
                "positive-exact-cent",
                1,
            )
            for i in range(205)
        ]
        operator = project_operator("op-00000001", rows, award_limit=None)
        output = io.BytesIO(b"previous operator")
        output.seek(0, 2)
        meta = write_blocks(output, operator["ref"], operator["awards"], {})
        self.assertEqual([block["rows"] for block in meta["blocks"]], [100, 100, 5])
        self.assertEqual(len(meta["filterRows"]), 205)
        recovered = []
        for block in meta["blocks"]:
            content = output.getvalue()[
                block["offset"] : block["offset"] + block["bytes"]
            ]
            self.assertEqual(hashlib.sha256(content).hexdigest(), block["sha256"])
            decoded = json.loads(gzip.decompress(content))
            self.assertEqual(decoded["start"], len(recovered))
            self.assertEqual(decoded["ref"], operator["ref"])
            recovered.extend(decoded["awards"])
        self.assertEqual(
            [award["awardId"] for award in recovered],
            [award["awardId"] for award in operator["awards"]],
        )

    def test_locked_cig_join_excludes_conflicting_prevalent_records(self):
        from anac_operator_awards_index import prepare_db
        from anac_operator_history import CIG_FIELDS

        with tempfile.TemporaryDirectory() as folder, closing(
            sqlite3.connect(":memory:")
        ) as db:
            root = Path(folder)
            cache = root / "2025"
            cache.mkdir()
            prepare_db(db)
            for cig in ["A000000001", "A000000002"]:
                db.execute(
                    "INSERT INTO awards VALUES (?, '1', NULL, NULL, 'missing')", (cig,)
                )
            stream = io.StringIO()
            writer = csv.DictWriter(stream, fieldnames=CIG_FIELDS, delimiter=";")
            writer.writeheader()
            row = dict.fromkeys(CIG_FIELDS, "")
            row.update(
                cig="A000000001",
                anno_pubblicazione="2025",
                flag_prevalente="1",
                importo_lotto="100",
                stato="ATTIVO",
            )
            writer.writerow(row)
            writer.writerow(row)
            writer.writerow({**row, "cig": "A000000002"})
            writer.writerow({**row, "cig": "A000000002", "importo_lotto": "140000"})
            payload = stream.getvalue().encode()
            path = cache / "cig_csv_2025_01.zip"
            with zipfile.ZipFile(path, "w") as archive:
                archive.writestr("cig.csv", payload)
            with zipfile.ZipFile(path) as archive:
                info = archive.getinfo("cig.csv")
            resource = {
                "year": 2025,
                "fileName": path.name,
                "archiveBytes": path.stat().st_size,
                "archiveSha256": hashlib.sha256(path.read_bytes()).hexdigest(),
                "member": {
                    "name": "cig.csv",
                    "bytes": len(payload),
                    "crc32": f"{info.CRC:08x}",
                    "sha256": hashlib.sha256(payload).hexdigest(),
                },
            }
            spec_path = root / "scripts/etl/specs"
            spec_path.mkdir(parents=True)
            (spec_path / "anac-cig-2007-2025.source.json").write_text(
                json.dumps({"resources": [resource]})
            , encoding="utf-8")
            with patch("anac_operator_history_build.ROOT", root):
                coverage = load_cigs(db, root)
            self.assertEqual(coverage["matchedCigs"], 1)
            self.assertEqual(coverage["conflictingCigs"], 1)
            self.assertIsNone(
                db.execute(
                    "SELECT payload FROM procedures WHERE cig='A000000002'"
                ).fetchone()[0]
            )

    def test_threshold_boundaries_and_exclusions(self):
        cases = [
            procedure(x)
            for x in [
                "134999.99",
                "135000",
                "139999.99",
                "140000",
                "0",
                "-1",
                "",
                "NaN",
            ]
        ]
        cases += [
            procedure("100", **changes)
            for changes in [
                {"stato": "CANCELLATO"},
                {"oggetto_principale_contratto": "LAVORI"},
                {"flag_prevalente": "0"},
                {"modalita_realizzazione": "ACCORDO QUADRO"},
                {"anno_pubblicazione": "2024"},
            ]
        ]
        counts = screening_2025({str(i): item for i, item in enumerate(cases)})
        self.assertEqual(counts["matchedCigs"], 12)
        self.assertEqual(counts["classifiableCigs"], 4)
        self.assertEqual(counts["below140000"], 3)
        self.assertEqual(counts["band135000To140000"], 2)
        self.assertEqual(counts["directBelow140000"], 3)
        self.assertEqual(counts["excludedCigs"], 8)

    def test_full_history_reconciles_without_counting_cigs_twice(self):
        rows = [
            (
                "A000000001",
                str(i),
                "Impresa",
                "2025-01-01",
                "10.25",
                "positive-exact-cent",
                1,
            )
            for i in range(18)
        ]
        rows += [
            ("A000000002", "19", "Impresa", None, "0", "zero", 1),
            ("A000000003", "20", "Impresa", "2024-01-01", None, "missing", 1),
            (
                "A000000004",
                "21",
                "Impresa",
                "2024-01-01",
                "2000",
                "positive-exact-cent",
                2,
            ),
        ]
        record = project_operator("op-00000001", rows, award_limit=None)
        self.assertEqual(record["awardsPublished"], 21)
        self.assertIsNone(record["awards"][-1]["awardedAt"])
        procedures = {
            "A000000001": {
                **procedure(),
                "authorityRef": "authority-1",
                "authorityLabel": "Ente",
            },
            "A000000002": {
                **procedure(),
                "authorityRef": "authority-2",
                "authorityLabel": "Ente",
            },
        }
        summary = summarize_history(record, procedures)
        self.assertEqual(summary["distinctContractingAuthorityCount"], 2)
        self.assertEqual(summary["awardsWithoutAuthority"], 2)
        self.assertEqual(summary["screening2025"]["below140000"], 2)
        self.assertEqual(
            summary["yearly"],
            [
                {
                    "year": 2024,
                    "awardCount": 2,
                    "attributedAwardCount": 0,
                    "attributedValue": None,
                },
                {
                    "year": 2025,
                    "awardCount": 18,
                    "attributedAwardCount": 18,
                    "attributedValue": "184.50",
                },
                {
                    "year": None,
                    "awardCount": 1,
                    "attributedAwardCount": 1,
                    "attributedValue": "0",
                },
            ],
        )
        with self.assertRaisesRegex(ContractError, "tutte le aggiudicazioni"):
            summarize_history(project_operator("op-00000001", rows), procedures)
        record["awards"].append(record["awards"][0])
        record["awardCount"] += 1
        with self.assertRaisesRegex(ContractError, "duplicata"):
            summarize_history(record, procedures)

    def test_missing_procedure_does_not_become_non_direct(self):
        counts = screening_2025({"A000000001": procedure(tipo_scelta_contraente="")})
        self.assertEqual(counts["below140000"], 1)
        self.assertEqual(counts["directBelow140000"], 0)
        self.assertEqual(counts["missingProcedureBelow140000"], 1)

    def test_source_year_and_money_are_not_inferred(self):
        self.assertEqual(lot_amount("0"), ("0", "zero"))
        self.assertEqual(lot_amount(""), (None, "missing"))
        self.assertEqual(lot_amount("infinito"), (None, "invalid"))
        self.assertEqual(lot_amount("135000,01"), ("135000.01", "positive"))
        with self.assertRaises(ContractError):
            procedure(anno_pubblicazione="")
        with self.assertRaises(ContractError):
            project_cig({})


if __name__ == "__main__":
    unittest.main()
