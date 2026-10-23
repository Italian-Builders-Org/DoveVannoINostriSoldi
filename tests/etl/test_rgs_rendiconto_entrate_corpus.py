from __future__ import annotations

import gzip
import hashlib
import sys
import tempfile
from copy import deepcopy
from decimal import Decimal
from pathlib import Path
from unittest import TestCase
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts" / "etl"))

import rgs_rendiconto_entrate_corpus as ent

BILLION = Decimal(10) ** 9


def billions(value: Decimal) -> Decimal:
    return (value / BILLION).quantize(Decimal("0.1"))


def relocked(spec: dict, entry: dict, payload: bytes) -> None:
    """A source republished and relocked in good faith: bytes and hash in the lock."""
    entry.update(bytes=len(payload), sha256=hashlib.sha256(payload).hexdigest())


class RendicontoEntrateTests(TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.spec = ent.load_spec()
        cls.series = cls.spec["series"]
        cls.parsed = ent.parsed_years(cls.spec)
        cls.by_year = {entry["year"]: groups for entry, groups in cls.parsed}

    def entry(self, year: int = 2025, **fields) -> dict:
        return {**deepcopy(next(item for item in self.spec["years"] if item["year"] == year)), **fields}

    def source_rows(self, year: int) -> list[list[str]]:
        entry = self.entry(year)
        return ent.read_rows(ent.locked_fixture(entry), entry, self.series)

    def measure(self, groups: list[list[str]], name: str, **where: str) -> Decimal:
        index = ent.HEADERS.index(name) - 1
        return sum(
            (
                Decimal(group[index])
                for group in groups
                if all(group[ent.HEADERS.index(key) - 1] == value for key, value in where.items())
            ),
            Decimal("0.00"),
        )

    def test_fixtures_reproduce_the_committed_corpus(self) -> None:
        payloads = ent.projections(self.spec)
        ent.check_committed(payloads)
        lines = payloads[ent.DATASET_ID].decode("utf-8").splitlines()
        self.assertEqual(lines[0].split("|"), ent.HEADERS)
        self.assertEqual(len(lines) - 1, 310)
        urls = {entry["year"]: entry["url"] for entry in self.spec["years"]}
        # ogni riga cita il file del proprio esercizio, non quello più recente
        self.assertTrue(all(line.split("|")[-1] == urls[int(line.split("|")[0])] for line in lines[1:]))

    def test_original_files_pass_the_same_lock(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            for entry in [*self.spec["years"], self.spec["balances"]]:
                (Path(directory) / f"{entry['packageName']}.csv").write_bytes(ent.locked_fixture(entry))
            self.assertEqual(ent.projections(self.spec, Path(directory)), ent.projections(self.spec))

    def test_title_i_totals_and_tax_types(self) -> None:
        # Totali del Titolo I (miliardi) verificati in #759: accertato e previsioni definitive.
        accertato = {2011: "452.731", 2015: "477.178", 2020: "480.774", 2022: "578.741", 2023: "618.501", 2024: "653.888", 2025: "661.930"}
        for year, expected in accertato.items():
            total = self.measure(self.by_year[year], "Accertato CP")
            self.assertEqual((total / BILLION).quantize(Decimal("0.001")), Decimal(expected), year)
        for year, expected in {2011: "452.261", 2025: "651.975"}.items():
            total = self.measure(self.by_year[year], "Previsioni definitive CP")
            self.assertEqual((total / BILLION).quantize(Decimal("0.001")), Decimal(expected), year)
        # IRPEF, IVA, IRES e sostitutive: codici diversi prima e dopo la ricodifica del 2023;
        # fino al 2022 lo stesso codice di tipologia indica imposte diverse fra natura 1 e 2
        # (5 è l'IVA fra le ricorrenti, i condoni indiretti fra le non ricorrenti).
        y2025, y2015 = self.by_year[2025], self.by_year[2015]
        self.assertEqual(billions(self.measure(y2025, "Accertato CP", **{"Codice tipologia": "11"})), Decimal("242.2"))
        self.assertEqual(billions(self.measure(y2025, "Accertato CP", **{"Codice tipologia": "21"})), Decimal("206.5"))
        self.assertEqual(billions(self.measure(y2025, "Accertato CP", **{"Codice tipologia": "12"})), Decimal("65.1"))
        # le sostitutive sommano entrate ricorrenti e non ricorrenti
        self.assertEqual(billions(self.measure(y2025, "Accertato CP", **{"Codice tipologia": "13"})), Decimal("50.9"))
        irpef_2015 = {"Codice natura": "1", "Codice tipologia": "1"}
        self.assertEqual(billions(self.measure(y2015, "Accertato CP", **irpef_2015)), Decimal("187.6"))
        self.assertEqual(billions(self.measure(y2015, "Accertato CP", **{"Codice natura": "1", "Codice tipologia": "5"})), Decimal("139.1"))
        self.assertEqual(billions(self.measure(y2015, "Accertato CP", **{"Codice tipologia": "2", "Codice natura": "1"})), Decimal("41.0"))

    def test_identities_hold_on_the_projected_rows(self) -> None:
        for year, groups in self.by_year.items():
            for group in groups:
                value = {name: Decimal(group[ent.HEADERS.index(name) - 1]) for name, _ in ent.MEASURES}
                self.assertEqual(
                    value["Accertato CP"],
                    value["Versato CP"] + value["Rimasto da versare CP"] + value["Rimasto da riscuotere CP"],
                    year,
                )
                self.assertEqual(value["Versato CS"], value["Versato RS"] + value["Versato CP"], year)

    def test_borrowing_and_other_titles_stay_out(self) -> None:
        rows = self.source_rows(2025)
        titles = {row[ent.COLUMN["Codice Titolo"]] for row in rows}
        self.assertTrue({"2", "3", "4"} <= titles)
        title_i = sum(1 for row in rows if row[ent.COLUMN["Codice Titolo"]] == "1")
        self.assertEqual(sum(int(group[len(ent.KEY_HEADERS)]) for group in self.by_year[2025]), title_i)

    def test_tampered_source_is_rejected_before_parsing(self) -> None:
        entry = self.entry(2015)
        original = ent.locked_fixture(entry)
        tampered = original.replace(b".00", b".01", 1)
        self.assertNotEqual(tampered, original)
        with tempfile.TemporaryDirectory() as directory:
            (Path(directory) / f"{entry['packageName']}.csv").write_bytes(tampered)
            with self.assertRaisesRegex(ent.SourceError, "byte sorgente divergenti"):
                ent.verified_source(entry, Path(directory))

    def test_assessed_must_equal_paid_plus_outstanding_to_the_cent(self) -> None:
        rows = deepcopy(self.source_rows(2020))
        row = next(row for row in rows if Decimal(row[ent.COLUMN["Versato CP"]]) > 0)
        row[ent.COLUMN["Versato CP"]] = str(Decimal(row[ent.COLUMN["Versato CP"]]) + Decimal("0.01"))
        with self.assertRaisesRegex(ent.SourceError, "Totale CP diverso da"):
            ent.check_identities(rows, "test")
        # lo stesso vale per una riga fuori dal Titolo I: il controllo copre l'intero file
        rows = deepcopy(self.source_rows(2020))
        row = next(row for row in rows if row[ent.COLUMN["Codice Titolo"]] == "2" and Decimal(row[ent.COLUMN["Totale RS"]]) > 0)
        row[ent.COLUMN["Totale RS"]] = str(Decimal(row[ent.COLUMN["Totale RS"]]) - Decimal("0.01"))
        with self.assertRaisesRegex(ent.SourceError, "Totale RS diverso da"):
            ent.check_identities(rows, "test")

    def test_relocked_file_breaking_an_identity_still_fails(self) -> None:
        # Un esercizio ripubblicato e rivincolato (byte nel lock) con un articolo incoerente
        # passa il lock dei byte ma non le identità contabili.
        spec = deepcopy(self.spec)
        entry = next(item for item in spec["years"] if item["year"] == 2018)
        text = ent.locked_fixture(entry).decode("cp1252")
        lines = text.split("\r\n")
        index = next(i for i, line in enumerate(lines[1:], start=1) if '"TITOLO I - ENTRATE TRIBUTARIE"' in line and ';"0.00";' not in line[-40:])
        cells = lines[index].split(";")
        versato_cp = ent.COLUMN["Versato CP"]
        cells[versato_cp] = '"' + str(Decimal(cells[versato_cp].strip('"')) + 1) + '"'
        lines[index] = ";".join(cells)
        tampered = "\r\n".join(lines).encode("cp1252")
        relocked(spec, entry, tampered)
        with tempfile.TemporaryDirectory() as directory:
            for item in [*spec["years"], spec["balances"]]:
                (Path(directory) / f"{item['packageName']}.csv").write_bytes(ent.locked_fixture(item))
            (Path(directory) / f"{entry['packageName']}.csv").write_bytes(tampered)
            with patch.object(ent, "verify_package_metadata"), self.assertRaisesRegex(ent.SourceError, "Totale CP diverso da"):
                ent.projections(spec, Path(directory), check_corpus=False)

    def test_forecasts_must_match_the_balances_file(self) -> None:
        balances = ent.balances_by_year(ent.locked_fixture(self.spec["balances"]), self.spec)
        gaps = ent.reconcile_balances(self.parsed, balances)
        self.assertEqual(sorted(gaps), list(ent.YEARS))
        self.assertTrue(all(gap == 0 for gap in gaps.values()))
        shifted = {**balances, 2020: balances[2020] + Decimal("0.01")}
        with self.assertRaisesRegex(ent.SourceError, "esercizio 2020: previsioni definitive del Titolo I"):
            ent.reconcile_balances(self.parsed, shifted)

    def test_relocked_balances_file_still_has_to_reconcile(self) -> None:
        spec = deepcopy(self.spec)
        lock = spec["balances"]
        original = ent.locked_fixture(lock)
        # entrate tributarie 2025 aumentate di un euro, file rivincolato
        tampered = original.replace(b";651975240057.00;", b";651975240058.00;", 1)
        self.assertNotEqual(tampered, original)
        relocked(spec, lock, tampered)
        with tempfile.TemporaryDirectory() as directory:
            for item in spec["years"]:
                (Path(directory) / f"{item['packageName']}.csv").write_bytes(ent.locked_fixture(item))
            (Path(directory) / f"{lock['packageName']}.csv").write_bytes(tampered)
            with patch.object(ent, "verify_package_metadata"), self.assertRaisesRegex(ent.SourceError, "esercizio 2025"):
                ent.projections(spec, Path(directory), check_corpus=False)

    def test_balances_format_drift_is_rejected(self) -> None:
        original = ent.locked_fixture(self.spec["balances"])
        cases = {
            "intestazione del file dei saldi": original.replace(b'"ENTRATE_TRIBUTARIE"', b'"ENTRATE_TRIBUTARIE_PREV"', 1),
            "importo non conforme": original.replace(b";651975240057.00;", b";651975240057,00;", 1),
            "anni del file dei saldi": original[: original.rindex(b'"2025"')],
        }
        for message, payload in cases.items():
            with self.subTest(message=message), self.assertRaisesRegex(ent.SourceError, message):
                ent.balances_by_year(payload, self.spec)

    def test_format_drift_is_rejected(self) -> None:
        entry = self.entry(2025)
        original = ent.locked_fixture(entry)
        cases = {
            "intestazione divergente": original.replace(b'"Totale CP"', b'"Totale Competenza"', 1),
            "fine riga divergente": original.replace(b"\r\n", b"\n"),
            "colonne divergenti": original[:-2] + b';"x"\r\n',
            "importo non conforme": original.replace(b'"0.00"', b'"0,00"', 1),
            "esercizio '2024'": original.replace(b'\r\n"2025";', b'\r\n"2024";', 1),
        }
        for message, payload in cases.items():
            with self.subTest(message=message), self.assertRaisesRegex(ent.SourceError, message):
                ent.read_rows(payload, entry, self.series)
        # fino al 2023 le righe terminano con il separatore: un cambio di formato non passa
        with self.assertRaisesRegex(ent.SourceError, "intestazione divergente"):
            ent.read_rows(original, self.entry(2025, trailingSeparator=True), self.series)
        with self.assertRaisesRegex(ent.SourceError, "intestazione divergente"):
            ent.read_rows(ent.locked_fixture(self.entry(2011)), self.entry(2011, trailingSeparator=False), self.series)

    def test_inconsistent_labels_fail_closed(self) -> None:
        rows = self.source_rows(2025)
        title_i = [index for index, row in enumerate(rows) if row[ent.COLUMN["Codice Titolo"]] == "1"]
        cases = {
            "etichette divergenti per lo stesso codice": ("Tipologia", "Imposta sul reddito"),
            "separatore del corpus": ("Tipologia", "IVA|X"),
            "codice di natura, categoria o tipologia": ("Codice Tipologia", "11a"),
            "etichetta del Titolo I": ("Titolo", "TITOLO I"),
        }
        for message, (column, value) in cases.items():
            mutated = deepcopy(rows)
            mutated[title_i[1]][ent.COLUMN[column]] = value
            if message == "etichette divergenti per lo stesso codice":
                # stessa chiave di un'altra riga, etichetta diversa
                first = mutated[title_i[0]]
                for name in ("Codice Natura", "Codice Categoria", "Codice Tipologia"):
                    mutated[title_i[1]][ent.COLUMN[name]] = first[ent.COLUMN[name]]
            with self.subTest(message=message), self.assertRaisesRegex(ent.SourceError, message):
                ent.aggregate(mutated, "test")

    def test_lock_totals_and_counts_are_pinned(self) -> None:
        entry = self.entry(2023)
        payload = ent.locked_fixture(entry)
        ent.parse_year(payload, entry, self.series)
        for mutate in (
            lambda item: item["expected"].update(groups=17),
            lambda item: item["expected"]["titleITotals"].update({"Accertato CP": "618500000000.00"}),
            lambda item: item["expected"].update(rows=2003),
        ):
            changed = deepcopy(entry)
            mutate(changed)
            with self.subTest(), self.assertRaisesRegex(ent.SourceError, "divergenti dal lock"):
                ent.parse_year(payload, changed, self.series)

    def test_package_metadata_is_verified_offline(self) -> None:
        ent.verify_package_metadata(self.spec)
        for mutate in (
            lambda spec: spec["years"][-1].update(publicationDate="2026-05-29"),
            lambda spec: spec["years"][0].update(title="2012 - Rendiconto Pubblicato Elaborabile Entrate Articolo"),
            lambda spec: spec["balances"].update(bytes=1),
            lambda spec: spec["balances"].update(recordId="RND_SAL_CRU_ESERC_002"),
            lambda spec: spec["series"]["license"].update(ckanLicenseId="cc-by-sa"),
        ):
            spec = deepcopy(self.spec)
            mutate(spec)
            with self.subTest(), self.assertRaisesRegex(ent.SourceError, "metadati CKAN divergenti"):
                ent.verify_package_metadata(spec)

    def test_contract_rejects_relaxed_licence_or_scope(self) -> None:
        for mutate in (
            lambda spec: spec["series"].update(licenseStatus="verified-open-cc-by-4.0"),
            lambda spec: spec["series"]["license"].update(url="http://creativecommons.org/licenses/by-sa/3.0"),
            lambda spec: spec["series"].update(titleCode="4"),
            lambda spec: spec["years"].pop(),
            lambda spec: spec["years"][0].update(url="http://example.org/2011.csv"),
            lambda spec: spec["years"][3].pop("trailingSeparator"),
            lambda spec: spec["balances"].update(column="ENTRATE_FINALI"),
            lambda spec: spec["dataset"].update(recordId="RND_SPE_ELB_CAP_001"),
        ):
            spec = deepcopy(self.spec)
            mutate(spec)
            with self.subTest(), self.assertRaises(ent.SourceError):
                ent.validate_contract(spec)

    def test_fixtures_are_canonical_gzip(self) -> None:
        for entry in [*self.spec["years"], self.spec["balances"], self.spec["ckanSnapshot"]]:
            compressed = (ROOT / entry["fixture"]).read_bytes()
            self.assertEqual(compressed[4:8], b"\0\0\0\0", entry["fixture"])
            self.assertEqual(ent.corpus.canonical_gzip(gzip.decompress(compressed)), compressed, entry["fixture"])
