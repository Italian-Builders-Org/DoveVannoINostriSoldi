#!/usr/bin/env python3
from __future__ import annotations

import gzip
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "scripts" / "etl" / "anac_operator_national_summaries.py"


def write_gz_jsonl(path: Path, rows: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with gzip.open(path, "wt", encoding="utf-8") as handle:
        for row in rows:
            handle.write(json.dumps(row, ensure_ascii=False, sort_keys=True) + "\n")


class AnacOperatorNationalSummariesTests(unittest.TestCase):
    def test_builds_ranked_summaries_from_matched_procedures(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            index = Path(temp_dir) / "index"
            operators = index / "operators"
            write_gz_jsonl(
                index / "search.jsonl.gz",
                [
                    {
                        "schemaVersion": 1,
                        "ref": "op-00000001",
                        "name": "ALFA SPA",
                        "searchKey": "ALFASPA",
                        "awardCount": 5,
                        "attributedAwardCount": 4,
                        "attributedValue": "100.00",
                        "yearMin": 2020,
                        "yearMax": 2024,
                    },
                    {
                        "schemaVersion": 1,
                        "ref": "op-00000002",
                        "name": "BETA SRL",
                        "searchKey": "BETASRL",
                        "awardCount": 9,
                        "attributedAwardCount": 8,
                        "attributedValue": "50.00",
                        "yearMin": 2019,
                        "yearMax": 2023,
                    },
                ],
            )
            write_gz_jsonl(
                operators / "00.jsonl.gz",
                [
                    {
                        "schemaVersion": 1,
                        "ref": "op-00000001",
                        "name": "ALFA SPA",
                        "searchKey": "ALFASPA",
                        "nameVariants": 1,
                        "awardCount": 5,
                        "attributedAwardCount": 4,
                        "attributedValue": "100.00",
                        "yearMin": 2020,
                        "yearMax": 2024,
                        "awardsPublished": 2,
                        "awardsTruncated": False,
                        "awards": [
                            {
                                "cig": "A000000001",
                                "awardId": "1",
                                "awardedAt": "2024-01-01",
                                "amount": "10.00",
                                "amountStatus": "positive-exact-cent",
                                "attribution": "single-operator",
                                "procedure": {
                                    "oggetto": "MANUTENZIONE STRADE COMUNALI NORD",
                                    "cpvCode": "45233141-9",
                                    "cpvLabel": "LAVORI DI MANUTENZIONE STRADALE",
                                    "contractingAuthority": "COMUNE DI ROMA",
                                    "cigYear": 2024,
                                    "matched": True,
                                },
                            },
                            {
                                "cig": "A000000002",
                                "awardId": "2",
                                "awardedAt": "2023-01-01",
                                "amount": "20.00",
                                "amountStatus": "positive-exact-cent",
                                "attribution": "single-operator",
                                "procedure": {
                                    "oggetto": "Oggetto non pubblicabile a causa della potenziale presenza di dati",
                                    "cpvCode": "99999999",
                                    "cpvLabel": "Cpv prevalente non disponibile",
                                    "contractingAuthority": "COMUNE DI ROMA",
                                    "cigYear": 2023,
                                    "matched": True,
                                },
                            },
                        ],
                    }
                ],
            )
            write_gz_jsonl(
                operators / "01.jsonl.gz",
                [
                    {
                        "schemaVersion": 1,
                        "ref": "op-00000002",
                        "name": "BETA SRL",
                        "searchKey": "BETASRL",
                        "nameVariants": 1,
                        "awardCount": 9,
                        "attributedAwardCount": 8,
                        "attributedValue": "50.00",
                        "yearMin": 2019,
                        "yearMax": 2023,
                        "awardsPublished": 1,
                        "awardsTruncated": False,
                        "awards": [
                            {
                                "cig": "A000000001",
                                "awardId": "9",
                                "awardedAt": "2024-01-01",
                                "amount": None,
                                "amountStatus": "missing",
                                "attribution": "multipart",
                                "procedure": {
                                    "oggetto": "MANUTENZIONE STRADE COMUNALI NORD",
                                    "cpvCode": "45233141-9",
                                    "cpvLabel": "LAVORI DI MANUTENZIONE STRADALE",
                                    "contractingAuthority": "COMUNE DI ROMA",
                                    "cigYear": 2024,
                                    "matched": True,
                                },
                            }
                        ],
                    }
                ],
            )
            (index / "meta.json").write_text(
                json.dumps(
                    {
                        "schemaVersion": 1,
                        "dataset": "anac-operator-awards-index",
                        "totals": {"operators": 2},
                        "limitations": ["fixture"],
                        "sourceSpecSha256": "a" * 64,
                    },
                    indent=2,
                )
                + "\n",
                encoding="utf-8",
            )
            completed = subprocess.run(
                [
                    sys.executable,
                    str(SCRIPT),
                    "--index",
                    str(index),
                    "--limit",
                    "5",
                    "--observed-at",
                    "2026-09-08T12:00:00Z",
                ],
                cwd=ROOT,
                capture_output=True,
                text=True,
                check=False,
            )
            self.assertEqual(completed.returncode, 0, completed.stderr)
            summaries = json.loads((index / "summaries.json").read_text(encoding="utf-8"))
            self.assertEqual(summaries["topOperatorsByAwardCount"][0]["ref"], "op-00000002")
            self.assertEqual(summaries["topOperatorsByAttributedValue"][0]["ref"], "op-00000001")
            self.assertEqual(summaries["coverage"]["uniqueMatchedCigsCounted"], 2)
            self.assertEqual(summaries["topCpv"][0]["code"], "45233141-9")
            self.assertEqual(summaries["topCpv"][0]["count"], 1)
            self.assertTrue(all(row["code"] != "99999999" for row in summaries["topCpv"]))
            self.assertEqual(summaries["topProcedureObjects"][0]["count"], 1)
            self.assertTrue(
                all("non pubblicabile" not in row["label"].lower() for row in summaries["topProcedureObjects"])
            )
            check = subprocess.run(
                [sys.executable, str(SCRIPT), "--check", "--index", str(index)],
                cwd=ROOT,
                capture_output=True,
                text=True,
                check=False,
            )
            self.assertEqual(check.returncode, 0, check.stderr)


if __name__ == "__main__":
    unittest.main()
