from __future__ import annotations

import hashlib
import sys
import tempfile
from copy import deepcopy
from decimal import Decimal
from pathlib import Path
from unittest import TestCase

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts" / "etl"))

import rgs_spesa_regionalizzata_consolidata_corpus as srs

ASSOLUTI = "Spesa Complessiva - Valori Assoluti (mln)"


def csv_bytes(rows: list[list[str]], trailing: bool = False) -> bytes:
    header = srs.SOURCE_HEADERS + ([""] if trailing else [])
    lines = [";".join(header)] + [";".join(row + ([""] if trailing else [])) for row in rows]
    return ("\r\n".join(lines) + "\r\n").encode("cp1252")


def riga(territorio: str, importo: str, anno: str = "2023", misura: str = ASSOLUTI) -> list[str]:
    return [anno, territorio, misura, importo]


class SpesaRegionalizzataConsolidataTests(TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.spec = srs.load_spec()
        cls.series = cls.spec["series"]
        cls.parsed = srs.parsed_series(cls.spec)
        cls.components = srs.components_of(cls.parsed)
        cls.bilancio = srs.bilancio_totals()

    def entry(self, **fields) -> dict:
        return {**deepcopy(self.spec["datasets"]["enti"]["years"][-1]), "trailingEmptyColumn": False, **fields}

    def test_fixtures_match_lock_and_committed_corpus(self) -> None:
        payloads = srs.projections(self.spec)
        self.assertEqual(sorted(payloads), sorted(dataset_id for _, dataset_id, _ in srs.SERIES.values()))
        srs.bilancio.check_committed(payloads)
        for key, dataset in self.spec["datasets"].items():
            lines = payloads[dataset["datasetId"]].decode("utf-8").splitlines()
            self.assertEqual(lines[0].split("|"), srs.HEADERS)
            self.assertEqual(len(lines) - 1, 16 * 104, key)
            urls = {entry["year"]: entry["url"] for entry in dataset["years"]}
            # ogni riga cita il file del proprio anno, non quello della serie
            self.assertTrue(all(line.split("|")[-1] == urls[int(line.split("|")[0])] for line in lines[1:]))

    def test_identity_holds_for_every_year_and_territory(self) -> None:
        observed = srs.check_identity(self.components, self.bilancio, self.spec["identity"])
        self.assertEqual(max(item["maxAbsResidualHundredthsMillionEur"] for item in observed), 13)
        # Totali nazionali di #728 (milioni di euro): Bilancio 2008 e 2023, Consolidata 2015 e 2020.
        self.assertEqual(self.bilancio[2008]["ITALIA"], 24_151_558)
        self.assertEqual(self.bilancio[2023]["ITALIA"], 29_735_168)
        self.assertEqual(self.components["consolidata"][2015]["ITALIA"], 56_510_561)
        self.assertEqual(self.components["consolidata"][2020]["ITALIA"], 68_884_288)
        self.assertEqual(self.components["fondi"][2023]["ITALIA"], 6_897_441)

    def test_identity_breaks_fail_closed(self) -> None:
        # oltre il doppio della soglia: esce dalla tolleranza qualunque sia lo scarto di partenza
        step = 2 * self.spec["identity"]["toleranceHundredthsMillionEur"] + 1
        cases = {
            "enti": lambda components, bilancio: components["enti"][2015].__setitem__(
                "LAZIO", components["enti"][2015]["LAZIO"] + step),
            "consolidata": lambda components, bilancio: components["consolidata"][2023].__setitem__(
                "ITALIA", components["consolidata"][2023]["ITALIA"] - step),
            "bilancio": lambda components, bilancio: bilancio[2010].__setitem__(
                "SUD", bilancio[2010]["SUD"] + step),
        }
        for name, mutate in cases.items():
            components, bilancio = deepcopy(self.components), deepcopy(self.bilancio)
            mutate(components, bilancio)
            with self.subTest(perturbazione=name), self.assertRaisesRegex(srs.SourceError, "fuori tolleranza"):
                srs.check_identity(components, bilancio, self.spec["identity"])

    def test_identity_drift_within_tolerance_still_diverges_from_lock(self) -> None:
        components = deepcopy(self.components)
        components["fondi"][2017]["MOLISE"] += 1
        with self.assertRaisesRegex(srs.SourceError, "divergente dal lock"):
            srs.check_identity(components, self.bilancio, self.spec["identity"])

    def test_identity_requires_every_territory_in_every_source(self) -> None:
        bilancio = deepcopy(self.bilancio)
        del bilancio[2019]["UMBRIA"]
        with self.assertRaisesRegex(srs.SourceError, "copertura territoriale incompleta"):
            srs.check_identity(self.components, bilancio, self.spec["identity"])
        components = deepcopy(self.components)
        del components["fondi"][2012]
        with self.assertRaisesRegex(srs.SourceError, "copertura territoriale incompleta"):
            srs.check_identity(components, self.bilancio, self.spec["identity"])

    def test_relocked_source_that_breaks_the_identity_stops_the_projection(self) -> None:
        # Un file ripubblicato e rivincolato in buona fede passa lock e riconciliazione
        # interna (Italia, Lazio e Centro crescono insieme di un milione), ma non
        # l'identità con le altre serie: la proiezione si ferma comunque.
        spec = deepcopy(self.spec)
        entry = next(item for item in spec["datasets"]["enti"]["years"] if item["year"] == 2015)
        original = srs.verified_source(entry)
        lines = original.decode("cp1252").split("\r\n")
        changed = 0
        for index, line in enumerate(lines):
            cells = line.split(";")
            if len(cells) > 3 and cells[1] in {'"ITALIA"', '"LAZIO"', '"CENTRO"'} and cells[2] == f'"{ASSOLUTI}"':
                cells[3] = str(Decimal(cells[3]) + 1)
                lines[index] = ";".join(cells)
                changed += 1
        self.assertEqual(changed, 3)
        tampered = "\r\n".join(lines).encode("cp1252")
        with tempfile.TemporaryDirectory() as directory:
            for key in srs.SERIES:
                for item in spec["datasets"][key]["years"]:
                    (Path(directory) / f"{item['packageName']}.csv").write_bytes(srs.verified_source(item))
            (Path(directory) / f"{entry['packageName']}.csv").write_bytes(tampered)
            rows = srs.parse_year(tampered, entry, spec["series"])
            entry.update(bytes=len(tampered), sha256=hashlib.sha256(tampered).hexdigest())
            entry["expected"]["reconciliation"] = srs.reconciliation(srs.absolute_totals(rows))
            srs.validate_year(rows, entry)
            with self.assertRaisesRegex(srs.SourceError, "fuori tolleranza nel 2015"):
                srs.projections(spec, Path(directory), check_corpus=False)

    def test_tampered_source_is_rejected_before_parsing(self) -> None:
        entry = self.spec["datasets"]["fondi"]["years"][0]
        original = srs.verified_source(entry)
        tampered = original[:-4] + (b"1" if original[-4:-3] != b"1" else b"2") + original[-3:]
        self.assertNotEqual(tampered, original)
        with tempfile.TemporaryDirectory() as directory:
            (Path(directory) / f"{entry['packageName']}.csv").write_bytes(tampered)
            with self.assertRaisesRegex(srs.SourceError, "byte sorgente divergenti"):
                srs.verified_source(entry, Path(directory))

    def test_malformed_rows_fail_closed(self) -> None:
        cases = {
            "territorio fuori allowlist": [riga("ESTERO", "1.00")],
            "anno": [riga("ITALIA", "1.00", anno="2022")],
            "misura sconosciuta": [riga("ITALIA", "1.00", misura="Spesa Complessiva - Valori Relativi")],
            "importo non conforme": [riga("ITALIA", "1,00")],
            "importo non conforme ": [riga("ITALIA", "-1.00")],
        }
        for message, rows in cases.items():
            with self.subTest(message=message), self.assertRaisesRegex(srs.SourceError, message.strip()):
                srs.parse_year(csv_bytes(rows), self.entry(), self.series)

    def test_format_drift_is_rejected(self) -> None:
        with self.assertRaisesRegex(srs.SourceError, "intestazione divergente"):
            srs.parse_year(csv_bytes([riga("ITALIA", "1.00")], trailing=True), self.entry(), self.series)
        payload = csv_bytes([riga("ITALIA", "1.00")], trailing=True).replace(b"1.00;\r\n", b"1.00;x\r\n")
        with self.assertRaisesRegex(srs.SourceError, "colonne divergenti"):
            srs.parse_year(payload, self.entry(trailingEmptyColumn=True), self.series)
        with self.assertRaisesRegex(srs.SourceError, "fine riga divergente"):
            srs.parse_year(csv_bytes([riga("ITALIA", "1.00")]).replace(b"\r\n", b"\n"), self.entry(), self.series)

    def test_duplicates_and_unreconciled_years_are_rejected(self) -> None:
        with self.assertRaisesRegex(srs.SourceError, "combinazioni duplicate"):
            srs.validate_year([riga("ITALIA", "1.00"), riga("ITALIA", "2.00")], self.entry())
        _, rows = self.parsed["enti"][-1]
        rows = deepcopy(rows)
        lombardia = next(row for row in rows if row[1] == "LOMBARDIA" and row[2] == ASSOLUTI)
        lombardia[3] = str(Decimal(lombardia[3]) + 1)
        observed = srs.reconciliation(srs.absolute_totals(rows))
        self.assertEqual(observed["regionDeltaHundredthsMillionEur"], 100 + self.entry()["expected"]["reconciliation"]["regionDeltaHundredthsMillionEur"])
        relocked = self.entry(expected={**self.entry()["expected"], "reconciliation": observed})
        with self.assertRaisesRegex(srs.SourceError, "non riconcilia"):
            srs.validate_year(rows, relocked)
        with self.assertRaisesRegex(srs.SourceError, "divergenti dal lock"):
            srs.validate_year(rows[:-1], relocked)

    def test_contract_rejects_relaxed_tolerance_license_or_scope(self) -> None:
        for mutate in (
            lambda spec: spec["identity"].update(toleranceHundredthsMillionEur=50),
            lambda spec: spec["series"].update(licenseStatus="cc-by"),
            lambda spec: spec["datasets"]["fondi"]["years"].pop(),
            lambda spec: spec["datasets"]["enti"]["years"][0].update(url="http://example.org/spent.csv"),
            lambda spec: spec["datasets"]["consolidata"]["years"][3].update(reconciliationCeilingHundredths=100),
            lambda spec: spec["datasets"]["enti"].update(recordId="SRS_SPE_BIL_SPESR_001"),
            lambda spec: spec["datasets"].pop("fondi"),
        ):
            spec = deepcopy(self.spec)
            mutate(spec)
            with self.subTest(), self.assertRaises(srs.SourceError):
                srs.validate_contract(spec)
