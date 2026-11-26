"""PA software licences (#886): parsing, vendor classification and source locks."""

from __future__ import annotations

import copy
import csv
import hashlib
import io
import json
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts" / "etl"))

import pa_licenze_software as etl  # noqa: E402

SPEC = json.loads(etl.DEFAULT_SPEC.read_text(encoding="utf-8"))
CONV = SPEC["consip"]["assets"]["convenzioni-2024"]["headers"]
MEPA = SPEC["consip"]["assets"]["mepa-2024"]["headers"]


def conv_row(**values: str) -> dict[str, str]:
    row = dict.fromkeys(CONV, "")
    row.update({"#Anno_Riferimento": "2024", "Tipologia_Amministrazione": "COMUNI"})
    row.update(values)
    return row


def mepa_row(**values: str) -> dict[str, str]:
    row = dict.fromkeys(MEPA, "")
    row.update({"#Anno_Riferimento": "2024", "Tipologia_Amministrazione": "COMUNI"})
    row.update(values)
    return row


def encode(headers: list[str], rows: list[dict[str, str]]) -> bytes:
    buffer = io.StringIO()
    writer = csv.DictWriter(buffer, fieldnames=headers, lineterminator="\n")
    writer.writeheader()
    writer.writerows(rows)
    return buffer.getvalue().encode("latin-1")


class FixtureSpec:
    """A one-year spec whose locks match small CSVs written to a temp directory."""

    def __init__(self, conventions: list[dict[str, str]], mepa: list[dict[str, str]]) -> None:
        self.directory = tempfile.TemporaryDirectory()
        self.cache = Path(self.directory.name)
        self.spec = copy.deepcopy(SPEC)
        self.spec["consip"]["years"] = [2024]
        self.spec["consip"]["assets"] = {}
        for key, headers, rows in (("convenzioni-2024", CONV, conventions), ("mepa-2024", MEPA, mepa)):
            payload = encode(headers, rows)
            (self.cache / f"{key}.csv").write_bytes(payload)
            self.spec["consip"]["assets"][key] = {
                "url": "https://dati.consip.it/x.csv",
                "file": f"{key}.csv",
                "bytes": len(payload),
                "sha256": hashlib.sha256(payload).hexdigest(),
                "lastModified": "2026-01-01",
                "headers": headers,
            }

    def __enter__(self) -> "FixtureSpec":
        return self

    def __exit__(self, *_: object) -> None:
        self.directory.cleanup()


class AmountTests(unittest.TestCase):
    def test_comma_decimals_and_plain_euros_become_exact_cents(self) -> None:
        self.assertEqual(etl.cents("280486,82"), 28048682)
        self.assertEqual(etl.cents("1.280.486,8"), 128048680)
        self.assertEqual(etl.cents("317213453"), 31721345300)
        self.assertEqual(etl.cents(""), 0)

    def test_reversals_keep_their_sign(self) -> None:
        # Consip publishes reversals as negative amounts in the 2024 and 2025 files.
        self.assertEqual(etl.cents("-87004,8"), -8700480)

    def test_garbage_is_refused(self) -> None:
        with self.assertRaises(etl.LicenceError):
            etl.cents("n.d.")
        with self.assertRaises(etl.LicenceError):
            etl.count("3,5")


class VendorTests(unittest.TestCase):
    def test_every_published_lot_has_exactly_one_vendor(self) -> None:
        lots = {
            "FORNITURA DI PRODOTTI (SOTTOSCRIZIONI SOFTWARE OPEN SOURCE) SUSE E DEI SERVIZI CONNESSI PER LE PA": ("SUSE", True),
            "PRODOTTI OPEN SOURCE RED HAT E SERVIZI CONNESSI": ("Red Hat", True),
            "PRODOTTI VMWARE BY BROADCOM E SERVIZI CONNESSI": ("VMware (Broadcom)", False),
            "PRODOTTI VMWARE E SERVIZI CONNESSI": ("VMware (Broadcom)", False),
            "PRODOTTI SAP, RINNOVO DELLA MANUTENZIONE PER  LE LICENZE IN USO E SERVIZI CONNESSI": ("SAP", False),
            "PRODOTTI SAS E SERVIZI CONNESSI": ("SAS", False),
            "PRODOTTI CITRIX-TIBCO, RINNOVO DELLA MANUTENZIONE PER LE LICENZE IN USO E SERVIZI CONNESSI": ("Citrix-Tibco", False),
            "FORNITURA DI PRODOTTI MICROSOFT E DEI SERVIZI CONNESSI PER LE PA": ("Microsoft", False),
            "PRODOTTI ORACLE E SERVIZI CONNESSI": ("Oracle", False),
        }
        for lot, (vendor, open_source) in lots.items():
            with self.subTest(lot=lot):
                self.assertEqual(etl.lot_vendor("multibrand", lot, SPEC), {"vendor": vendor, "openSource": open_source})

    def test_microsoft_agreements_are_microsoft_whatever_the_lot(self) -> None:
        self.assertEqual(etl.lot_vendor("microsoft-ea", "LOTTO UNICO", SPEC)["vendor"], "Microsoft")

    def test_an_unknown_lot_blocks_publication(self) -> None:
        with self.assertRaises(etl.LicenceError):
            etl.lot_vendor("multibrand", "PRODOTTI SALESFORCE E SERVIZI CONNESSI", SPEC)

    def test_conventions_outside_the_perimeter_are_not_software(self) -> None:
        self.assertEqual(etl.convention_family("Microsoft Enterprise Agreement 9", SPEC), "microsoft-ea")
        self.assertEqual(etl.convention_family("PRODOTTI SOFTWARE ON PREMISE (ID2924)", SPEC), "on-premise")
        self.assertIsNone(etl.convention_family("PC DESKTOP 20", SPEC))

    def test_legal_forms_do_not_split_an_awardee(self) -> None:
        self.assertEqual(etl.normalized_vendor("ITALWARE - S.R.L."), etl.normalized_vendor("Italware srl"))
        self.assertEqual(etl.normalized_vendor("TIM S.P.A."), etl.normalized_vendor("TIM SPA"))


class ConsipTests(unittest.TestCase):
    def test_count_and_amount_rows_are_combined_and_other_conventions_excluded(self) -> None:
        rows = [
            conv_row(Convenzione="LICENZE SOFTWARE MULTIBRAND 6", Lotto="PRODOTTI ORACLE E SERVIZI CONNESSI", Numero_Ordini="3"),
            conv_row(Convenzione="LICENZE SOFTWARE MULTIBRAND 6", Lotto="PRODOTTI ORACLE E SERVIZI CONNESSI", Importo_Ordinato="1000,5"),
            conv_row(Convenzione="MICROSOFT ENTERPRISE AGREEMENT 8", Lotto="LOTTO UNICO", Importo_Ordinato="200"),
            conv_row(Convenzione="PC DESKTOP 20", Lotto="LOTTO 1", Importo_Ordinato="999", Numero_Ordini="9"),
        ]
        mepa = [mepa_row(Categoria_Abilitazione=category, Valore_economico_Ordini="10") for category in SPEC["consip"]["mepaCategories"]]
        with FixtureSpec(rows, mepa) as fixture:
            [year] = etl.consip_conventions(fixture.spec, fixture.cache)
        self.assertEqual(year["cents"], 120050)
        self.assertEqual(year["orders"], 3)
        self.assertEqual(year["allConventionsCents"], 219950)
        self.assertEqual([entry["vendor"] for entry in year["byVendor"]], ["Oracle", "Microsoft"])

    def test_mepa_without_order_counts_reports_null_not_zero(self) -> None:
        mepa = [mepa_row(Categoria_Abilitazione=category, Valore_economico_Ordini="1650") for category in SPEC["consip"]["mepaCategories"]]
        mepa.append(mepa_row(Categoria_Abilitazione="Arredi", Valore_economico_Ordini="5"))
        with FixtureSpec([], mepa) as fixture:
            [year] = etl.consip_mepa(fixture.spec, fixture.cache)
        self.assertEqual(year["cents"], 330000)
        self.assertIsNone(year["orders"])
        self.assertTrue(all(entry["orders"] is None for entry in year["byAdministrationType"]))
        self.assertEqual(year["allMepaCents"], 330500)

    def test_a_missing_mepa_category_blocks_publication(self) -> None:
        mepa = [mepa_row(Categoria_Abilitazione=SPEC["consip"]["mepaCategories"][0], Valore_economico_Ordini="1")]
        with FixtureSpec([], mepa) as fixture, self.assertRaises(etl.LicenceError):
            etl.consip_mepa(fixture.spec, fixture.cache)

    def test_a_file_that_differs_from_the_lock_is_refused(self) -> None:
        with FixtureSpec([], []) as fixture:
            path = fixture.cache / "convenzioni-2024.csv"
            path.write_bytes(path.read_bytes() + b"\n")
            with self.assertRaises(etl.LicenceError):
                etl.consip_conventions(fixture.spec, fixture.cache)


class SourceLockTests(unittest.TestCase):
    def test_every_asset_is_pinned_and_official(self) -> None:
        for key, asset in SPEC["consip"]["assets"].items():
            with self.subTest(asset=key):
                self.assertTrue(asset["url"].startswith("https://dati.consip.it/download/dataset/"))
                self.assertRegex(asset["sha256"], r"^[0-9a-f]{64}$")
                self.assertGreater(asset["bytes"], 0)
        self.assertTrue(SPEC["ipa"]["url"].startswith("https://indicepa.gov.it/"))
        self.assertEqual(SPEC["anac"]["cpvDivision"], "48")
        self.assertEqual(SPEC["siope"]["code"], "5205")

    def test_siope_code_is_read_from_the_versioned_release(self) -> None:
        siope = etl.siope_licences(SPEC)
        self.assertEqual(siope["label"], "Licenze software")
        self.assertGreater(len(siope["byYear"]), 0)
        self.assertTrue(all(year["cents"] > 0 and year["entities"] > 0 for year in siope["byYear"]))


if __name__ == "__main__":
    unittest.main()
