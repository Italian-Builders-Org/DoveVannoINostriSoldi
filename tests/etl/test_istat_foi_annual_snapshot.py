import copy
import subprocess
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts" / "etl"))
import istat_foi_annual_snapshot as etl  # noqa: E402

FIXTURES = ROOT / "tests/fixtures/istat-foi-annuale"


def relock(spec: dict, name: str, payload: bytes) -> dict:
    spec = copy.deepcopy(spec)
    spec["source"]["assets"][name].update(bytes=len(payload), sha256=etl.sha256_bytes(payload))
    return spec


class IstatFoiAnnualSnapshotTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.spec = etl.load_spec(etl.DEFAULT_SPEC)
        cls.inputs = {name: (FIXTURES / asset["filename"]).read_bytes() for name, asset in cls.spec["source"]["assets"].items()}
        cls.snapshot = etl.build_snapshot(cls.inputs, cls.spec)

    def build_with(self, name: str, payload: bytes) -> dict:
        return etl.build_snapshot({**self.inputs, name: payload}, relock(self.spec, name, payload))

    def test_fixtures_rebuild_the_committed_artifact_and_check_passes(self) -> None:
        self.assertEqual(etl.encode(self.snapshot), etl.DEFAULT_DATA.read_bytes())
        result = subprocess.run(
            [sys.executable, "scripts/etl/istat_foi_annual_snapshot.py", "--check"],
            cwd=ROOT, capture_output=True, text=True, check=False,
        )
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_every_year_keeps_its_published_base_and_value(self) -> None:
        rows = {row["year"]: row for row in self.snapshot["observations"]}
        self.assertEqual(list(rows), list(range(1996, 2026)))
        self.assertEqual((rows[1996]["base"], rows[1996]["foiTenths"]), (1995, 1039))
        self.assertEqual((rows[2011]["base"], rows[2011]["foiTenths"], rows[2011]["foiNoTobaccoTenths"]), (2010, 1028, 1027))
        self.assertEqual((rows[2016]["base"], rows[2016]["foiTenths"]), (2015, 999))

    def test_chained_series_uses_the_official_coefficients(self) -> None:
        rows = {row["year"]: row["base2025"] for row in self.snapshot["observations"]}
        self.assertEqual(rows[2008], {"foiHundredths": 7492, "foiNoTobaccoHundredths": 7518})
        self.assertEqual(rows[2010], {"foiHundredths": 7670, "foiNoTobaccoHundredths": 7691})
        self.assertEqual(rows[2015], {"foiHundredths": 8237, "foiNoTobaccoHundredths": 8237})
        self.assertEqual(rows[2023], {"foiHundredths": 9769, "foiNoTobaccoHundredths": 9778})
        self.assertEqual(rows[2025], {"foiHundredths": 10000, "foiNoTobaccoHundredths": 10000})
        self.assertEqual(
            self.snapshot["splicing"],
            [
                {"from": 1995, "to": 2010, "foiThousandths": 1385, "foiNoTobaccoThousandths": 1373},
                {"from": 2010, "to": 2015, "foiThousandths": 1074, "foiNoTobaccoThousandths": 1071},
                {"from": 2015, "to": 2025, "foiThousandths": 1214, "foiNoTobaccoThousandths": 1214},
            ],
        )

    def test_changed_bytes_fail_the_input_lock(self) -> None:
        changed = self.inputs["base-2010"].replace(b"102.8", b"102.9")
        with self.assertRaisesRegex(etl.SnapshotError, "byte/hash"):
            etl.build_snapshot({**self.inputs, "base-2010": changed}, self.spec)

    def test_missing_first_year_of_a_base_fails(self) -> None:
        lines = self.inputs["base-2010"].splitlines(keepends=True)
        payload = b"".join(line for line in lines if b",00,2011," not in line)
        with self.assertRaisesRegex(etl.SnapshotError, "anni"):
            self.build_with("base-2010", payload)

    def test_index_that_disagrees_with_the_coefficient_fails(self) -> None:
        payload = self.inputs["base-2015"].replace(b",00,2025,121.4,", b",00,2025,121.5,")
        with self.assertRaisesRegex(etl.SnapshotError, "raccordo"):
            self.build_with("base-2015", payload)

    def test_unexpected_row_or_flag_fails(self) -> None:
        for old, new in ((b",IT,12,4,00,2013,", b",ITC1,12,4,00,2013,"), (b",00,2013,107.2,", b",00,2013,107.2,p")):
            with self.subTest(new=new), self.assertRaises(etl.SnapshotError):
                self.build_with("base-2010", self.inputs["base-2010"].replace(old, new))

    def test_artifact_must_match_spec_and_recomputed_chain(self) -> None:
        cases = (
            (lambda s: s["observations"][12]["base2025"].update(foiHundredths=7500), "catena"),
            (lambda s: s["splicing"][0].update(foiThousandths=1386), "raccordo"),
            (lambda s: s["semantics"]["provenance"]["assets"]["raccordo"].update(sha256="0" * 64), "provenienza"),
        )
        for mutate, message in cases:
            broken = copy.deepcopy(self.snapshot)
            mutate(broken)
            with self.subTest(message=message), self.assertRaisesRegex(etl.SnapshotError, message):
                etl.validate_snapshot(broken, self.spec)


if __name__ == "__main__":
    unittest.main()
