from __future__ import annotations

import csv
import io
import json
import sys
from copy import deepcopy
from decimal import Decimal
from pathlib import Path
from unittest import TestCase

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts" / "etl"))

import istat_economia_non_osservata_territoriale as noe


class IstatEconomiaNonOsservataTerritorialeTests(TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.spec = json.loads(noe.SPEC.read_text(encoding="utf-8"))
        cls.payload = noe.verified_source(cls.spec)

    def rows(self, payload: bytes) -> list[dict[str, str]]:
        return list(csv.DictReader(io.StringIO(payload.decode()), delimiter="|"))

    def test_projects_exact_territories_components_and_precision(self) -> None:
        projected = noe.projections(self.spec)
        rows = self.rows(projected["istat-economia-non-osservata-territori"])

        self.assertEqual(len(rows), 108)
        self.assertEqual({row["Anno"] for row in rows}, {"2023"})
        self.assertEqual(len({row["Territorio"] for row in rows}), 27)
        self.assertEqual(
            {row["Componente"] for row in rows},
            {"Rivalutazione", "Lavoro irregolare", "Altro", "Totale"},
        )
        self.assertTrue(all(row["Unità"] == "percentuale" for row in rows))
        self.assertTrue(
            all(row["Denominatore"] == "valore aggiunto totale del territorio" for row in rows)
        )
        self.assertNotIn("Altro*", {row["Componente"] for row in rows})

        piemonte_totale = next(
            row for row in rows if row["Territorio"] == "Piemonte" and row["Componente"] == "Totale"
        )
        self.assertEqual(piemonte_totale["Incidenza percentuale"], "10.193655390760677")
        italia = next(
            row for row in rows if row["Territorio"] == "Italia" and row["Componente"] == "Totale"
        )
        self.assertEqual(italia["Incidenza percentuale"], "11.302031649015863")
        mezzogiorno = next(
            row
            for row in rows
            if row["Territorio"] == "Mezzogiorno" and row["Componente"] == "Totale"
        )
        self.assertEqual(mezzogiorno["Incidenza percentuale"], "16.494276269904645")

        soldi = self.spec["semantics"]["soldi"]
        self.assertIs(soldi["present"], False)

    def test_rejects_tampered_source_and_schema(self) -> None:
        damaged = bytearray(self.payload)
        damaged[-1] ^= 1
        temporary = self.id().replace(".", "-")
        path = ROOT / "tests" / "fixtures" / "istat-economia-non-osservata-territoriale" / temporary
        try:
            path.write_bytes(damaged)
            with self.assertRaisesRegex(noe.SourceError, "byte sorgente divergenti"):
                noe.verified_source(self.spec, path)
        finally:
            path.unlink(missing_ok=True)

        changed = deepcopy(self.spec)
        changed["workbook"]["expectedSheetNames"][6] = "Tavola 6"
        with self.assertRaisesRegex(noe.SourceError, "nomi o ordine dei fogli"):
            noe.workbook_cells(self.payload, changed)

    def test_rejects_license_period_or_money_semantics_drift(self) -> None:
        changed = deepcopy(self.spec)
        changed["source"]["license"] = "not-declared"
        with self.assertRaisesRegex(noe.SourceError, "licenza, periodo o geografia"):
            noe.validate_contract(changed)

        changed = deepcopy(self.spec)
        changed["source"]["referenceYear"] = 2022
        with self.assertRaisesRegex(noe.SourceError, "licenza, periodo o geografia"):
            noe.validate_contract(changed)

        changed = deepcopy(self.spec)
        changed["semantics"]["soldi"]["present"] = True
        with self.assertRaisesRegex(noe.SourceError, "asse soldi"):
            noe.validate_contract(changed)

    def test_rejects_broken_component_reconciliations(self) -> None:
        cells = noe.workbook_cells(self.payload, self.spec)
        table = self.spec["tables"][0]
        sheet = dict(cells[table["sheetName"]])
        sheet["B4"] = str(Decimal(sheet["B4"]) + Decimal("1"))
        with self.assertRaisesRegex(noe.SourceError, "componenti territoriali non riconciliate"):
            noe.territorial_projection(table, sheet, self.spec["source"])

    def test_committed_corpus_is_rederived_from_the_locked_workbook(self) -> None:
        noe.check_committed(noe.projections(self.spec))

    def test_rejects_repeated_provenance_drift(self) -> None:
        for axis, key, value in [
            ("periodo", "publicationDate", "2025-01-28"),
            ("periodo", "checkedAt", "2026-09-12"),
            ("provenance", "holder", "altro titolare"),
            ("provenance", "canonicalUrls", []),
        ]:
            with self.subTest(axis=axis, key=key):
                changed = deepcopy(self.spec)
                changed["semantics"][axis][key] = value
                with self.assertRaises(noe.SourceError):
                    noe.validate_contract(changed)
