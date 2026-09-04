#!/usr/bin/env python3
"""Tests for the ISTAT 2024 enterprise turnover ETL pipeline."""

from __future__ import annotations

import json
import unittest
from pathlib import Path

from scripts.etl.istat_enterprise_turnover import (
    ATECO_VERSION,
    EXPECTED_REGION_CODES,
    MACRO_SECTORS,
    OUTPUT_PATH,
    PERIOD,
    RESOURCE_BYTES,
    RESOURCE_SHA256,
    UNIT,
    parse_int,
    validate_snapshot,
)


class IstatEnterpriseTurnoverETLTests(unittest.TestCase):
    def test_integer_parser_rejects_fractional_source_values(self) -> None:
        self.assertEqual(parse_int("216750478", "turnover"), 216_750_478)
        self.assertEqual(parse_int("216750478.0", "turnover"), 216_750_478)
        with self.assertRaises(ValueError):
            parse_int("216750478.5", "turnover")

    def test_committed_snapshot_passes_offline_validation(self) -> None:
        self.assertTrue(OUTPUT_PATH.exists(), f"Committed snapshot missing: {OUTPUT_PATH}")
        snapshot = json.loads(OUTPUT_PATH.read_text(encoding="utf-8"))
        validate_snapshot(snapshot)

        self.assertEqual(snapshot["schemaVersion"], 1)
        self.assertEqual(snapshot["observationType"], "aggregate")
        self.assertEqual(snapshot["geographyLevel"], "region")
        self.assertEqual(snapshot["atecoVersion"], ATECO_VERSION)
        self.assertEqual(snapshot["period"], PERIOD)
        self.assertEqual(snapshot["unit"], UNIT)
        self.assertEqual(len(snapshot["regions"]), 20)
        self.assertEqual(len(snapshot["macroSectors"]), 3)
        self.assertEqual(len(snapshot["observations"]), 60)

    def test_campania_turnover_parity_and_macro_sector_reconciliation(self) -> None:
        snapshot = json.loads(OUTPUT_PATH.read_text(encoding="utf-8"))
        obs_by_key = {
            f"{row['geographyCode']}|{row['macroSector']}": row
            for row in snapshot["observations"]
        }

        # Official Tavola 1 turnover for Campania (Code 15) must be exactly 216750478
        campania_tot = obs_by_key.get("15|ALL")
        self.assertIsNotNone(campania_tot)
        self.assertEqual(campania_tot["value"], 216_750_478)
        self.assertEqual(campania_tot["geographyName"], "Campania")
        self.assertEqual(campania_tot["unit"], "migliaia di euro")
        self.assertEqual(campania_tot["atecoVersion"], "ATECO 2007 agg. 2022")

        # Official Tavola 2 breakdown: Industria = 78917895, Servizi = 137832583
        campania_ind = obs_by_key.get("15|INDUSTRIA")
        campania_ser = obs_by_key.get("15|SERVIZI")
        self.assertIsNotNone(campania_ind)
        self.assertIsNotNone(campania_ser)
        self.assertEqual(campania_ind["value"], 78_917_895)
        self.assertEqual(campania_ser["value"], 137_832_583)
        self.assertEqual(campania_ind["value"] + campania_ser["value"], campania_tot["value"])

    def test_national_turnover_and_macro_sectors(self) -> None:
        snapshot = json.loads(OUTPUT_PATH.read_text(encoding="utf-8"))
        national = snapshot["national"]

        self.assertEqual(national["turnoverThousandEuro"], 3_768_464_269)
        self.assertEqual(national["industryTurnoverThousandEuro"], 1_702_409_224)
        self.assertEqual(national["servicesTurnoverThousandEuro"], 2_066_055_045)
        self.assertEqual(
            national["industryTurnoverThousandEuro"] + national["servicesTurnoverThousandEuro"],
            national["turnoverThousandEuro"],
        )

    def test_aggregate_only_boundary_and_no_individual_company_fields(self) -> None:
        snapshot = json.loads(OUTPUT_PATH.read_text(encoding="utf-8"))
        forbidden_keys = {
            "companyName", "businessName", "name", "ragioneSociale", "denominazione",
            "vatId", "piva", "partitaIva", "cf", "taxId", "fiscalCode", "codiceFiscale",
            "address", "city", "comune", "cap", "zip",
            "revenue", "profit", "utile", "ebitda",
        }

        for row in snapshot["observations"]:
            self.assertEqual(row["observationType"], "aggregate")
            self.assertEqual(row["geographyLevel"], "region")
            self.assertIn(row["geographyCode"], EXPECTED_REGION_CODES)
            self.assertIn(row["macroSector"], {"ALL", "INDUSTRIA", "SERVIZI"})
            for key in forbidden_keys:
                self.assertNotIn(key, row, f"Forbidden entity-level key '{key}' found in observation")

    def test_provenance_and_licensing(self) -> None:
        snapshot = json.loads(OUTPUT_PATH.read_text(encoding="utf-8"))
        source = snapshot["source"]

        self.assertEqual(source["id"], "istat-frame-territoriale-2024")
        self.assertEqual(source["archive"], {"bytes": RESOURCE_BYTES, "sha256": RESOURCE_SHA256})
        self.assertEqual(source["license"], "CC BY 4.0")
        self.assertEqual(source["publisher"], "Istituto Nazionale di Statistica (ISTAT)")
        self.assertTrue(source["url"].startswith("https://www.istat.it/"))
        self.assertIn("almeno un dipendente", source["caveat"])
        self.assertIn("ATECO 2007", source["caveat"])

    def test_validation_fails_on_corrupt_data(self) -> None:
        snapshot = json.loads(OUTPUT_PATH.read_text(encoding="utf-8"))

        # Fails on wrong ATECO version
        corrupted_ateco = dict(snapshot, atecoVersion="ATECO 2025")
        with self.assertRaises(ValueError):
            validate_snapshot(corrupted_ateco)

        # Fails on missing observations
        corrupted_obs = dict(snapshot, observations=snapshot["observations"][:-1])
        with self.assertRaises(ValueError):
            validate_snapshot(corrupted_obs)

        # Fails on corrupt Campania number
        corrupted_campania = json.loads(json.dumps(snapshot))
        for row in corrupted_campania["observations"]:
            if row["geographyCode"] == "15" and row["macroSector"] == "ALL":
                row["value"] = 12345
        with self.assertRaises(ValueError):
            validate_snapshot(corrupted_campania)

        missing_metric = json.loads(json.dumps(snapshot))
        missing_metric["observations"][0].pop("localUnits")
        with self.assertRaisesRegex(ValueError, "localUnits mancante"):
            validate_snapshot(missing_metric)

        broken_region_metric = json.loads(json.dumps(snapshot))
        broken_region_metric["observations"][0]["valueAddedThousandEuro"] += 2
        with self.assertRaisesRegex(ValueError, "valore aggiunto non riconcilia"):
            validate_snapshot(broken_region_metric)

        broken_national_metric = json.loads(json.dumps(snapshot))
        broken_national_metric["national"]["localUnits"] += 1
        with self.assertRaisesRegex(ValueError, "Unità locali nazionali non riconcilia"):
            validate_snapshot(broken_national_metric)


if __name__ == "__main__":
    unittest.main()
