from __future__ import annotations

import csv
import importlib.util
import io
import json
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
MODULE_PATH = ROOT / "scripts" / "research" / "anac_cig_audit.py"
MANIFEST_PATH = ROOT / "docs" / "research" / "data" / "anac-cigs-2025-2026-08-20.json"
SPEC = importlib.util.spec_from_file_location("anac_cig_audit", MODULE_PATH)
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = MODULE
SPEC.loader.exec_module(MODULE)


FIELDS = [
    "cig",
    "importo_lotto",
    "oggetto_principale_contratto",
    "tipo_scelta_contraente",
    "modalita_realizzazione",
    "anno_pubblicazione",
    "mese_pubblicazione",
    "flag_prevalente",
    "stato",
]


class AnacCigAuditTest(unittest.TestCase):
    def write_zip(self, path: Path, rows: list[dict[str, str]]) -> None:
        buffer = io.StringIO(newline="")
        writer = csv.DictWriter(buffer, fieldnames=FIELDS, delimiter=";")
        writer.writeheader()
        writer.writerows(rows)
        with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
            archive.writestr("cig.csv", buffer.getvalue())

    def test_reproduces_declared_filters_without_calling_amounts_prices(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "cig.zip"
            self.write_zip(
                path,
                [
                    {
                        "cig": "A",
                        "importo_lotto": "139900",
                        "oggetto_principale_contratto": "SERVIZI",
                        "tipo_scelta_contraente": "AFFIDAMENTO DIRETTO",
                        "modalita_realizzazione": "CONTRATTO D'APPALTO",
                        "anno_pubblicazione": "2025",
                        "mese_pubblicazione": "1",
                        "flag_prevalente": "1",
                        "stato": "ATTIVO",
                    },
                    {
                        "cig": "B",
                        "importo_lotto": "150000",
                        "oggetto_principale_contratto": "FORNITURE",
                        "tipo_scelta_contraente": "PROCEDURA APERTA",
                        "modalita_realizzazione": "CONTRATTO D'APPALTO",
                        "anno_pubblicazione": "2025",
                        "mese_pubblicazione": "1",
                        "flag_prevalente": "1",
                        "stato": "ATTIVO",
                    },
                    {
                        "cig": "C",
                        "importo_lotto": "150000",
                        "oggetto_principale_contratto": "LAVORI",
                        "tipo_scelta_contraente": "AFFIDAMENTO DIRETTO",
                        "modalita_realizzazione": "CONTRATTO D'APPALTO",
                        "anno_pubblicazione": "2025",
                        "mese_pubblicazione": "1",
                        "flag_prevalente": "1",
                        "stato": "ATTIVO",
                    },
                    {
                        "cig": "D",
                        "importo_lotto": "139000",
                        "oggetto_principale_contratto": "SERVIZI",
                        "tipo_scelta_contraente": "AFFIDAMENTO DIRETTO",
                        "modalita_realizzazione": "CONTRATTO D'APPALTO",
                        "anno_pubblicazione": "2025",
                        "mese_pubblicazione": "1",
                        "flag_prevalente": "1",
                        "stato": "CANCELLATO",
                    },
                ],
            )

            result = MODULE.audit([path], 2025)

        self.assertEqual(result["population"]["records"], 3)
        self.assertEqual(result["population"]["inactiveRecordsExcluded"], 1)
        self.assertEqual(result["coverage"]["observedMonths"], [1])
        self.assertEqual(result["procedureChoice"]["directAward"]["records"], 2)
        self.assertAlmostEqual(result["procedureChoice"]["directAward"]["sharePercent"], 66.666667)
        self.assertEqual(result["servicesAndSuppliesBelow140000"]["records"], 1)
        self.assertEqual(result["thresholdBand135000To140000"]["strictContractRecords"], 1)
        self.assertEqual(result["exactContractAmounts"]["139900"], 1)
        self.assertEqual(result["anacPublishedScopeProxy"]["denominatorRecords"], 2)
        self.assertEqual(result["anacPublishedScopeProxy"]["directAwardSharePercent"], 50.0)
        self.assertTrue(any("prezzo unitario" in item for item in result["interpretationLimits"]))
        self.assertNotIn("resourceUrl", result["inputs"][0])
        self.assertNotIn("sourceLastModified", result["inputs"][0])

    def test_synthetic_input_cannot_inherit_official_provenance(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "cig.zip"
            self.write_zip(
                path,
                [
                    {
                        "cig": "SYNTHETIC",
                        "importo_lotto": "10000",
                        "oggetto_principale_contratto": "SERVIZI",
                        "tipo_scelta_contraente": "AFFIDAMENTO DIRETTO",
                        "modalita_realizzazione": "CONTRATTO D'APPALTO",
                        "anno_pubblicazione": "2025",
                        "mese_pubblicazione": "1",
                        "flag_prevalente": "1",
                        "stato": "ATTIVO",
                    }
                ],
            )

            with self.assertRaisesRegex(MODULE.AuditInputError, "hash diverso"):
                MODULE.audit([path], 2025, attach_official_provenance=True)

    def test_annual_replica_requires_all_twelve_months(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "cig.zip"
            rows = []
            for month in range(1, 12):
                rows.append(
                    {
                        "cig": f"CIG-{month}",
                        "importo_lotto": "10000",
                        "oggetto_principale_contratto": "SERVIZI",
                        "tipo_scelta_contraente": "AFFIDAMENTO DIRETTO",
                        "modalita_realizzazione": "CONTRATTO D'APPALTO",
                        "anno_pubblicazione": "2025",
                        "mese_pubblicazione": str(month),
                        "flag_prevalente": "1",
                        "stato": "ATTIVO",
                    }
                )
            self.write_zip(path, rows)

            with self.assertRaisesRegex(MODULE.AuditInputError, "manca.*12"):
                MODULE.audit([path], 2025, require_complete_year=True)

    def test_rejects_years_with_different_threshold_rules(self) -> None:
        with self.assertRaisesRegex(MODULE.AuditInputError, "soltanto.*2025"):
            MODULE.audit([], 2024)

    def test_committed_manifest_keeps_the_twelve_input_hashes(self) -> None:
        manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
        inputs = manifest["inputs"]
        proxy = manifest["anacPublishedScopeProxy"]

        self.assertTrue(manifest["coverage"]["completeYear"])
        self.assertEqual(manifest["coverage"]["observedMonths"], list(range(1, 13)))
        self.assertEqual(len(inputs), 12)
        self.assertEqual(len({entry["name"] for entry in inputs}), 12)
        self.assertTrue(all(len(entry["sha256"]) == 64 for entry in inputs))
        self.assertEqual(
            [entry["observedMonths"] for entry in inputs],
            [[month] for month in range(1, 13)],
        )
        self.assertTrue(
            all(
                entry["resourceUrl"].startswith(
                    "https://dati.anticorruzione.it/opendata/download/"
                )
                and entry["resourcePageUrl"].startswith(
                    "https://dati.anticorruzione.it/opendata/dataset/cig-2025/resource/"
                )
                and entry["sourceLastModified"] == "2026-01-16"
                and entry["sourcePublishedAt"] is None
                for entry in inputs
            )
        )
        self.assertEqual(
            proxy["denominatorRecords"],
            proxy["directBelowThresholdRecords"] + proxy["nonDirectAboveThresholdRecords"],
        )

    def test_official_resource_metadata_is_month_specific(self) -> None:
        january = MODULE.official_resource_metadata(1)
        december = MODULE.official_resource_metadata(12)

        self.assertTrue(january["resourceUrl"].endswith("cig_csv_2025_01.zip"))
        self.assertTrue(december["resourceUrl"].endswith("cig_csv_2025_12.zip"))
        self.assertNotEqual(january["resourcePageUrl"], december["resourcePageUrl"])

    def test_proxy_excludes_every_direct_award_family_above_threshold(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "cig.zip"
            rows = []
            for month in range(1, 13):
                rows.append(
                    {
                        "cig": f"DIRECT-{month}",
                        "importo_lotto": "150000",
                        "oggetto_principale_contratto": "SERVIZI",
                        "tipo_scelta_contraente": "AFFIDAMENTO DIRETTO IN ADESIONE AD ACCORDO QUADRO",
                        "modalita_realizzazione": "CONTRATTO DISCENDENTE SENZA SUCCESSIVO CONFRONTO COMPETITIVO",
                        "anno_pubblicazione": "2025",
                        "mese_pubblicazione": str(month),
                        "flag_prevalente": "1",
                        "stato": "ATTIVO",
                    }
                )
            self.write_zip(path, rows)

            result = MODULE.audit([path], 2025, require_complete_year=True)

        self.assertEqual(result["anacPublishedScopeProxy"]["denominatorRecords"], 0)
        self.assertIsNone(result["anacPublishedScopeProxy"]["directAwardSharePercent"])

    def test_fails_closed_on_duplicate_cig(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            first = Path(temporary) / "first.zip"
            second = Path(temporary) / "second.zip"
            row = {
                "cig": "DUPLICATO",
                "importo_lotto": "1000",
                "oggetto_principale_contratto": "SERVIZI",
                "tipo_scelta_contraente": "AFFIDAMENTO DIRETTO",
                "modalita_realizzazione": "CONTRATTO D'APPALTO",
                "anno_pubblicazione": "2025",
                "mese_pubblicazione": "1",
                "flag_prevalente": "1",
                "stato": "ATTIVO",
            }
            self.write_zip(first, [row])
            self.write_zip(second, [row])

            with self.assertRaisesRegex(MODULE.AuditInputError, "CIG duplicato"):
                MODULE.audit([first, second], 2025)


if __name__ == "__main__":
    unittest.main()
