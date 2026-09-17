"""Offline checks for the MASAF Mercati seed lock and published snapshot."""

from __future__ import annotations

import copy
import json
import tempfile
import unittest
from pathlib import Path

import masaf_logistica_mercati_snapshot as masaf


class MasafLogisticaMercatiTests(unittest.TestCase):
    def test_committed_bundle_matches_seed_lock(self):
        masaf.check()

    def test_payments_stay_null_and_are_not_zero(self):
        seed = masaf.load_seed(masaf.load_spec())
        for project in seed["projects"]:
            self.assertIsNone(project["erogazioniEuro"])
            self.assertIsNone(project["pagamentiEuro"])

    def test_tampered_seed_hash_or_invented_payment_fail(self):
        spec = masaf.load_spec()
        seed = masaf.load_seed(spec)
        broken = copy.deepcopy(seed)
        broken["projects"][0]["pagamentiEuro"] = 0
        with self.assertRaises(masaf.SnapshotError):
            masaf.build(broken, spec)

        with tempfile.TemporaryDirectory() as directory:
            data, meta = masaf.build(seed, spec)
            data_path = Path(directory) / "data.json"
            meta_path = Path(directory) / "meta.json"
            data["projects"][0]["pagamentiEuro"] = 0
            data_path.write_text(json.dumps(data), encoding="utf-8")
            meta_path.write_text(json.dumps(meta), encoding="utf-8")
            with self.assertRaises(masaf.SnapshotError):
                masaf.check(data_path=data_path, meta_path=meta_path)


if __name__ == "__main__":
    unittest.main()
