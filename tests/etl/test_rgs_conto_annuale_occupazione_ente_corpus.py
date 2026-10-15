from __future__ import annotations

import gzip
import sys
import tempfile
from copy import deepcopy
from pathlib import Path
from unittest import TestCase
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts" / "etl"))

import rgs_conto_annuale_occupazione_ente_corpus as ente

TEMPO_PIENO_DONNE = ente.FIRST_MEASURE
TEMPO_DETERMINATO_DONNE = ente.FIRST_MEASURE + 6


def csv_bytes(rows: list[list[str]], *, headers: list[str] | None = None, trailing: bool = True) -> bytes:
    end = ";" if trailing else ""
    lines = [";".join(f'"{cell}"' for cell in (headers or ente.SOURCE_HEADERS))]
    lines += [";".join([*(f'"{cell}"' for cell in row[:13]), *row[13:]]) for row in rows]
    return "".join(f"{line}{end}\r\n" for line in lines).encode("cp1252")


def riga(codice: str = "10", nome: str = "COMUNE DI PROVA", anno: str = "2024", comparto: str = "FUNZIONI LOCALI",
         valori: list[str] | None = None) -> list[str]:
    return [anno, "COMUNI", codice, "123", nome, "FL", comparto, "RALN", "REGIONI ED AUTONOMIE LOCALI",
            "ND", "PERSONALE NON DIRIGENTE", "C0", "CATEGORIA C", *(valori or ["1.00"] * 6 + ["0.50"] * 8)]


class ContoAnnualeOccupazioneEnteTests(TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.spec = ente.load_spec()
        cls.series = cls.spec["series"]
        cls.rows = ente.committed_rows()
        cls.grouped = ente.by_year(cls.rows)
        cls.tent = {entry["year"]: rows for entry, rows in ente.tipologia.parsed_years(ente.tipologia.load_spec())}

    def entry(self, year: int = 2024, **fields) -> dict:
        return {**deepcopy(next(item for item in self.spec["years"] if item["year"] == year)), **fields}

    def test_committed_rows_reproduce_the_locked_projection(self) -> None:
        payloads = ente.projections(self.spec)
        ente.check_committed(payloads)
        self.assertEqual(len(self.rows), 153_121)
        urls = {entry["year"]: entry["url"] for entry in self.spec["years"]}
        # ogni riga cita il file del proprio anno, non quello più recente
        self.assertTrue(all(row[-1] == urls[int(row[0])] for row in self.rows))

    def test_rows_2020_are_recomputed_from_the_committed_fixture(self) -> None:
        rows = ente.aggregate(ente.fixture_2020(), self.entry(2020), self.series)
        self.assertEqual(rows, self.grouped[2020])
        with tempfile.TemporaryDirectory() as directory:
            entry = self.entry(2020)
            (Path(directory) / f"{entry['packageName']}.csv").write_bytes(ente.fixture_2020())
            self.assertEqual(ente.aggregate(ente.verified_source(entry, Path(directory)), entry, self.series), rows)

    def test_every_year_adds_up_to_the_by_type_series(self) -> None:
        for entry in self.spec["years"]:
            with self.subTest(year=entry["year"]):
                ente.validate_year(self.grouped[entry["year"]], self.tent[entry["year"]], entry)
                observed = entry["expected"]
                tent = ente.tipologia.observed_year(self.tent[entry["year"]])
                self.assertEqual(observed["permanent"], tent["permanent"])
                self.assertEqual(observed["types"], tent["types"])
                # dal 2021 i due file coincidono al centesimo, prima entro l'arrotondamento
                worst = observed["typeCrossCheck"]["flexibleMaxAbsDeltaHundredths"]
                self.assertLessEqual(worst, ente.FLEXIBLE_ROUNDING_TOLERANCE[entry["valueFormat"]] * 100)

    def test_one_changed_value_breaks_the_type_cross_check(self) -> None:
        rows = deepcopy(self.grouped[2024])
        rows[0][TEMPO_PIENO_DONNE] = f"{int(rows[0][TEMPO_PIENO_DONNE].split('.')[0]) + 1}.00"
        with self.assertRaisesRegex(ente.SourceError, "personale 2024 di .* non ricalcolabile dal file per ente"):
            ente.validate_year(rows, self.tent[2024], self.entry(2024))

    def test_flexible_work_is_bounded_by_rounding_and_pinned(self) -> None:
        far = deepcopy(self.grouped[2019])
        far[0][TEMPO_DETERMINATO_DONNE] = str(int(far[0][TEMPO_DETERMINATO_DONNE]) + 2 * ente.FLEXIBLE_ROUNDING_TOLERANCE["integer"])
        with self.assertRaisesRegex(ente.SourceError, "fuori tolleranza di arrotondamento"):
            ente.validate_year(far, self.tent[2019], self.entry(2019))
        near = deepcopy(self.grouped[2019])
        near[0][TEMPO_DETERMINATO_DONNE] = str(int(near[0][TEMPO_DETERMINATO_DONNE]) + 1)
        with self.assertRaisesRegex(ente.SourceError, "divergenti dal lock nel 2019"):
            ente.validate_year(near, self.tent[2019], self.entry(2019))
        # dal 2021 nessuna tolleranza: un centesimo basta
        exact = deepcopy(self.grouped[2024])
        exact[0][TEMPO_DETERMINATO_DONNE] = ente.format_value(ente.hundredths(exact[0][TEMPO_DETERMINATO_DONNE]) + 1, "decimal2")
        with self.assertRaisesRegex(ente.SourceError, "fuori tolleranza di arrotondamento: 0.01"):
            ente.validate_year(exact, self.tent[2024], self.entry(2024))

    def test_offsetting_move_between_institutions_is_caught_by_the_projection_lock(self) -> None:
        # Una persona spostata fra due enti dello stesso tipo lascia invariati totali e ricalcolo per tipo.
        rows = deepcopy(self.rows)
        start = next(index for index, row in enumerate(rows) if row[0] == "2024")
        comuni = [row for row in rows[start:] if row[4] == "COMUNI" and ente.hundredths(row[TEMPO_PIENO_DONNE]) > 0]
        comuni[0][TEMPO_PIENO_DONNE] = ente.format_value(ente.hundredths(comuni[0][TEMPO_PIENO_DONNE]) - 100, "decimal2")
        comuni[1][TEMPO_PIENO_DONNE] = ente.format_value(ente.hundredths(comuni[1][TEMPO_PIENO_DONNE]) + 100, "decimal2")
        ente.validate_year(ente.by_year(rows)[2024], self.tent[2024], self.entry(2024))
        with patch.object(ente, "committed_rows", return_value=rows), \
                self.assertRaisesRegex(ente.SourceError, "proiezione divergente dall'impronta del lock"):
            ente.projections(self.spec)

    def test_duplicate_or_unsorted_institutions_are_rejected(self) -> None:
        rows = deepcopy(self.grouped[2024])
        with self.assertRaisesRegex(ente.SourceError, "istituzione duplicata nel 2024"):
            ente.validate_year([rows[0], *rows], self.tent[2024], self.entry(2024))
        with self.assertRaisesRegex(ente.SourceError, "non ordinate per codice"):
            ente.validate_year([rows[1], rows[0], *rows[2:]], self.tent[2024], self.entry(2024))
        with self.assertRaisesRegex(ente.SourceError, "colonne, anno o URL fonte divergenti"):
            ente.validate_year([[*rows[0][:-1], "https://example.org/x.csv"], *rows[1:]], self.tent[2024], self.entry(2024))

    def test_aggregation_sums_categories_and_keeps_identity_constant(self) -> None:
        entry = self.entry(2024, sourceRows=3)
        payload = csv_bytes([
            riga(),
            riga(comparto="SANITA'", valori=["2.00"] * 6 + ["0.25"] * 8),
            riga(codice="9", nome="ALTRO COMUNE"),
        ])
        rows = ente.aggregate(payload, entry, self.series)
        self.assertEqual([row[1] for row in rows], ["9", "10"])
        self.assertEqual(rows[1][5], "FUNZIONI LOCALI / SANITA'")
        self.assertEqual(rows[1][ente.FIRST_MEASURE:ente.FIRST_MEASURE + 14], ["3.00"] * 6 + ["0.75"] * 8)
        renamed = csv_bytes([riga(), riga(nome="COMUNE RINOMINATO"), riga(codice="9")])
        with self.assertRaisesRegex(ente.SourceError, "istituzione 10 con tipo, codice BDAP o denominazione diversi"):
            ente.aggregate(renamed, entry, self.series)
        with self.assertRaisesRegex(ente.SourceError, "righe sorgente divergenti dal lock"):
            ente.aggregate(csv_bytes([riga()]), entry, self.series)

    def test_malformed_rows_fail_closed(self) -> None:
        entry = self.entry(2024, sourceRows=1)
        cases = {
            "anno": riga(anno="2023"),
            "codice, tipo, ente o comparto non conforme": riga(codice="010"),
            "codice, tipo, ente o comparto non conforme ": riga(nome=""),
            "personale non intero o negativo": riga(valori=["1.50"] + ["1.00"] * 5 + ["0.50"] * 8),
            "lavoro flessibile non conforme": riga(valori=["1.00"] * 6 + ["0,50"] + ["0.50"] * 7),
            "separatore del corpus": riga(nome="COMUNE|X"),
        }
        for message, row in cases.items():
            with self.subTest(message=message), self.assertRaisesRegex(ente.SourceError, message.strip()):
                ente.aggregate(csv_bytes([row]), entry, self.series)
        # fino al 2020 i valori sono interi: un decimale è una deriva di formato
        with self.assertRaisesRegex(ente.SourceError, "personale non intero"):
            ente.aggregate(csv_bytes([riga(anno="2020")]), self.entry(2020, sourceRows=1), self.series)

    def test_schema_drift_is_rejected(self) -> None:
        entry = self.entry(2024, sourceRows=1)
        with self.assertRaisesRegex(ente.SourceError, "intestazione divergente"):
            ente.read_rows(csv_bytes([riga()], headers=ente.SOURCE_HEADERS[:-1]), entry, self.series)
        with self.assertRaisesRegex(ente.SourceError, "colonne divergenti"):
            ente.read_rows(csv_bytes([riga()]).replace(b"0.50;\r\n", b"0.50;x\r\n"), entry, self.series)
        with self.assertRaisesRegex(ente.SourceError, "fine riga divergente"):
            ente.read_rows(csv_bytes([riga()]).replace(b"\r\n", b"\n"), entry, self.series)
        # il 2023 non chiude le righe con il separatore: lo stesso formato degli altri anni è una deriva
        entry_2023 = self.entry(2023, sourceRows=1)
        self.assertEqual(len(ente.read_rows(csv_bytes([riga(anno="2023")], trailing=False), entry_2023, self.series)), 1)
        with self.assertRaisesRegex(ente.SourceError, "intestazione divergente"):
            ente.read_rows(csv_bytes([riga(anno="2023")]), entry_2023, self.series)

    def test_source_bytes_are_bound_to_the_lock(self) -> None:
        entry = self.entry(2020)
        original = ente.fixture_2020()
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaisesRegex(ente.SourceError, "CSV originale mancante"):
                ente.verified_source(entry, Path(directory))
            (Path(directory) / f"{entry['packageName']}.csv").write_bytes(original.replace(b";1;", b";2;", 1))
            with self.assertRaisesRegex(ente.SourceError, "byte sorgente divergenti"):
                ente.verified_source(entry, Path(directory))

    def test_package_metadata_is_verified_offline(self) -> None:
        ente.verify_package_metadata(self.spec)
        for mutate in (
            lambda spec: spec["years"][0].update(dataObservedAt="2022-04-20"),
            lambda spec: spec["years"][-1].update(publicationDate="2026-03-19"),
            lambda spec: spec["years"][13].update(bytes=1),
            lambda spec: spec["years"][5].update(title="altro"),
            lambda spec: spec["series"]["license"].update(ckanLicenseId="cc-by-sa"),
        ):
            spec = deepcopy(self.spec)
            mutate(spec)
            with self.subTest(), self.assertRaisesRegex(ente.SourceError, "metadati CKAN divergenti"):
                ente.verify_package_metadata(spec)

    def test_contract_rejects_relaxed_licence_scope_or_identity(self) -> None:
        for mutate in (
            lambda spec: spec["series"].update(licenseStatus="verified-open-cc-by-4.0"),
            lambda spec: spec["series"]["license"].update(url="http://creativecommons.org/licenses/by-sa/3.0"),
            lambda spec: spec["years"].pop(),
            lambda spec: spec["years"][0].update(url="http://example.org/2010.csv"),
            lambda spec: spec["years"][10].update(valueFormat="decimal2"),
            lambda spec: spec["years"][13].pop("trailingSeparator"),
            lambda spec: spec["years"][10].update(sha256="0" * 64),
            lambda spec: spec["dataset"].update(recordId="PCA_OCC_DIP_TENT_001"),
            lambda spec: spec.pop("projection"),
        ):
            spec = deepcopy(self.spec)
            mutate(spec)
            with self.subTest(), self.assertRaises(ente.SourceError):
                ente.validate_contract(spec)

    def test_fixture_is_canonical_gzip(self) -> None:
        compressed = (ROOT / self.spec["ckanSnapshot"]["fixture"]).read_bytes()
        self.assertEqual(compressed[4:8], b"\0\0\0\0")
        self.assertEqual(ente.corpus.canonical_gzip(gzip.decompress(compressed)), compressed)
