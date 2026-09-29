from __future__ import annotations

import gzip
import json
import sys
import tempfile
from copy import deepcopy
from pathlib import Path
from unittest import TestCase

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts" / "etl"))

import rgs_spesa_statale_regionalizzata_corpus as srs

ASSOLUTI = "Spesa Complessiva - Valori Assoluti (mln)"


def csv_bytes(rows: list[list[str]], trailing: bool = False) -> bytes:
    header = srs.SOURCE_HEADERS + ([""] if trailing else [])
    lines = [";".join(header)] + [";".join(row + ([""] if trailing else [])) for row in rows]
    return ("\r\n".join(lines) + "\r\n").encode("cp1252")


def riga(territorio: str, importo: str, anno: str = "2022", missione: str = "017 - Ricerca e innovazione") -> list[str]:
    return [anno, territorio, "1 - SPESE CORRENTI", "01 - REDDITI DA LAVORO DIPENDENTE", missione, ASSOLUTI, importo]


class SpesaStataleRegionalizzataTests(TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.spec, cls.years = srs.load_slice("2020-2022")
        cls.series = cls.spec["series"]

    def entry(self, **fields) -> dict:
        return {**deepcopy(self.spec["years"][-1]), "trailingEmptyColumn": False, **fields}

    def test_fixtures_match_lock_and_committed_corpus(self) -> None:
        for name in srs.SLICES:
            spec, years = srs.load_slice(name)
            with self.subTest(slice=name):
                payloads = srs.projections(spec, years)
                self.assertEqual(sorted(payloads), [f"rgs-spesa-statale-regionalizzata-{year}" for year in years])
                srs.check_committed(payloads)
                for entry in spec["years"]:
                    lines = payloads[entry["datasetId"]].decode("utf-8").splitlines()
                    self.assertEqual(lines[0].split("|"), srs.HEADERS)
                    self.assertEqual(len(lines) - 1, entry["expected"]["rows"])
                    self.assertTrue(all(line.endswith("|" + entry["url"]) for line in lines[1:]))

    def test_slices_do_not_overlap_and_share_one_series(self) -> None:
        # A year in two locks would be published twice under the same dataset id.
        seen: list[int] = []
        for name in srs.SLICES:
            spec, years = srs.load_slice(name)
            self.assertEqual(spec["series"]["recordId"], srs.RECORD_ID)
            seen.extend(years)
        self.assertEqual(len(seen), len(set(seen)))

    def test_levels_are_labelled_so_overlapping_totals_are_not_summed(self) -> None:
        rows = srs.parse_year(csv_bytes([riga("ITALIA", "3.00"), riga("NORD-OVEST", "3.00"), riga("LOMBARDIA", "3.00")]),
                              self.entry(), self.series)
        body = srs.projection(rows, self.entry()).decode("utf-8").splitlines()[1:]
        self.assertEqual([line.split("|")[2] for line in body], ["Italia", "Ripartizione", "Regione"])

    def test_tampered_source_is_rejected_before_parsing(self) -> None:
        entry = self.spec["years"][0]
        original = gzip.decompress((ROOT / entry["fixture"]).read_bytes())
        tampered = original[:-3] + (b"1" if original[-3:-2] != b"1" else b"2") + original[-2:]
        self.assertNotEqual(tampered, original)
        with tempfile.TemporaryDirectory() as directory:
            (Path(directory) / f"srs-{entry['year']}.csv").write_bytes(tampered)
            with self.assertRaisesRegex(srs.SourceError, "byte sorgente divergenti"):
                srs.verified_source(entry, Path(directory))

    def test_malformed_rows_fail_closed(self) -> None:
        cases = {
            "territorio fuori allowlist": [riga("ESTERO", "1.00")],
            "anno": [riga("ITALIA", "1.00", anno="2021")],
            "importo non conforme": [riga("ITALIA", "1,00")],
            "importo non conforme ": [riga("ITALIA", "-1.00")],
            "separatore del corpus": [riga("ITALIA", "1.00", missione="017 - Ricerca | innovazione")],
        }
        for message, rows in cases.items():
            with self.subTest(message=message), self.assertRaisesRegex(srs.SourceError, message.strip()):
                srs.parse_year(csv_bytes(rows), self.entry(), self.series)

    def test_schema_drift_in_trailing_column_is_rejected(self) -> None:
        with self.assertRaisesRegex(srs.SourceError, "intestazione divergente"):
            srs.parse_year(csv_bytes([riga("ITALIA", "1.00")], trailing=True), self.entry(), self.series)
        payload = csv_bytes([riga("ITALIA", "1.00")], trailing=True).replace(b"1.00;\r\n", b"1.00;x\r\n")
        with self.assertRaisesRegex(srs.SourceError, "colonne divergenti"):
            srs.parse_year(payload, self.entry(trailingEmptyColumn=True), self.series)

    def test_duplicates_and_unreconciled_years_are_rejected(self) -> None:
        duplicated = [riga("ITALIA", "1.00"), riga("ITALIA", "2.00")]
        with self.assertRaisesRegex(srs.SourceError, "combinazioni duplicate"):
            srs.validate_year(duplicated, self.entry())
        # The lock pins every dimension; the ceiling guards a lock that would itself accept a gap.
        rows = [riga("ITALIA", "100.00"), riga("LOMBARDIA", "102.00"), riga("NORD-OVEST", "100.00")]
        observed = {"rows": 3, "territories": 3, "titles": 1, "categories": 1, "missions": 1, "measures": 1,
                    "zeroValues": 0, "reconciliation": srs.reconciliation(rows)}
        self.assertEqual(observed["reconciliation"]["regionDeltaHundredthsMillionEur"], 200)
        with self.assertRaisesRegex(srs.SourceError, "non riconcilia"):
            srs.validate_year(rows, self.entry(expected=observed))
        with self.assertRaisesRegex(srs.SourceError, "divergenti dal lock"):
            srs.validate_year(rows[:2], self.entry(expected=observed))

    def test_contract_rejects_relaxed_license_or_scope(self) -> None:
        for mutate in (
            lambda spec: spec["series"].update(licenseStatus="cc-by"),
            lambda spec: spec["years"].pop(),
            lambda spec: spec["years"][0].update(url="http://example.org/srs.csv"),
        ):
            spec = deepcopy(self.spec)
            mutate(spec)
            with self.subTest(), self.assertRaises(srs.SourceError):
                srs.validate_contract(spec, self.years)
