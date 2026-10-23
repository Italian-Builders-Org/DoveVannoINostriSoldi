from __future__ import annotations

import csv
import io
import json
from copy import deepcopy
from decimal import Decimal
from unittest import TestCase

import ade_immobili_italia_2026 as ade


class AdeImmobiliItalia2026Tests(TestCase):
    @classmethod
    def setUpClass(cls):
        cls.spec = json.loads(ade.SPEC_PATH.read_text(encoding="utf-8"))
        cls.manifest = json.loads(
            (ade.ROOT / cls.spec["assets"]["tableManifest"]["path"]).read_text(encoding="utf-8"),
        )
        ade.SPEC = cls.spec

    def test_projections_match_pinned_counts_and_imu_2024(self):
        prelievo = ade.project_prelievo(self.spec, self.manifest)
        utilizzo = ade.project_utilizzo(self.spec)
        tabelle, missing = ade.project_tabelle(self.spec, self.manifest)
        analysis_data, analysis_meta = ade.build_analysis(
            self.spec, self.manifest, prelievo, utilizzo, missing,
        )
        prelievo_rows = list(csv.DictReader(io.StringIO(prelievo.decode("utf-8")), delimiter="|"))
        self.assertEqual(len(prelievo_rows), 180)
        imu_2024 = next(
            row for row in prelievo_rows if row["Voce"].startswith("IMU di cui") and row["Anno"] == "2024"
        )
        self.assertEqual(imu_2024["Importo (mld euro)"], "20.98")
        self.assertEqual(sum(1 for _ in csv.reader(io.StringIO(utilizzo.decode()), delimiter="|")) - 1, 16632)
        self.assertEqual(sum(1 for _ in csv.reader(io.StringIO(tabelle.decode()), delimiter="|")) - 1, 3033)
        self.assertEqual(len(missing), 14)
        payload = json.loads(analysis_data.decode("utf-8"))
        self.assertEqual(payload["hero"]["imuGettito2024Mld"], "20.98")
        self.assertEqual(payload["coverage"]["utilizzoProvinciaRows"], 16632)
        self.assertEqual(payload["coverage"]["tablesAvailableViaApi"], 40)
        meta = json.loads(analysis_meta.decode("utf-8"))
        self.assertEqual(meta["datasetId"], "ade-immobili-italia-2026")
        ade.check_committed(
            self.spec,
            {
                ade.PRELIEVO_ID: prelievo,
                ade.UTILIZZO_ID: utilizzo,
                ade.TABELLE_ID: tabelle,
            },
        )

    def test_rejects_bad_zip_or_table_hash(self):
        changed = deepcopy(self.spec)
        changed["assets"]["opendataZip"]["sha256"] = "0" * 64
        with self.assertRaises(ade.SourceError):
            ade.verified_bytes(changed["assets"]["opendataZip"])

    def test_money_parser_rejects_invalid_values(self):
        with self.assertRaises(ade.SourceError):
            ade.money_mld("non-numero")
        self.assertEqual(ade.money_mld("20,98"), "20.98")
        self.assertEqual(Decimal(ade.money_mld("3.85")), Decimal("3.85"))
