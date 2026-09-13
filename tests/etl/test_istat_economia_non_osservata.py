from __future__ import annotations

import csv
import io
import json
import sys
from copy import deepcopy
from pathlib import Path
from unittest import TestCase

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts" / "etl"))

import istat_economia_non_osservata as noe


class IstatEconomiaNonOsservataTests(TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.spec = json.loads(noe.SPEC.read_text())
        cls.payload = noe.verified_source(cls.spec)

    def rows(self, payload: bytes) -> list[dict[str, str]]:
        return list(csv.DictReader(io.StringIO(payload.decode()), delimiter="|"))

    def test_projects_exact_period_components_precision_and_missing_incidence(self) -> None:
        projected = noe.projections(self.spec)
        components = self.rows(projected["istat-economia-non-osservata-componenti"])
        branches = self.rows(projected["istat-economia-sommersa-branche"])

        self.assertEqual(len(components), 104)
        self.assertEqual(len(branches), 624)
        self.assertEqual({row["Anno"] for row in components}, {str(year) for year in range(2011, 2024)})
        self.assertEqual({row["Anno"] for row in branches}, {str(year) for year in range(2011, 2024)})
        self.assertEqual(sum(row["Incidenza percentuale"] == "" for row in components), 26)
        self.assertTrue(all(row["Denominatore incidenza"] == "" for row in components if row["Componente"] in {"Valore aggiunto", "PIL"}))

        underreporting = next(
            row for row in components
            if row["Anno"] == "2011" and row["Componente"] == "- da Sottodichiarazione"
        )
        self.assertEqual(underreporting["Valore"], "93265.107644834003")
        total_2023 = next(
            row for row in components
            if row["Anno"] == "2023" and row["Componente"] == "Economia non osservata"
        )
        self.assertEqual(total_2023["Valore"], "217541.27681000001")
        self.assertEqual(total_2023["Incidenza percentuale"], "10.153136572700376")
        self.assertEqual({row["Denominatore"] for row in branches if row["Branca"] == "Totale"}, {"valore aggiunto totale nazionale"})
        self.assertEqual({row["Denominatore"] for row in branches if row["Branca"] != "Totale"}, {"valore aggiunto totale della stessa branca"})

    def test_rejects_tampered_source_and_schema(self) -> None:
        damaged = bytearray(self.payload)
        damaged[-1] ^= 1
        temporary = self.id().replace(".", "-")
        path = ROOT / "tests" / "fixtures" / "istat-economia-non-osservata" / temporary
        try:
            path.write_bytes(damaged)
            with self.assertRaisesRegex(noe.SourceError, "byte sorgente divergenti"):
                noe.verified_source(self.spec, path)
        finally:
            path.unlink(missing_ok=True)

        changed = deepcopy(self.spec)
        changed["workbook"]["expectedSheetNames"][2] = "TAVOLA UNO"
        with self.assertRaisesRegex(noe.SourceError, "nomi o ordine dei fogli"):
            noe.workbook_cells(self.payload, changed)

    def test_rejects_license_or_period_drift(self) -> None:
        changed = deepcopy(self.spec)
        changed["source"]["license"] = "not-declared"
        with self.assertRaisesRegex(noe.SourceError, "licenza, periodo o geografia"):
            noe.validate_contract(changed)

        changed = deepcopy(self.spec)
        changed["source"]["referenceYears"] = list(range(2012, 2024))
        with self.assertRaisesRegex(noe.SourceError, "licenza, periodo o geografia"):
            noe.validate_contract(changed)

    def test_rejects_broken_real_reconciliations(self) -> None:
        cells, _ = noe.workbook_cells(self.payload, self.spec)
        component_table, branch_table = self.spec["tables"]

        component_cells = dict(cells[component_table["sheetName"]])
        component_cells["B8"] = "93266.107644834003"
        with self.assertRaisesRegex(noe.SourceError, "componenti monetarie non riconciliate"):
            noe.component_projection(component_table, component_cells, self.spec["source"])

        branch_cells = dict(cells[branch_table["sheetName"]])
        branch_cells["B6"] = "1"
        with self.assertRaisesRegex(noe.SourceError, "componenti di branca non riconciliate"):
            noe.branch_projection(branch_table, branch_cells, self.spec["source"])

    def test_committed_corpus_is_rederived_from_the_locked_workbook(self) -> None:
        noe.check_committed(noe.projections(self.spec))
