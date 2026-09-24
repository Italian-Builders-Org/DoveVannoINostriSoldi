from __future__ import annotations

import csv
import hashlib
import io
import json
import sys
import tempfile
from copy import deepcopy
from pathlib import Path
from unittest import TestCase
from zipfile import ZIP_DEFLATED, ZipFile

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts" / "etl"))

import mef_patrimonio_immobiliare as mef

ROMA = {
    "Amministrazione Codice Fiscale": "[02438750586]",
    "Amministrazione Denominazione": "COMUNE DI ROMA CAPITALE (RM)",
    "Tipologia Amministrazione": "Comuni",
    "Regione (Amministrazione)": "LAZIO",
    "Provincia (Amministrazione)": "ROMA",
    "Comune (Amministrazione)": "Roma",
    "Cod. Comune (Amministrazione)": "H501",
}


def bene(id_bene: str, **fields: str) -> dict[str, str]:
    return {**ROMA, "ID bene": id_bene, "Titolo proprietà": "Proprietà", "Titolo detenzione": "",
            "Utilizzo del bene": "Non utilizzato", "Tipologia Bene Immobile": "Abitazione",
            "Superficie di Riferimento (mq)": "70,5", "Regione del bene": "LAZIO",
            "Comune del bene": "Roma", "Codice Comune del bene": "H501",
            "ui data interamente a terzi": "No", "ui data parzialmente a terzi": "No", **fields}


def contratto(id_variazione: str, **fields: str) -> dict[str, str]:
    return {**ROMA, "ID variazione": id_variazione, "Tipo detenzione a terzi": "in locazione",
            "Detenzione Intera UI": "Sì", "Finalità PF": "Edilizia residenziale pubblica",
            "Tipologia Bene Immobile": "Abitazione", "Canone annuale": "1200",
            "Superficie di Riferimento (mq)": "60", **fields}


class MefPatrimonioImmobiliareTests(TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.spec = json.loads(mef.SPEC.read_text(encoding="utf-8"))

    def setUp(self) -> None:
        self.directory = tempfile.TemporaryDirectory()
        self.input_dir = Path(self.directory.name)

    def tearDown(self) -> None:
        self.directory.cleanup()

    def archive(self, kind: str, rows: list[dict[str, str]], name: str | None = None) -> dict:
        headers = self.spec["csv"]["headers"][kind]
        text = io.StringIO(newline="")
        writer = csv.writer(text, delimiter=";", lineterminator="\r\n")
        writer.writerow(headers)
        writer.writerows([[row.get(header, "") for header in headers] for row in rows])
        member = f"{kind}.csv"
        buffer = io.BytesIO()
        with ZipFile(buffer, "w", ZIP_DEFLATED) as archive:
            archive.writestr(member, text.getvalue().encode("cp1252"))
        payload = buffer.getvalue()
        name = name or f"{kind}.zip"
        (self.input_dir / name).write_bytes(payload)
        return {"kind": kind, "perimeter": "comuni", "file": name,
                "url": f"https://www.de.mef.gov.it/modules/documenti_it/attivo_patrimonio/immobili_2023/{name}",
                "bytes": len(payload), "sha256": hashlib.sha256(payload).hexdigest(), "member": member, "rows": len(rows)}

    def synthetic_spec(self, beni: list[dict[str, str]], contratti: list[dict[str, str]], duplicates: int = 0) -> dict:
        spec = deepcopy(self.spec)
        spec["files"] = [self.archive("immobili", beni), self.archive("detenzioni", contratti)]
        spec["expected"] = {"immobiliRows": len(beni), "detenzioniRows": len(contratti), "immobiliExactDuplicateRows": duplicates}
        return spec

    def project(self, spec: dict) -> tuple[list[dict[str, str]], list[dict[str, str]]]:
        parse = lambda body: list(csv.DictReader(io.StringIO(body.decode("utf-8")), delimiter="|"))
        return (parse(mef.beni_projection(spec, self.input_dir, {})),
                parse(mef.contratti_projection(spec, self.input_dir, {})))

    def test_aggregates_beni_by_title_and_keeps_empty_use_distinct(self) -> None:
        spec = self.synthetic_spec(
            [
                bene("1"),
                bene("2", **{"Superficie di Riferimento (mq)": "29,5"}),
                bene("3", **{"Superficie di Riferimento (mq)": ""}),
                bene("4", **{"Utilizzo del bene": ""}),
                bene("5", **{"Titolo proprietà": "", "Titolo detenzione": "in uso gratuito"}),
            ],
            [contratto("10")],
        )
        beni, _ = self.project(spec)
        by_key = {(row["Titolo"], row["Utilizzo del bene"]): row for row in beni}
        self.assertEqual(set(by_key), {("Proprietà", "Non utilizzato"), ("Proprietà", "Non indicato"), ("in uso gratuito", "Non utilizzato")})
        vuoti = by_key[("Proprietà", "Non utilizzato")]
        self.assertEqual((vuoti["Beni"], vuoti["Beni con superficie"], vuoti["Superficie di riferimento (m²)"]), ("3", "2", "100.0"))
        self.assertEqual(vuoti["Codice fiscale ente"], "02438750586")
        self.assertEqual(sum(int(row["Beni"]) for row in beni), 5)

    def test_beni_are_split_by_location_of_the_asset_not_of_the_entity(self) -> None:
        spec = self.synthetic_spec(
            [bene("1"), bene("2", **{"Comune del bene": "Guidonia Montecelio", "Codice Comune del bene": "E263"})],
            [contratto("10")],
        )
        beni, _ = self.project(spec)
        self.assertEqual(
            sorted((row["Codice catastale comune del bene"], row["Comune ente"], row["Beni"]) for row in beni),
            [("E263", "Roma", "1"), ("H501", "Roma", "1")],
        )
        self.assertEqual(list(beni[0])[:3], ["Codice fiscale ente", "Ente", "Titolo"])

    def test_third_party_flags_explain_empty_use_and_unknown_combinations_fail(self) -> None:
        spec = self.synthetic_spec(
            [
                bene("1", **{"Utilizzo del bene": "", "ui data interamente a terzi": "Sì"}),
                bene("2", **{"Utilizzo del bene": "", "ui data interamente a terzi": "", "ui data parzialmente a terzi": ""}),
                bene("3", **{"ui data parzialmente a terzi": "Sì"}),
            ],
            [contratto("10")],
        )
        beni, _ = self.project(spec)
        self.assertEqual(
            sorted((row["Utilizzo del bene"], row["Dato a terzi"]) for row in beni),
            [("Non indicato", "Interamente"), ("Non indicato", "Non indicato"), ("Non utilizzato", "Parzialmente")],
        )
        spec = self.synthetic_spec([bene("1", **{"ui data interamente a terzi": ""})], [contratto("10")])
        with self.assertRaisesRegex(mef.SourceError, "dato a terzi"):
            mef.beni_projection(spec, self.input_dir, {})

    def test_contracts_split_empty_zero_and_positive_rent_and_restrict_ratio(self) -> None:
        spec = self.synthetic_spec(
            [bene("1")],
            [
                contratto("10"),
                contratto("11", **{"Canone annuale": "0"}),
                contratto("12", **{"Canone annuale": ""}),
                contratto("13", **{"Detenzione Intera UI": "No", "Canone annuale": "600"}),
                contratto("14", **{"Superficie di Riferimento (mq)": "", "Canone annuale": "300"}),
            ],
        )
        _, contratti = self.project(spec)
        self.assertEqual(len(contratti), 1)
        row = contratti[0]
        self.assertEqual(
            [row[key] for key in ("Contratti", "Contratti su intera unità", "Contratti con canone positivo",
                                  "Contratti con canone zero", "Contratti senza canone", "Canone annuo totale (EUR)")],
            ["5", "4", "3", "1", "1", "2100"],
        )
        self.assertEqual(
            [row[key] for key in ("Contratti per rapporto canone/superficie", "Canone annuo per rapporto (EUR)", "Superficie per rapporto (m²)")],
            ["1", "1200", "60"],
        )

    def test_counts_exact_duplicate_rows_without_dropping_them(self) -> None:
        spec = self.synthetic_spec([bene("1"), bene("1")], [contratto("10")], duplicates=1)
        beni, _ = self.project(spec)
        self.assertEqual(beni[0]["Beni"], "2")
        spec["expected"]["immobiliExactDuplicateRows"] = 0
        with self.assertRaisesRegex(mef.SourceError, "righe identiche"):
            mef.beni_projection(spec, self.input_dir, {})

    def test_rejects_tampered_bytes_headers_and_row_counts(self) -> None:
        spec = self.synthetic_spec([bene("1")], [contratto("10")])
        tampered = deepcopy(spec)
        tampered["files"][0]["sha256"] = "0" * 64
        with self.assertRaisesRegex(mef.SourceError, "byte sorgente"):
            mef.beni_projection(tampered, self.input_dir, {})
        tampered = deepcopy(spec)
        tampered["files"][0]["rows"] = 2
        with self.assertRaisesRegex(mef.SourceError, "righe divergenti"):
            mef.beni_projection(tampered, self.input_dir, {})
        tampered = deepcopy(spec)
        tampered["csv"]["headers"]["immobili"] = list(reversed(tampered["csv"]["headers"]["immobili"]))
        with self.assertRaisesRegex(mef.SourceError, "header divergenti"):
            mef.beni_projection(tampered, self.input_dir, {})

    def test_rejects_values_outside_the_reviewed_domains(self) -> None:
        cases = [
            ([bene("1", **{"Utilizzo del bene": "Abbandonato"})], [contratto("10")], "utilizzo fuori dominio"),
            ([bene("1", **{"Titolo detenzione": "in locazione"})], [contratto("10")], "titolo del bene"),
            ([bene("1", **{"Superficie di Riferimento (mq)": "1.200,5"})], [contratto("10")], "superficie non valida"),
            ([bene("1", **{"Amministrazione Codice Fiscale": "02438750586"})], [contratto("10")], "codice fiscale"),
            ([bene("1", **{"Tipologia Amministrazione": "Regioni"})], [contratto("10")], "fuori perimetro"),
            ([bene("1"), bene("2", **{"Amministrazione Denominazione": "ROMA"})], [contratto("10")], "anagrafica ente"),
        ]
        for beni, contratti, message in cases:
            with self.subTest(message=message):
                with self.assertRaisesRegex(mef.SourceError, message):
                    mef.beni_projection(self.synthetic_spec(beni, contratti), self.input_dir, {})
        for raw in ("-5", "1.200", "12,50", " 10"):
            with self.subTest(canone=raw):
                spec = self.synthetic_spec([bene("1")], [contratto("10", **{"Canone annuale": raw})])
                with self.assertRaisesRegex(mef.SourceError, "canone non valido"):
                    mef.contratti_projection(spec, self.input_dir, {})
        spec = self.synthetic_spec([bene("1")], [contratto("10", **{"Tipo detenzione a terzi": "in comodato"})])
        with self.assertRaisesRegex(mef.SourceError, "tipo detenzione"):
            mef.contratti_projection(spec, self.input_dir, {})

    def test_lock_matches_corpus_registration(self) -> None:
        mef.validate_contract(self.spec)
        corpus_spec = json.loads(mef.CORPUS_SPEC.read_text(encoding="utf-8"))
        registered = {item["id"]: item for item in corpus_spec["datasets"]}
        beni = registered[self.spec["datasets"]["beni"]]
        contratti = registered[self.spec["datasets"]["contratti"]]
        self.assertEqual(beni["expected"]["headers"], mef.BENI_HEADERS)
        self.assertEqual(contratti["expected"]["headers"], mef.CONTRATTI_HEADERS)
        self.assertEqual((beni["publication"], beni["privateFields"]), ("rows", []))
        self.assertEqual(sum(item["rows"] for item in self.spec["files"] if item["kind"] == "immobili"), self.spec["expected"]["immobiliRows"])
        self.assertEqual(sum(item["rows"] for item in self.spec["files"] if item["kind"] == "detenzioni"), self.spec["expected"]["detenzioniRows"])

    def test_rejects_license_period_and_provenance_drift(self) -> None:
        for path, value in (
            (("source", "license"), "not-declared"),
            (("source", "referenceDate"), "2022-12-31"),
            (("semantics", "soldi", "unit"), "centesimi"),
            (("semantics", "periodo", "referencePeriod"), "Anno 2023"),
        ):
            with self.subTest(path=path):
                spec = deepcopy(self.spec)
                target = spec
                for key in path[:-1]:
                    target = target[key]
                target[path[-1]] = value
                with self.assertRaises(mef.SourceError):
                    mef.validate_contract(spec)
        spec = deepcopy(self.spec)
        spec["files"][0]["url"] = "https://example.org/Imm.zip"
        with self.assertRaisesRegex(mef.SourceError, "URL non ufficiale"):
            mef.validate_contract(spec, require_corpus=False)


def adempimento(**fields: str) -> dict[str, str]:
    """A compliance row for ROMA, sent in 2023 and present in both census files."""
    return {**ROMA, "Settore Istituzionale": "AMMINISTRAZIONI S13", "Macrocategoria Amministrazione": "Amministrazioni Locali",
            "Numero beni in proprieta'": "1", "Numero beni in detenzione": "1", "Dichiarazione negativa": "No",
            "Dich. di completezza dei dati": "Si", "Invio comunicazione": "Si", "Obbligo di comunicazione": "Si",
            "Nome sezione": "Amministrazioni Comunali", "Nome file Beni Immobili Dichiarati": "Imm_Roma",
            "Nome file Detenzioni a favore di terzi": "Det_Roma", **fields}


class MefAdempimentoTests(TestCase):
    """The compliance file is reconciled with the entities of the census it describes."""

    # Reuse the archive fixtures without running the census tests a second time.
    @classmethod
    def setUpClass(cls) -> None:
        cls.spec = json.loads(mef.SPEC.read_text(encoding="utf-8"))

    setUp = MefPatrimonioImmobiliareTests.setUp
    tearDown = MefPatrimonioImmobiliareTests.tearDown
    archive = MefPatrimonioImmobiliareTests.archive
    synthetic_spec = MefPatrimonioImmobiliareTests.synthetic_spec

    OTHER = {"Amministrazione Codice Fiscale": "[00008010803]", "Amministrazione Denominazione": "COMUNE DI CINQUEFRONDI (RC)",
             "Regione (Amministrazione)": "CALABRIA", "Provincia (Amministrazione)": "REGGIO CALABRIA",
             "Comune (Amministrazione)": "Cinquefrondi", "Cod. Comune (Amministrazione)": "C710"}

    def compliance_spec(self, rows: list[dict[str, str]], expected: dict[str, int] | None = None) -> dict:
        spec = self.synthetic_spec([bene("1")], [contratto("10")])
        headers = self.spec["adempimento"]["headers"]
        text = io.StringIO(newline="")
        writer = csv.writer(text, delimiter=";", lineterminator="\r\n")
        writer.writerow(headers)
        writer.writerows([[row.get(header, "") for header in headers] for row in rows])
        payload = text.getvalue().encode("utf-8")
        (self.input_dir / "Dati_Adempimento_Anno_2023.csv").write_bytes(payload)
        spec["adempimento"].update(bytes=len(payload), sha256=hashlib.sha256(payload).hexdigest(), rows=len(rows))
        spec["adempimento"]["expected"] = expected or {
            "comuni": 1, "invioNo": 0, "invioNoInCensimento": 0, "negativaConBeni": 0, "completezzaNo": 0,
        }
        return spec

    def compliance(self, spec: dict) -> list[dict[str, str]]:
        beni_registry: dict = {}
        contratti_registry: dict = {}
        mef.beni_projection(spec, self.input_dir, beni_registry)
        mef.contratti_projection(spec, self.input_dir, contratti_registry)
        body = mef.adempimento_projection(spec, self.input_dir, beni_registry, contratti_registry)
        return list(csv.DictReader(io.StringIO(body.decode("utf-8")), delimiter="|"))

    def test_projects_one_row_per_entity_and_keeps_empty_declarations_empty(self) -> None:
        not_sent = adempimento(**self.OTHER, **{
            "Invio comunicazione": "No", "Dichiarazione negativa": "", "Dich. di completezza dei dati": "",
            "Nome sezione": "", "Nome file Beni Immobili Dichiarati": "", "Nome file Detenzioni a favore di terzi": "",
            "Numero beni in proprieta'": "0", "Numero beni in detenzione": "0",
        })
        region = adempimento(**{"Amministrazione Codice Fiscale": "[80000000000]", "Tipologia Amministrazione": "Regioni",
                                "Nome sezione": "", "Nome file Beni Immobili Dichiarati": "",
                                "Nome file Detenzioni a favore di terzi": ""})
        spec = self.compliance_spec([adempimento(), not_sent, region], {
            "comuni": 2, "outsidePerimeter": 1, "invioNo": 1, "invioNoInCensimento": 0, "negativaConBeni": 0, "completezzaNo": 0,
        })
        rows = {row["Codice fiscale ente"]: row for row in self.compliance(spec)}
        self.assertEqual(set(rows), {"02438750586", "00008010803"})
        self.assertEqual(
            [rows["02438750586"][key] for key in ("Invio comunicazione 2023", "Presente nel censimento pubblicato",
                                                  "Presente nelle detenzioni pubblicate")],
            ["Si", "Si", "Si"],
        )
        cinquefrondi = rows["00008010803"]
        self.assertEqual((cinquefrondi["Dichiarazione negativa"], cinquefrondi["Dichiarazione di completezza"]), ("", ""))
        self.assertEqual(cinquefrondi["Presente nel censimento pubblicato"], "No")
        self.assertEqual(list(cinquefrondi)[:4], ["Codice fiscale ente", "Ente", "Obbligo di comunicazione", "Invio comunicazione 2023"])

    def test_counts_census_bodies_that_did_not_communicate_in_2023(self) -> None:
        carried_over = adempimento(**{"Invio comunicazione": "No", "Dichiarazione negativa": "",
                                      "Dich. di completezza dei dati": ""})
        spec = self.compliance_spec([carried_over], {
            "comuni": 1, "invioNo": 1, "invioNoInCensimento": 1, "negativaConBeni": 0, "completezzaNo": 0,
        })
        self.assertEqual(self.compliance(spec)[0]["Invio comunicazione 2023"], "No")
        spec["adempimento"]["expected"]["invioNoInCensimento"] = 0
        with self.assertRaisesRegex(mef.SourceError, "conteggi dell'adempimento"):
            self.compliance(spec)

    def test_rejects_declarations_inconsistent_with_the_communication(self) -> None:
        cases = [
            (adempimento(**{"Invio comunicazione": "No"}), "dichiarazioni incoerenti"),
            (adempimento(**{"Dichiarazione negativa": ""}), "dichiarazioni incoerenti"),
            (adempimento(**{"Dich. di completezza dei dati": "Forse"}), "dichiarazioni incoerenti"),
            (adempimento(**{"Invio comunicazione": "Si, parziale"}), "invio o obbligo"),
            (adempimento(**{"Obbligo di comunicazione": ""}), "obbligo assente"),
            (adempimento(**{"Numero beni in proprieta'": "1.200"}), "conteggio beni"),
            (adempimento(**{"Amministrazione Codice Fiscale": "02438750586"}), "codice fiscale"),
        ]
        for row, message in cases:
            with self.subTest(message=message, row=row):
                with self.assertRaisesRegex(mef.SourceError, message):
                    self.compliance(self.compliance_spec([row]))
        with self.assertRaisesRegex(mef.SourceError, "duplicato"):
            self.compliance(self.compliance_spec([adempimento(), adempimento()]))

    def test_rejects_presence_or_registry_that_disagrees_with_the_census(self) -> None:
        cases = [
            ([adempimento(**{"Nome file Detenzioni a favore di terzi": ""})], "presenza nel censimento"),
            ([adempimento(**{"Nome sezione": ""})], "presenza nel censimento"),
            ([adempimento(**{"Cod. Comune (Amministrazione)": "H502"})], "anagrafica ente diversa"),
            ([adempimento(**self.OTHER)], "presenza nel censimento"),
        ]
        for rows, message in cases:
            with self.subTest(message=message):
                with self.assertRaisesRegex(mef.SourceError, message):
                    self.compliance(self.compliance_spec(rows))
        # A merged Comune whose name differs only in case or hyphenation is the same body.
        self.compliance(self.compliance_spec([adempimento(**{"Comune (Amministrazione)": "ROMA"})]))

    def test_rejects_census_bodies_missing_from_the_compliance_file(self) -> None:
        spec = self.compliance_spec([adempimento()])
        spec["files"] = [self.archive("immobili", [bene("1"), bene("2", **self.OTHER)]), self.archive("detenzioni", [contratto("10")])]
        spec["expected"]["immobiliRows"] = 2
        with self.assertRaisesRegex(mef.SourceError, "assenti dall'adempimento"):
            self.compliance(spec)

    def test_rejects_tampered_compliance_bytes_headers_and_lock(self) -> None:
        spec = self.compliance_spec([adempimento()])
        tampered = deepcopy(spec)
        tampered["adempimento"]["sha256"] = "0" * 64
        with self.assertRaisesRegex(mef.SourceError, "byte sorgente"):
            self.compliance(tampered)
        tampered = deepcopy(spec)
        tampered["adempimento"]["headers"] = list(reversed(tampered["adempimento"]["headers"]))
        with self.assertRaisesRegex(mef.SourceError, "header divergenti"):
            self.compliance(tampered)
        tampered = deepcopy(self.spec)
        tampered["adempimento"]["url"] = "https://example.org/Dati_Adempimento_Anno_2023.csv"
        with self.assertRaisesRegex(mef.SourceError, "lock del file di adempimento"):
            mef.validate_contract(tampered, require_corpus=False)

    def test_compliance_lock_matches_corpus_registration(self) -> None:
        mef.validate_contract(self.spec)
        corpus_spec = json.loads(mef.CORPUS_SPEC.read_text(encoding="utf-8"))
        registered = {item["id"]: item for item in corpus_spec["datasets"]}[self.spec["datasets"]["adempimento"]]
        self.assertEqual(registered["expected"]["headers"], mef.ADEMPIMENTO_HEADERS)
        expected = self.spec["adempimento"]["expected"]
        self.assertEqual(registered["expected"]["rows"], expected["comuni"] + expected["erp"])
        self.assertEqual(expected["comuni"] + expected["erp"] + expected["outsidePerimeter"], self.spec["adempimento"]["rows"])
