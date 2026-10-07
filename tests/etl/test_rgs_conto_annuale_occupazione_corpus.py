from __future__ import annotations

import gzip
import hashlib
import sys
import tempfile
from copy import deepcopy
from pathlib import Path
from unittest import TestCase
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts" / "etl"))

import rgs_conto_annuale_occupazione_corpus as occ

TIPO = "Altre Amministrazioni centrali"


def csv_bytes(rows: list[list[str]], headers: list[str] | None = None) -> bytes:
    lines = [";".join(f'"{cell}"' for cell in (headers or occ.SOURCE_HEADERS))]
    lines += [";".join([f'"{row[0]}"', f'"{row[1]}"', f'"{row[2]}"', *row[3:]]) for row in rows]
    return ("".join(f"{line};\r\n" for line in lines)).encode("cp1252")


def riga(tipo: str = "AGENZIE", anno: str = "2024", valori: list[str] | None = None) -> list[str]:
    return [anno, TIPO, tipo, *(valori or ["1.00"] * 6 + ["0.50"] * 8)]


class ContoAnnualeOccupazioneTests(TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.spec = occ.load_spec()
        cls.series = cls.spec["series"]
        cls.parsed = occ.parsed_years(cls.spec)
        cls.tent_2020 = next(rows for entry, rows in cls.parsed if entry["year"] == 2020)
        cls.ente_2020 = occ.per_administration(cls.spec)
        cls.dfp = occ.dfp_rows()

    def entry(self, year: int = 2024, **fields) -> dict:
        return {**deepcopy(next(item for item in self.spec["years"] if item["year"] == year)), **fields}

    def test_fixtures_reproduce_the_committed_corpus(self) -> None:
        payloads = occ.projections(self.spec)
        occ.check_committed(payloads)
        lines = payloads[occ.DATASET_ID].decode("utf-8").splitlines()
        self.assertEqual(lines[0].split("|"), occ.HEADERS)
        self.assertEqual(len(lines) - 1, 575)
        urls = {entry["year"]: entry["url"] for entry in self.spec["years"]}
        # ogni riga cita il file del proprio anno, non quello più recente
        self.assertTrue(all(line.split("|")[-1] == urls[int(line.split("|")[0])] for line in lines[1:]))

    def test_original_files_pass_the_same_lock(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            for entry in [*self.spec["years"], self.spec["perAdministration2020"]]:
                (Path(directory) / f"{entry['packageName']}.csv").write_bytes(occ.locked_fixture(entry))
            self.assertEqual(occ.projections(self.spec, Path(directory)), occ.projections(self.spec))

    def test_headcount_and_flexible_work_stay_separate(self) -> None:
        # Totali di #586: tipi, tempo pieno, part time, personale, lavoro flessibile (unità annue).
        expected = {
            2010: (35, 3_141_024, 174_323, 3_315_347, 12_182_800),
            2015: (36, 3_076_158, 181_211, 3_257_369, 10_615_600),
            2020: (41, 3_053_043, 190_456, 3_243_499, 10_969_800),
            2023: (44, 3_142_127, 185_727, 3_327_854, 11_254_919),
            2024: (45, 3_203_478, 185_316, 3_388_794, 11_689_045),
        }
        for entry, rows in self.parsed:
            observed = occ.observed_year(rows)
            self.assertEqual(observed["permanent"], observed["fullTime"] + observed["partTime"])
            self.assertEqual(observed["tipologie"], 8)
            if entry["year"] in expected:
                self.assertEqual(
                    tuple(observed[key] for key in ("types", "fullTime", "partTime", "permanent", "flexibleHundredths")),
                    expected[entry["year"]],
                )

    def test_tampered_source_is_rejected_before_parsing(self) -> None:
        entry = self.entry(2015)
        original = occ.locked_fixture(entry)
        tampered = original.replace(b";1", b";2", 1)
        self.assertNotEqual(tampered, original)
        with tempfile.TemporaryDirectory() as directory:
            (Path(directory) / f"{entry['packageName']}.csv").write_bytes(tampered)
            with self.assertRaisesRegex(occ.SourceError, "byte sorgente divergenti"):
                occ.verified_source(entry, Path(directory))

    def test_malformed_rows_fail_closed(self) -> None:
        cases = {
            "anno": [riga(anno="2023")],
            "personale non intero o negativo": [riga(valori=["1.50"] + ["1.00"] * 5 + ["0.50"] * 8)],
            "personale non intero o negativo ": [riga(valori=["-1.00"] + ["1.00"] * 5 + ["0.50"] * 8)],
            "lavoro flessibile non conforme": [riga(valori=["1.00"] * 6 + ["0,50"] + ["0.50"] * 7)],
            "cella vuota": [riga(tipo="")],
            "separatore del corpus": [riga(tipo="AGENZIE|X")],
        }
        for message, rows in cases.items():
            with self.subTest(message=message), self.assertRaisesRegex(occ.SourceError, message.strip()):
                occ.parse_year(csv_bytes(rows), self.entry(), self.series)
        # fino al 2020 i valori sono interi: un decimale è una deriva di formato
        with self.assertRaisesRegex(occ.SourceError, "personale non intero"):
            occ.parse_year(csv_bytes([riga(anno="2020")]), self.entry(2020), self.series)

    def test_format_drift_is_rejected(self) -> None:
        with self.assertRaisesRegex(occ.SourceError, "intestazione divergente"):
            occ.parse_year(csv_bytes([riga()], headers=occ.SOURCE_HEADERS[:-1]), self.entry(), self.series)
        with self.assertRaisesRegex(occ.SourceError, "colonne divergenti"):
            occ.parse_year(csv_bytes([riga()]).replace(b"0.50;\r\n", b"0.50;x\r\n"), self.entry(), self.series)
        with self.assertRaisesRegex(occ.SourceError, "fine riga divergente"):
            occ.parse_year(csv_bytes([riga()]).replace(b"\r\n", b"\n"), self.entry(), self.series)

    def test_duplicates_and_type_count_drift_are_rejected(self) -> None:
        with self.assertRaisesRegex(occ.SourceError, "tipo istituzione duplicato"):
            occ.validate_year([riga(), riga()], self.entry())
        _, rows = self.parsed[-1]
        with self.assertRaisesRegex(occ.SourceError, "divergenti dal lock"):
            occ.validate_year(rows[:-1], self.entry())

    def test_permanent_staff_must_be_recomputable_from_the_per_administration_file(self) -> None:
        lock = self.spec["perAdministration2020"]
        self.assertEqual(occ.recompute_from_administrations(self.ente_2020, self.tent_2020, lock)["types"], 41)
        rows = deepcopy(self.ente_2020)
        rows[100][13] = str(int(rows[100][13]) + 1)
        with self.assertRaisesRegex(occ.SourceError, "non ricalcolabile dal file per ente"):
            occ.recompute_from_administrations(rows, self.tent_2020, lock)

    def test_flexible_work_is_bounded_by_rounding_and_pinned(self) -> None:
        lock = self.spec["perAdministration2020"]
        far = deepcopy(self.ente_2020)
        far[0][19] = str(int(far[0][19]) + 2 * occ.FLEXIBLE_ROUNDING_TOLERANCE + 1)
        with self.assertRaisesRegex(occ.SourceError, "fuori tolleranza di arrotondamento"):
            occ.recompute_from_administrations(far, self.tent_2020, lock)
        near = deepcopy(self.ente_2020)
        near[0][19] = str(int(near[0][19]) + 1)
        with self.assertRaisesRegex(occ.SourceError, "divergente dal lock"):
            occ.recompute_from_administrations(near, self.tent_2020, lock)

    def test_relocked_by_type_file_still_has_to_match_the_per_administration_file(self) -> None:
        # Un 2020 ripubblicato e rivincolato in buona fede (byte e totali nel lock) passa i
        # controlli del file, ma non il ricalcolo dal file per ente: la proiezione si ferma.
        spec = deepcopy(self.spec)
        entry = next(item for item in spec["years"] if item["year"] == 2020)
        lines = occ.locked_fixture(entry).decode("cp1252").split("\r\n")
        cells = lines[1].split(";")
        cells[3] = str(int(cells[3]) + 1)
        lines[1] = ";".join(cells)
        tampered = "\r\n".join(lines).encode("cp1252")
        rows = occ.parse_year(tampered, entry, spec["series"])
        entry.update(bytes=len(tampered), sha256=hashlib.sha256(tampered).hexdigest(), expected=occ.observed_year(rows))
        with tempfile.TemporaryDirectory() as directory:
            for item in [*spec["years"], spec["perAdministration2020"]]:
                (Path(directory) / f"{item['packageName']}.csv").write_bytes(occ.locked_fixture(item))
            (Path(directory) / f"{entry['packageName']}.csv").write_bytes(tampered)
            # anche l'istantanea CKAN sarebbe rinnovata: qui conta solo il ricalcolo
            with patch.object(occ, "verify_package_metadata"),                     self.assertRaisesRegex(occ.SourceError, "non ricalcolabile dal file per ente"):
                occ.projections(spec, Path(directory), check_corpus=False)

    def test_dfp_reconciliation_admits_only_declared_deltas(self) -> None:
        lock = self.spec["dfp2020"]
        observed = occ.reconcile_dfp(self.dfp, self.tent_2020, self.ente_2020, lock)
        self.assertEqual(observed["openbdapPermanent"] - observed["dfpPermanent"], 38)
        self.assertEqual(sum(item["delta"] for item in observed["differingInstitutions"]), 38)

        def changed(predicate, column: str, step: int) -> list[dict[str, str]]:
            rows = deepcopy(self.dfp)
            row = next(row for row in rows if predicate(row))
            row[column] = str(int(row[column]) + step)
            return rows

        comuni = changed(lambda row: row["desc_tipo_istituzione"] == "COMUNI", "part_time_inf50percento_donne", 1)
        with self.assertRaisesRegex(occ.SourceError, "COMUNI, Numero Dipendenti Donne Part time Inf. 50%: -1"):
            occ.reconcile_dfp(comuni, self.tent_2020, self.ente_2020, lock)
        # il delta dichiarato deve restare quello: se DFP si allinea, il lock va rivisto
        aligned = changed(lambda row: row["desc_tipo_istituzione"] == "MINISTERI", "personale_tempo_pieno_uomini", 30)
        with self.assertRaisesRegex(occ.SourceError, "MINISTERI, Numero Dipendenti Uomini Tempo Pieno: \\+0"):
            occ.reconcile_dfp(aligned, self.tent_2020, self.ente_2020, lock)
        without_alias = {**lock, "labelAliases": {}}
        with self.assertRaisesRegex(occ.SourceError, "tipologie 2020 divergenti da DFP"):
            occ.reconcile_dfp(self.dfp, self.tent_2020, self.ente_2020, without_alias)

    def test_dfp_reconciliation_by_administration_catches_offsetting_moves(self) -> None:
        # Una persona spostata fra due enti dello stesso tipo lascia invariati i totali per tipo.
        rows = deepcopy(self.dfp)
        comuni = [row for row in rows if row["desc_tipo_istituzione"] == "COMUNI" and int(row["personale_tempo_pieno_donne"]) > 0]
        first = comuni[0]
        second = next(row for row in comuni if row["codi_istituzione"] != first["codi_istituzione"])
        first["personale_tempo_pieno_donne"] = str(int(first["personale_tempo_pieno_donne"]) - 1)
        second["personale_tempo_pieno_donne"] = str(int(second["personale_tempo_pieno_donne"]) + 1)
        with self.assertRaisesRegex(occ.SourceError, "per amministrazione divergente dal lock"):
            occ.reconcile_dfp(rows, self.tent_2020, self.ente_2020, self.spec["dfp2020"])

    def test_package_metadata_is_verified_offline(self) -> None:
        occ.verify_package_metadata(self.spec)
        for mutate in (
            lambda spec: spec["years"][0].update(dataObservedAt="2022-04-20"),
            lambda spec: spec["years"][-1].update(publicationDate="2026-03-19"),
            lambda spec: spec["perAdministration2020"].update(bytes=1),
            lambda spec: spec["series"]["license"].update(ckanLicenseId="cc-by-sa"),
        ):
            spec = deepcopy(self.spec)
            mutate(spec)
            with self.subTest(), self.assertRaisesRegex(occ.SourceError, "metadati CKAN divergenti"):
                occ.verify_package_metadata(spec)

    def test_contract_rejects_relaxed_licence_scope_or_tolerance(self) -> None:
        for mutate in (
            lambda spec: spec["series"].update(licenseStatus="verified-open-cc-by-4.0"),
            lambda spec: spec["series"]["license"].update(url="http://creativecommons.org/licenses/by-sa/3.0"),
            lambda spec: spec["years"].pop(),
            lambda spec: spec["years"][0].update(url="http://example.org/2010.csv"),
            lambda spec: spec["years"][10].update(valueFormat="decimal2"),
            lambda spec: spec["perAdministration2020"].update(flexibleRoundingTolerance=500),
            lambda spec: spec["dataset"].update(recordId="PCA_OCC_DIP_STOR_001"),
            lambda spec: spec.pop("dfp2020"),
        ):
            spec = deepcopy(self.spec)
            mutate(spec)
            with self.subTest(), self.assertRaises(occ.SourceError):
                occ.validate_contract(spec)

    def test_fixtures_are_canonical_gzip(self) -> None:
        for entry in [*self.spec["years"], self.spec["perAdministration2020"], self.spec["ckanSnapshot"]]:
            compressed = (ROOT / entry["fixture"]).read_bytes()
            self.assertEqual(compressed[4:8], b"\0\0\0\0", entry["fixture"])
            self.assertEqual(occ.corpus.canonical_gzip(gzip.decompress(compressed)), compressed, entry["fixture"])
